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
// Same file the Settings preview uses, so what you see while editing is what sends.
import { stripMarks, textToHtml } from '../../../lib/emailBody.ts'

const DEFAULT_DAILY_CAP = 20

// Refusals that are NOT "the send failed" — the message never left, and the right
// response differs per code. `capped` in particular must be retried later, not marked
// failed: the pitch is fine, the clock isn't.
export type BlockedCode = 'not_configured' | 'no_account' | 'invalid_recipient' | 'capped'

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
async function sentInLast24h(svc: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await svc
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .gte('last_emailed_at', since)
  return count ?? 0
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
    const { data: settings } = await svc
      .from('app_settings')
      .select('daily_cap')
      .eq('id', 1)
      .maybeSingle()
    const cap = Number(settings?.daily_cap ?? DEFAULT_DAILY_CAP)
    const sent = await sentInLast24h(svc)
    if (sent >= cap) {
      throw new SendBlockedError(
        'capped',
        `Daily cap reached — ${sent} of ${cap} sent in the last 24 hours.`,
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
  }

  return { id: sentId, sentAt: now }
}
