// `send-email` Edge Function — admin-triggered sending (docs/BACKEND_DESIGN.md §6c).
//
// ── Routes (all POST, all admin-gated) ──────────────────────────────────────────
//   { action: 'preview' }
//       → the composed signature (html + text) exactly as a send would append it, so
//         Settings can show the real thing instead of a hand-maintained mockup.
//   { action: 'send', to, subject, text, contactId? }
//       → sends one message immediately. Used by "Send test email" and by "Send now"
//         / "Send again" in the outreach workspace.
//
// SCHEDULED sending does NOT come through here — that's `drain-queue`, driven by
// pg_cron. Both call the same `sendPitch()` so the two paths cannot diverge.
//
// Deploy (standard flags — unlike gmail-oauth this is NOT --no-verify-jwt):
//   ./node_modules/.bin/supabase functions deploy send-email \
//     --project-ref zzgypushqcpchfxrjexc --use-api

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { buildSignature } from '../_shared/signature.ts'
import { GoogleAuthError } from '../_shared/gmail.ts'
import { loadSignatureSource, sendPitch, SendBlockedError } from '../_shared/sendPitch.ts'

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function handlePreview(svc: SupabaseClient): Promise<Response> {
  return json({ ok: true, signature: buildSignature(await loadSignatureSource(svc)) })
}

interface SendBody {
  to?: unknown
  subject?: unknown
  text?: unknown
  contactId?: unknown
}

async function handleSend(svc: SupabaseClient, body: SendBody): Promise<Response> {
  try {
    const res = await sendPitch(svc, {
      to: typeof body.to === 'string' ? body.to : '',
      subject: typeof body.subject === 'string' ? body.subject : '',
      text: typeof body.text === 'string' ? body.text : '',
      contactId: typeof body.contactId === 'string' ? body.contactId : null,
    })
    return json({ ok: true, ...res })
  } catch (e) {
    // Distinct statuses so the UI can react differently: 429 is "wait", 400/503 are
    // "fix something", 502 is "Google said no".
    if (e instanceof SendBlockedError) {
      const status =
        e.code === 'capped' ? 429 : e.code === 'not_configured' || e.code === 'no_account' ? 503 : 400
      return json({ error: e.message, code: e.code }, status)
    }
    const invalid = e instanceof GoogleAuthError && e.invalidGrant
    return json({ error: e instanceof Error ? e.message : String(e), needsReauth: invalid }, 502)
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre

  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const denied = await requireAdmin(req)
  if (denied) return denied

  let body: SendBody & { action?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body → falls through to the unknown-action 400 */
  }

  const svc = serviceClient()
  const action = typeof body.action === 'string' ? body.action : ''

  switch (action) {
    case 'preview':
      return await handlePreview(svc)
    case 'send':
      return await handleSend(svc, body)
    default:
      return json({ error: `Unknown action: ${action || '(none)'}` }, 400)
  }
})
