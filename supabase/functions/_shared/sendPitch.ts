// The one implementation of "send one outreach email".
//
// TWO callers, deliberately sharing this: `send-email` (the admin clicking Send test,
// or an immediate send) and `drain-queue` (pg_cron, every minute). If each owned its
// own copy, the cron path would quietly drift — different signature, missing Reply-To,
// cap not enforced — and nobody would notice, because nobody reads the mail a robot
// sends. One function, both paths, same guarantees.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { buildSignature, type SignatureSource } from './signature.ts'
import { googleCreds, GoogleAuthError, refreshAccessToken, sendMessage } from './gmail.ts'
// Same normaliser the scraper de-duplicates with, so "one company" means the same
// thing on the way in and on the way out.
import { normalizeDomain } from './scrape.ts'
// Same file the Settings preview uses, so what you see while editing is what sends.
import { stripMarks, textToHtml } from '../../../lib/emailBody.ts'

const DEFAULT_DAILY_CAP = 20

// Refusals that are NOT "the send failed" — the message never left, and the right
// response differs per code. `capped` in particular must be retried later, not marked
// failed: the pitch is fine, the clock isn't.
export type BlockedCode =
  | 'not_configured'
  | 'no_account'
  | 'invalid_recipient'
  | 'capped'
  | 'duplicate_company'
  | 'paused'

export class SendBlockedError extends Error {
  code: BlockedCode
  constructor(code: BlockedCode, message: string) {
    super(message)
    this.name = 'SendBlockedError'
    this.code = code
  }
}

export interface SendPitchInput {
  to: string
  subject: string
  text: string
  /** Present for real outreach; omitted for a self-addressed test (cap-exempt). */
  contactId?: string | null
}

export interface SendPitchResult {
  id: string
  sentAt: string
  /** Mail went out but a follow-up bookkeeping write failed. NOT a send failure. */
  warning?: string
}

// Permissive on purpose: a typo guard, not an RFC 5322 validator. Gmail is the real
// authority on whether a recipient exists.
const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

// textToHtml / stripMarks now live in lib/emailBody.ts (imported above) so the
// Settings preview renders through the exact same code that composes the sent email.

interface ProfileRow {
  display_name: string | null
  handle: string | null
  reply_to_email: string | null
  seo: Record<string, unknown> | null
  content: Record<string, unknown> | null
}

export async function loadSignatureSource(svc: SupabaseClient): Promise<SignatureSource> {
  const { data } = await svc
    .from('public_profile')
    .select('display_name, handle, reply_to_email, seo, content')
    .eq('id', 1)
    .maybeSingle<ProfileRow>()

  const seo = (data?.seo ?? null) as Record<string, unknown> | null
  return {
    displayName: data?.display_name ?? '',
    handle: data?.handle ?? '',
    replyToEmail: data?.reply_to_email ?? '',
    ogImageUrl: typeof seo?.og_image_url === 'string' ? seo.og_image_url : '',
    content: data?.content ?? null,
  }
}

// Rolling 24h window, not "since midnight" — Gmail throttles on rate, and a calendar
// reset would happily let 2x the cap out across a midnight boundary.
// Exported: drain-queue budgets its auto-queue top-up from the same count.
export async function sentInLast24h(svc: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await svc
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .gte('last_emailed_at', since)
  return count ?? 0
}

// The safety knobs (migration 0017), read with `select *` and defaulted field by
// field so this keeps working against a database that has not applied 0017 yet.
export interface SendSettings {
  dailyCap: number
  warmupStart: number
  sendingPaused: boolean
  pausedReason: string
  autoQueue: boolean
  autoQueueMinConfidence: number
  sendWeekdaysOnly: boolean
  sendWindowStart: number
  sendWindowEnd: number
}

export async function loadSendSettings(svc: SupabaseClient): Promise<SendSettings> {
  const { data } = await svc.from('app_settings').select('*').eq('id', 1).maybeSingle()
  const s = (data ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  return {
    dailyCap: num(s.daily_cap, DEFAULT_DAILY_CAP),
    warmupStart: Math.max(1, num(s.warmup_start, 5)),
    sendingPaused: bool(s.sending_paused, false),
    pausedReason: typeof s.paused_reason === 'string' ? s.paused_reason : '',
    autoQueue: bool(s.auto_queue, false),
    autoQueueMinConfidence: num(s.auto_queue_min_confidence, 55),
    sendWeekdaysOnly: bool(s.send_weekdays_only, true),
    sendWindowStart: num(s.send_window_start, 8),
    sendWindowEnd: num(s.send_window_end, 11),
  }
}

// WARM-UP RAMP (BACKEND_DESIGN §6d, finally enforced): the cap a brand-new sending
// account gets is warmup_start, growing by warmup_start each full week since the
// FIRST real send, until it reaches daily_cap. 5 → 10 → 15 → 20 on the defaults.
// Gmail's abuse heuristics treat sudden volume from a quiet account as a takeover
// signal; a ramp is what "this is a human whose outreach is growing" looks like.
// Anchoring on the first send (not the connect date) means a long-idle account
// re-ramps only if the queue was empty long enough for min(sent_at) to matter — the
// anchor is immutable history, so the ramp can only ever move forward.
export async function effectiveDailyCap(svc: SupabaseClient, settings: SendSettings): Promise<number> {
  const { data } = await svc
    .from('send_queue')
    .select('sent_at')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const first = data?.sent_at ? Date.parse(data.sent_at) : NaN
  if (!Number.isFinite(first)) return Math.min(settings.dailyCap, settings.warmupStart)

  const weeks = Math.max(0, Math.floor((Date.now() - first) / (7 * 24 * 60 * 60 * 1000)))
  return Math.min(settings.dailyCap, settings.warmupStart * (1 + weeks))
}

interface CompanyRow {
  id: string
  website: string | null
  status: string
  last_emailed_at: string | null
}

// Every OTHER contact row belonging to the same company, keyed on the WEBSITE rather
// than the brand name or the email domain.
//
// Website is the only field that reliably identifies the company: brand names arrive
// from scraped page titles and drift ("Gymshark" vs "Gymshark UK"), and the email
// domain is often somebody else's entirely — the row that prompted this rule is
// Vuori's site listing `info@afterpay.com`.
//
// Normalising in TypeScript rather than SQL keeps ONE definition of "same company"
// (scrape.ts) instead of a second, subtly different one written as a regex in
// Postgres. The table is small enough that reading it whole costs nothing.
async function companyPeers(
  svc: SupabaseClient,
  contactId: string,
): Promise<{ domain: string; peers: CompanyRow[] } | null> {
  const { data: self } = await svc.from('contacts').select('website').eq('id', contactId).maybeSingle()
  const domain = normalizeDomain(self?.website ?? '')
  if (!domain) return null // no website recorded → nothing safe to group on

  const { data } = await svc
    .from('contacts')
    .select('id, website, status, last_emailed_at')
    .neq('id', contactId)
  const peers = ((data ?? []) as CompanyRow[]).filter((r) => normalizeDomain(r.website ?? '') === domain)
  return { domain, peers }
}

export async function sendPitch(
  svc: SupabaseClient,
  input: SendPitchInput,
): Promise<SendPitchResult> {
  const to = input.to.trim()
  const subject = input.subject.trim()
  const text = input.text
  const contactId = input.contactId || null

  if (!looksLikeEmail(to)) {
    throw new SendBlockedError('invalid_recipient', `"${to}" is not a valid email address.`)
  }
  if (!subject) throw new SendBlockedError('invalid_recipient', 'A subject is required.')
  if (!text.trim()) throw new SendBlockedError('invalid_recipient', 'The email body is empty.')

  const creds = googleCreds()
  if (!creds) {
    throw new SendBlockedError(
      'not_configured',
      'Gmail OAuth is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET — see docs/GMAIL_SENDING_SETUP.md.',
    )
  }

  const { data: account, error: accountErr } = await svc
    .from('gmail_account')
    .select('email, refresh_token')
    .eq('id', 1)
    .maybeSingle()

  if (accountErr) {
    throw new SendBlockedError('no_account', `Sending account is not set up: ${accountErr.message}`)
  }
  if (!account?.refresh_token) {
    throw new SendBlockedError('no_account', 'No Gmail account is connected. Connect one in Settings.')
  }

  if (contactId) {
    const settings = await loadSendSettings(svc)

    // The kill switch binds EVERY real send, including an admin's manual one — it
    // exists because the account looked like it was in trouble, and "just this one"
    // is how a paused account keeps digging.
    if (settings.sendingPaused) {
      throw new SendBlockedError(
        'paused',
        settings.pausedReason
          ? `Sending is paused: ${settings.pausedReason}`
          : 'Sending is paused in Settings.',
      )
    }

    const cap = await effectiveDailyCap(svc, settings)
    const sent = await sentInLast24h(svc)
    if (sent >= cap) {
      const rampNote = cap < settings.dailyCap ? ` (warm-up ramp; configured cap ${settings.dailyCap})` : ''
      throw new SendBlockedError(
        'capped',
        `Daily cap reached — ${sent} of ${cap}${rampNote} sent in the last 24 hours.`,
      )
    }

    // Refuse to pitch a company twice, even through a different inbox. This is the
    // LAST line rather than the only one — the post-send sweep below archives the
    // duplicates up front — but it is the one that holds when two rows for the same
    // company are claimed in a single cron batch: the first send stamps
    // last_emailed_at, so by the time the second is processed this check sees it.
    const company = await companyPeers(svc, contactId)
    const alreadyContacted = company?.peers.find((p) => p.status === 'sent' || p.last_emailed_at)
    if (alreadyContacted) {
      throw new SendBlockedError(
        'duplicate_company',
        `${company!.domain} has already been contacted at a different address — not sending twice.`,
      )
    }
  }

  const src = await loadSignatureSource(svc)
  const signature = buildSignature(src)

  // A rejected grant flips needs_reauth so the Settings card can say so; a transient
  // network blip must not, or one hiccup tells the admin to reconnect a healthy account.
  const noteAuthFailure = async (e: unknown): Promise<never> => {
    if (e instanceof GoogleAuthError && e.invalidGrant) {
      await svc
        .from('gmail_account')
        .update({
          needs_reauth: true,
          reauth_reason: 'Google rejected the saved token. Reconnect the account.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
    }
    throw e
  }

  let accessToken: string
  try {
    accessToken = (await refreshAccessToken(creds, account.refresh_token)).accessToken
  } catch (e) {
    return await noteAuthFailure(e)
  }

  let sentId = ''
  try {
    const res = await sendMessage(accessToken, {
      to,
      subject,
      text: `${stripMarks(text).replace(/\s+$/, '')}\n\n${signature.text}\n`,
      html: `${textToHtml(text)}${signature.html}`,
      fromEmail: account.email || '',
      fromName: src.displayName || undefined,
      replyTo: src.replyToEmail || undefined,
    })
    sentId = res.id
  } catch (e) {
    return await noteAuthFailure(e)
  }

  const now = new Date().toISOString()

  // Everything below runs only AFTER Gmail accepted the message. Marking a contact
  // 'sent' before that is how a queue fills up with brands nobody actually emailed.
  await svc.from('gmail_account').update({ last_send_at: now, updated_at: now }).eq('id', 1)

  if (contactId) {
    const { error: markErr } = await svc
      .from('contacts')
      .update({ status: 'sent', last_emailed_at: now })
      .eq('id', contactId)
    if (markErr) {
      return { id: sentId, sentAt: now, warning: `Sent, but could not update the contact: ${markErr.message}` }
    }

    // This company is now done, so retire its other addresses.
    //
    // Cancelling the QUEUE ROWS is the part that actually prevents a second email —
    // archiving the contact alone is cosmetic, because an already-queued row would
    // still be picked up by the next cron tick. Re-read rather than reusing the
    // pre-send list so anything queued while this message was in flight is included.
    //
    // Only 'new' and 'queued' are swept: 'replied' and 'inbound' mean the brand
    // engaged, which is never something to bury.
    const after = await companyPeers(svc, contactId)
    const stale = (after?.peers ?? [])
      .filter((p) => p.status === 'new' || p.status === 'queued')
      .map((p) => p.id)

    if (stale.length > 0) {
      await svc
        .from('send_queue')
        .update({
          status: 'canceled',
          error: 'Superseded — this company was emailed at another address.',
          updated_at: now,
        })
        .in('contact_id', stale)
        .eq('status', 'queued')

      const { error: sweepErr } = await svc.from('contacts').update({ status: 'skip' }).in('id', stale)
      if (sweepErr) {
        return {
          id: sentId,
          sentAt: now,
          warning: `Sent, but could not archive ${stale.length} duplicate contact(s): ${sweepErr.message}`,
        }
      }
    }
  }

  return { id: sentId, sentAt: now }
}
