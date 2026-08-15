// `drain-queue` Edge Function — the worker behind SCHEDULED outreach sending.
//
// pg_cron calls this every minute of the cron envelope (00:00–09:59 UTC — see
// migration 0017). Each tick it: enforces the kill switch and the PH-morning send
// window, sweeps Gmail for bounces once a day, tops the queue up from validated
// high-confidence contacts (auto-queue), and then — with a coin-flip's worth of
// jitter — sends AT MOST ONE queued pitch through the same `sendPitch()` the admin
// UI uses.
//
// ── Why one send per tick, with random skips ────────────────────────────────────
// The old drain claimed 5 rows per tick, which produced 14 pitches in a 2-minute
// burst at 1 AM — from a free @gmail.com account, that is the signature Gmail's
// abuse heuristics are trained on. One send per tick with a ~45% skip chance makes
// the outbox read as: a human, in the morning, sending a pitch every couple of
// minutes. The daily budget (warm-up ramp × daily cap, enforced in sendPitch) is
// the ceiling; jitter is the cadence.
//
// ── Why this is NOT admin-gated ─────────────────────────────────────────────────
// The caller is a database cron job, not a browser — there is no admin session to
// present. Authorization is instead a shared secret in `x-cron-secret`, compared in
// CONSTANT TIME against the CRON_SECRET Edge Function secret. Anyone who can't
// present it gets a 401 and no work happens. The secret is generated at setup and
// lives only in Supabase (Edge Function secret + the cron command); it is never
// committed — this repo is public.
//
// ── Why claiming is a database function ─────────────────────────────────────────
// Two cron ticks can overlap (a slow Gmail call, a redeploy). `claim_due_sends()`
// flips rows to 'sending' in the same statement that selects them, under FOR UPDATE
// SKIP LOCKED, so a second invocation literally cannot see rows the first one took.
// Doing this as select-then-update from here would leave a race that double-sends to
// real brands — the single worst failure this system can have.
//
// `{force:true}` in the POST body bypasses the WINDOW and JITTER gates only (for
// operator testing with the secret) — the pause switch, cap, and validation always
// bind.
//
// Deploy (no JWT verification — the cron caller has no JWT):
//   ./node_modules/.bin/supabase functions deploy drain-queue \
//     --project-ref zzgypushqcpchfxrjexc --use-api --no-verify-jwt

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import {
  effectiveDailyCap,
  loadSendSettings,
  sendPitch,
  SendBlockedError,
  sentInLast24h,
  type SendSettings,
} from '../_shared/sendPitch.ts'
import { googleCreds, refreshAccessToken } from '../_shared/gmail.ts'
import { sweepBounces } from '../_shared/bounces.ts'
import { buildDraft, resolveTemplate } from '../../../lib/emailTemplate.ts'
import { mailableReason } from '../../../lib/outreach/pickEmail.ts'
import { checkDomainDeliverable, emailDomain } from '../../../lib/outreach/validateEmail.ts'
import type { Contact, CreatorProfile } from '../../../lib/types.ts'

// Chance a tick that COULD send actually does. The gaps this produces (1 minute,
// 1 minute, 4 minutes, 2…) are what a person at a keyboard looks like.
const SEND_PROBABILITY = 0.55

// Auto-queue tops up at most this many contacts per tick. MX lookups are network
// calls; bounding them keeps every tick comfortably inside the cron's HTTP timeout,
// and the budget fills within the first few ticks of the window anyway.
const AUTO_QUEUE_PER_TICK = 5

// Domain MX verdicts are effectively static; re-check monthly.
const MX_CACHE_DAYS = 30

// Backoff when the daily cap is the blocker. The pitch is fine, the clock isn't — so
// the row goes back to 'queued' rather than 'failed'.
const CAP_RETRY_MINUTES = 30

// Kill-switch thresholds: pause outright at this many 7-day bounces, or at an 8%
// bounce rate once there are enough sends for a rate to mean anything.
const BOUNCE_PAUSE_COUNT = 3
const BOUNCE_PAUSE_RATE = 0.08
const BOUNCE_RATE_MIN_SENDS = 10

// Asia/Manila is UTC+8 with no DST — fixed arithmetic beats shipping tz data into
// an edge bundle. All "PH" values below are derived by shifting the clock 8h and
// reading UTC fields.
const PH_OFFSET_MS = 8 * 60 * 60 * 1000

const phClock = () => new Date(Date.now() + PH_OFFSET_MS)

/** UTC instant of today's midnight in Manila — the "have we done X today" anchor. */
function phDayStartIso(): string {
  const ph = phClock()
  return new Date(
    Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate()) - PH_OFFSET_MS,
  ).toISOString()
}

interface QueueRow {
  id: string
  contact_id: string
  subject: string
  body: string
  attempts: number
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Length-independent comparison. A plain `===` on a secret leaks its prefix through
// timing; this is cheap enough that there's no reason to accept that.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function finish(
  svc: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await svc
    .from('send_queue')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
}

// ── Bounce sweep (daily, scope-gated) ─────────────────────────────────────────────

interface GmailAccountRow {
  email: string
  refresh_token: string | null
  scope: string
  last_bounce_check_at: string | null
  needs_reauth: boolean
}

async function pauseSending(svc: SupabaseClient, reason: string): Promise<void> {
  await svc
    .from('app_settings')
    .update({ sending_paused: true, paused_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', 1)
}

// Runs at most once per PH day, and only when the granted scope can read the inbox.
// Returns true if it tripped the kill switch (the tick should stop sending).
async function dailyBounceCheck(svc: SupabaseClient, account: GmailAccountRow): Promise<boolean> {
  if (!account.refresh_token || !account.scope.includes('gmail.readonly')) return false
  if (account.last_bounce_check_at && account.last_bounce_check_at >= phDayStartIso()) return false

  const creds = googleCreds()
  if (!creds) return false

  // Stamp BEFORE sweeping: a Gmail hiccup must degrade to "try again tomorrow",
  // not "hammer the API every minute of the window".
  const now = new Date().toISOString()
  await svc.from('gmail_account').update({ last_bounce_check_at: now, updated_at: now }).eq('id', 1)

  let bounced: string[] = []
  try {
    const token = (await refreshAccessToken(creds, account.refresh_token)).accessToken
    bounced = (await sweepBounces(svc, token, account.email)).bounced
  } catch {
    return false // sweep is best-effort; sending is governed by its own guards
  }
  if (bounced.length === 0) return false

  // Kill-switch math over a 7-day horizon, counting each dead address once
  // (sweepBounces only reports contacts newly flipped to 'bounced').
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [{ count: sends7d }, { count: bounced7d }] = await Promise.all([
    svc.from('contacts').select('id', { count: 'exact', head: true }).gte('last_emailed_at', since),
    svc
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'bounced')
      .gte('last_emailed_at', since),
  ])
  const sends = sends7d ?? 0
  const dead = bounced7d ?? 0

  if (dead >= BOUNCE_PAUSE_COUNT || (sends >= BOUNCE_RATE_MIN_SENDS && dead / sends > BOUNCE_PAUSE_RATE)) {
    await pauseSending(
      svc,
      `Auto-paused: ${dead} of ${sends} addresses emailed in the last 7 days bounced. ` +
        `Review the bounced contacts (their alternates may hold a live address), then unpause in Settings.`,
    )
    return true
  }
  return false
}

// ── Auto-queue: validated high-confidence leads → today's queue ──────────────────

interface CandidateRow {
  id: string
  brand: string
  email: string
  confidence: number | null
}

async function skipContact(svc: SupabaseClient, id: string, note: string): Promise<void> {
  await svc.from('contacts').update({ status: 'skip', notes: note }).eq('id', id)
}

// MX verdict for a domain, through the domain_checks cache (migration 0017).
// Three-valued: only a definite FALSE blocks — see lib/outreach/validateEmail.ts.
async function domainDeliverable(svc: SupabaseClient, domain: string): Promise<boolean | null> {
  const { data: cached } = await svc
    .from('domain_checks')
    .select('has_mx, checked_at')
    .eq('domain', domain)
    .maybeSingle()

  const freshAfter = Date.now() - MX_CACHE_DAYS * 24 * 60 * 60 * 1000
  if (cached && Date.parse(cached.checked_at) > freshAfter && cached.has_mx !== null) {
    return cached.has_mx
  }

  const r = await checkDomainDeliverable(domain)
  await svc
    .from('domain_checks')
    .upsert({ domain, has_mx: r.deliverable, checked_at: new Date().toISOString() })
  return r.deliverable
}

// The pitch is composed HERE with the same buildDraft + saved template the Compose
// drawer uses — an auto-queued email and a hand-queued one are the same email.
async function loadComposer(svc: SupabaseClient) {
  const { data } = await svc
    .from('public_profile')
    .select('display_name, handle, niche, location, audience, media_kit_url, content')
    .eq('id', 1)
    .maybeSingle()

  const content = (data?.content ?? {}) as Record<string, unknown>
  const profile: CreatorProfile = {
    name: data?.display_name ?? '',
    handle: data?.handle ?? '',
    niche: data?.niche ?? '',
    location: data?.location ?? '',
    audience: data?.audience ?? '',
    mediaKitUrl: data?.media_kit_url ?? '',
    followers: '',
    avgViews: '',
    engagement: '',
    realEmail: '',
    mailingAddress: '',
  }
  return { profile, template: resolveTemplate(content.emailTemplate) }
}

async function autoQueue(
  svc: SupabaseClient,
  settings: SendSettings,
  budget: number,
): Promise<number> {
  if (!settings.autoQueue || budget <= 0) return 0

  const { count: liveCount } = await svc
    .from('send_queue')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'sending'])
  const need = Math.min(budget - (liveCount ?? 0), AUTO_QUEUE_PER_TICK)
  if (need <= 0) return 0

  // Best addresses first. `.gte` on confidence excludes NULL (unranked legacy rows)
  // by SQL semantics — exactly right: never auto-send to an address nothing vouched for.
  const { data: rows } = await svc
    .from('contacts')
    .select('id, brand, email, confidence')
    .eq('status', 'new')
    .gte('confidence', settings.autoQueueMinConfidence)
    .order('confidence', { ascending: false })
    .limit(12)

  const candidates = (rows ?? []) as CandidateRow[]
  if (candidates.length === 0) return 0

  const { profile, template } = await loadComposer(svc)
  let queued = 0

  for (const c of candidates) {
    if (queued >= need) break

    const shapeProblem = mailableReason(c.email)
    if (shapeProblem) {
      await skipContact(svc, c.id, `Auto-skipped: ${shapeProblem}.`)
      continue
    }

    const deliverable = await domainDeliverable(svc, emailDomain(c.email))
    if (deliverable === false) {
      await skipContact(svc, c.id, 'Auto-skipped: domain cannot receive mail (no MX).')
      continue
    }

    const draft = buildDraft({ brand: c.brand } as Contact, profile, template)
    const { error } = await svc.from('send_queue').insert({
      contact_id: c.id,
      subject: draft.subject,
      body: draft.body,
      status: 'queued',
      scheduled_for: new Date().toISOString(),
    })

    if (error) {
      // 23505 = one-live-row-per-contact (already queued — fine). The suppression
      // trigger's raise arrives as a generic error; match its wording.
      if (error.code !== '23505' && /suppress/i.test(error.message)) {
        await skipContact(svc, c.id, 'Auto-skipped: address is on the suppression list.')
      }
      continue
    }

    await svc.from('contacts').update({ status: 'queued' }).eq('id', c.id)
    queued++
  }
  return queued
}

// ── The tick ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const expected = Deno.env.get('CRON_SECRET') ?? ''
  if (!expected) return json({ error: 'CRON_SECRET is not configured.' }, 503)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', expected)) {
    return json({ error: 'Not authorized.' }, 401)
  }

  const force = Boolean((await req.json().catch(() => ({})))?.force)
  const svc = serviceClient()

  const settings = await loadSendSettings(svc)
  if (settings.sendingPaused) {
    return json({ ok: true, skipped: 'paused', reason: settings.pausedReason })
  }

  // The morning window, in PH wall-clock terms. Everything queued outside it —
  // including the UI's "Send now" — simply waits here until the window opens.
  const ph = phClock()
  const hour = ph.getUTCHours()
  const day = ph.getUTCDay() // 0 = Sunday
  if (!force) {
    if (settings.sendWeekdaysOnly && (day === 0 || day === 6)) {
      return json({ ok: true, skipped: 'weekend' })
    }
    if (hour < settings.sendWindowStart || hour >= settings.sendWindowEnd) {
      return json({ ok: true, skipped: 'window' })
    }
  }

  // Rescue anything a dead worker abandoned before claiming new work, so a stuck row
  // rejoins this same tick instead of waiting for the next one.
  await svc.rpc('requeue_stuck_sends')

  const { data: accountRow } = await svc
    .from('gmail_account')
    .select('email, refresh_token, scope, last_bounce_check_at, needs_reauth')
    .eq('id', 1)
    .maybeSingle()

  if (accountRow && (await dailyBounceCheck(svc, accountRow as GmailAccountRow))) {
    return json({ ok: true, skipped: 'paused', reason: 'Bounce threshold tripped this tick.' })
  }

  const cap = await effectiveDailyCap(svc, settings)
  const sent24h = await sentInLast24h(svc)
  const budget = cap - sent24h
  if (budget <= 0) {
    return json({ ok: true, skipped: 'capped', cap, sent24h })
  }

  const autoQueued = await autoQueue(svc, settings, budget)

  // The jitter gate — AFTER the bookkeeping above so the queue is stocked and swept
  // even on a tick that chooses silence.
  if (!force && Math.random() > SEND_PROBABILITY) {
    return json({ ok: true, skipped: 'jitter', autoQueued })
  }

  const { data: claimed, error: claimErr } = await svc.rpc('claim_due_sends', { p_limit: 1 })
  if (claimErr) return json({ error: claimErr.message }, 500)

  const rows = (claimed ?? []) as QueueRow[]
  if (rows.length === 0) return json({ ok: true, claimed: 0, sent: 0, autoQueued })

  let sent = 0
  const failures: { id: string; error: string }[] = []

  for (const row of rows) {
    // The recipient is read HERE rather than snapshotted at queue time: if the address
    // was corrected in the five minutes since queuing, the corrected one should be used.
    const { data: contact } = await svc
      .from('contacts')
      .select('email, brand')
      .eq('id', row.contact_id)
      .maybeSingle()

    if (!contact?.email) {
      await finish(svc, row.id, { status: 'failed', error: 'The contact has no email address.' })
      failures.push({ id: row.id, error: 'no email' })
      continue
    }

    try {
      const res = await sendPitch(svc, {
        to: contact.email,
        subject: row.subject,
        text: row.body,
        contactId: row.contact_id,
      })

      await finish(svc, row.id, {
        status: 'sent',
        sent_at: res.sentAt,
        gmail_message_id: res.id,
        error: res.warning ?? null,
      })
      sent++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)

      // A duplicate is not a failure and must never be retried — retrying can only
      // ever reach the same verdict. Cancel the row and archive the contact so the
      // company stops appearing in the working list at all.
      if (e instanceof SendBlockedError && e.code === 'duplicate_company') {
        await finish(svc, row.id, { status: 'canceled', error: msg })
        await svc.from('contacts').update({ status: 'skip' }).eq('id', row.contact_id)
        continue
      }

      // Capped and paused are not failures — the pitch is fine, the clock (or the
      // kill switch) isn't. Back to 'queued' without burning a retry.
      if (e instanceof SendBlockedError && (e.code === 'capped' || e.code === 'paused')) {
        await finish(svc, row.id, {
          status: 'queued',
          attempts: Math.max(0, row.attempts - 1),
          scheduled_for: new Date(Date.now() + CAP_RETRY_MINUTES * 60_000).toISOString(),
          error: msg,
        })
        continue
      }

      // Build the patch explicitly rather than passing `scheduled_for: undefined` —
      // that relies on JSON.stringify dropping the key, which is true but invisible.
      const giveUp = row.attempts >= 3
      await finish(svc, row.id, {
        status: giveUp ? 'failed' : 'queued',
        error: msg,
        ...(giveUp ? {} : { scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString() }),
      })
      failures.push({ id: row.id, error: msg })
    }
  }

  return json({ ok: true, claimed: rows.length, sent, autoQueued, failures })
})
