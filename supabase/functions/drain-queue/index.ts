// `drain-queue` Edge Function — the worker behind SCHEDULED outreach sending.
//
// pg_cron calls this once a minute (migration 0013 + docs/GMAIL_SENDING_SETUP.md).
// It claims whatever is due, sends each one through the same `sendPitch()` the admin
// UI uses, and records the outcome per row.
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
// Deploy (no JWT verification — the cron caller has no JWT):
//   ./node_modules/.bin/supabase functions deploy drain-queue \
//     --project-ref zzgypushqcpchfxrjexc --use-api --no-verify-jwt

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { sendPitch, SendBlockedError } from '../_shared/sendPitch.ts'

// Small: a cron tick has a wall-clock budget, and sends are sequential to stay polite
// to Gmail. Anything not taken this minute is taken the next.
const BATCH = 5

// Backoff when the daily cap is the blocker. The pitch is fine, the clock isn't — so
// the row goes back to 'pending' rather than 'failed'.
const CAP_RETRY_MINUTES = 30

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

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const expected = Deno.env.get('CRON_SECRET') ?? ''
  if (!expected) return json({ error: 'CRON_SECRET is not configured.' }, 503)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', expected)) {
    return json({ error: 'Not authorized.' }, 401)
  }

  const svc = serviceClient()

  // Rescue anything a dead worker abandoned before claiming new work, so a stuck row
  // rejoins this same tick instead of waiting for the next one.
  await svc.rpc('requeue_stuck_sends')

  const { data: claimed, error: claimErr } = await svc.rpc('claim_due_sends', { p_limit: BATCH })
  if (claimErr) return json({ error: claimErr.message }, 500)

  const rows = (claimed ?? []) as QueueRow[]
  if (rows.length === 0) return json({ ok: true, claimed: 0, sent: 0 })

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

      // Capped is not a failure — push it out and try again later. Everything else
      // gets three attempts before we stop bothering a brand's inbox with retries.
      if (e instanceof SendBlockedError && e.code === 'capped') {
        await finish(svc, row.id, {
          status: 'queued',
          attempts: Math.max(0, row.attempts - 1), // a cap hit shouldn't burn a retry
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

  return json({ ok: true, claimed: rows.length, sent, failures })
})
