// `gmail-oauth` Edge Function — connect / test / disconnect the outreach SENDING
// ACCOUNT (docs/BACKEND_DESIGN.md §6b). This is the seam the Settings page's
// "Connect Gmail" button drives.
//
// ── Routes ──────────────────────────────────────────────────────────────────────
//   POST  { action: 'start' }       → admin-only. Mints a single-use state row and
//                                     returns the Google consent URL for the popup.
//   GET   /callback?code=&state=    → Google's browser redirect. NOT admin-gated by
//                                     header (see below); authorized by the state row.
//   POST  { action: 'test' }        → admin-only. Refreshes an access token to prove
//                                     the stored refresh token is still valid.
//   POST  { action: 'disconnect' }  → admin-only. Revokes at Google + clears the row.
//   POST  { action: 'status' }      → admin-only. NOT used by the UI (the studio reads
//                                     `sending_account_status()` directly, which needs
//                                     no function round trip). Kept as the curl/debug
//                                     surface: it answers from the SAME service-role
//                                     read the other actions use, so it tells you
//                                     whether a connect landed even when the RPC is
//                                     missing because migration 0012 hasn't run.
//
// ── Why this one deploys with --no-verify-jwt ───────────────────────────────────
// Google redirects the USER'S BROWSER to the callback. A top-level navigation cannot
// carry an Authorization header, so platform JWT verification would 401 every
// successful consent. Authorization therefore moves INTO the function:
//   • every POST action calls `requireAdmin()` (anon client + caller JWT + is_admin())
//   • the GET callback presents a `state` that only an admin POST could have created,
//     consumed ATOMICALLY (update ... where used_at is null returning) so a replayed
//     or forged state is rejected. Rows expire in 10 minutes.
// Losing `verify_jwt` costs nothing real: as `_shared/auth.ts` explains, the anon key
// is itself a project-signed JWT, so verify_jwt never proved authorization anyway.
//
// Deploy (note the flag — this function MUST NOT use the default):
//   ./node_modules/.bin/supabase functions deploy gmail-oauth \
//     --project-ref zzgypushqcpchfxrjexc --use-api --no-verify-jwt
//
// Secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET (+ optional STUDIO_URL for the
// "back to the studio" link on the success page). SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are auto-injected.
//
// Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs
// must contain EXACTLY:
//   https://<project-ref>.supabase.co/functions/v1/gmail-oauth/callback

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import {
  consentUrl,
  exchangeCode,
  fetchGoogleEmail,
  googleCreds,
  GoogleAuthError,
  refreshAccessToken,
  revokeToken,
  type GoogleCreds,
} from '../_shared/gmail.ts'

const NOT_CONFIGURED =
  'Gmail OAuth is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET as Edge Function secrets — see docs/GMAIL_SENDING_SETUP.md.'

// ── Small helpers ───────────────────────────────────────────────────────────────

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// The redirect URI must byte-match what's registered in Google Cloud Console AND be
// identical between the consent request and the code exchange — so derive it in one
// place from the project URL rather than hand-writing it twice.
function redirectUri(): string {
  return `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/gmail-oauth/callback`
}

// 256 bits of CSPRNG hex. This value is the ONLY thing standing between a stranger
// and the unauthenticated callback, so it is not a place to economize on entropy.
function newState(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// The callback answers a top-level browser navigation, so it renders a page rather
// than JSON. Self-contained (no external CSS/fonts) and it never redirects to a
// user-supplied URL — the only link comes from the operator-set STUDIO_URL secret.
function page(title: string, detail: string, ok: boolean): Response {
  const studio = Deno.env.get('STUDIO_URL') ?? ''
  const back = /^https?:\/\//.test(studio)
    ? `<a class="back" href="${esc(studio)}">← Back to the studio</a>`
    : ''
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:28px;
         background:#141210; color:#f3eee4;
         font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif }
  .card { max-width:420px; text-align:center; background:#1c1917; border:1px solid #2c2723;
          border-radius:18px; padding:34px 30px }
  .mark { width:44px; height:44px; margin:0 auto 18px; border-radius:12px; display:grid;
          place-items:center; font-size:22px; background:${ok ? 'rgba(93,166,116,.16)' : 'rgba(196,90,74,.16)'};
          color:${ok ? '#7fc796' : '#f0a58f'} }
  h1 { font-size:19px; margin:0 0 10px; font-weight:600 }
  p { margin:0; color:#a49c90; font-size:14px }
  .back { display:inline-block; margin-top:22px; color:#d9a25e; text-decoration:none; font-weight:600; font-size:13.5px }
  .back:hover { text-decoration:underline }
</style></head><body><div class="card">
  <div class="mark">${ok ? '✓' : '!'}</div>
  <h1>${esc(title)}</h1>
  <p>${esc(detail)}</p>
  ${back}
</div></body></html>`
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

// ── GET /callback — Google's redirect ───────────────────────────────────────────

async function handleCallback(url: URL): Promise<Response> {
  // The user hit "Cancel" on the consent screen, or Google refused.
  const denied = url.searchParams.get('error')
  if (denied) {
    return page('Connection cancelled', `Google reported: ${denied}. Nothing was changed.`, false)
  }

  const code = url.searchParams.get('code') ?? ''
  const state = url.searchParams.get('state') ?? ''
  if (!code || !state) return page('Invalid callback', 'Missing code or state. Start the connection again.', false)

  const creds = googleCreds()
  if (!creds) return page('Not configured', NOT_CONFIGURED, false)

  const svc = serviceClient()

  // Consume the nonce ATOMICALLY. The `used_at is null` predicate is inside the
  // UPDATE, so two concurrent callbacks with the same state can't both win — the
  // second one updates zero rows and is rejected here.
  const { data: claimed, error: claimErr } = await svc
    .from('oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state', state)
    .eq('purpose', 'gmail')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('state')
    .maybeSingle()

  if (claimErr) return page('Something went wrong', claimErr.message, false)
  if (!claimed) {
    return page(
      'This link has expired',
      'That connection link was already used or is older than 10 minutes. Open Settings and click Connect Gmail again.',
      false,
    )
  }

  let email = ''
  let scope = ''
  try {
    const tokens = await exchangeCode(creds, code, redirectUri())
    if (!tokens.refreshToken) {
      // access_type=offline + prompt=consent should make this impossible; if it
      // happens, the grant is unusable for unattended sending, so refuse to store it.
      return page(
        'Google withheld the refresh token',
        'Remove this app at myaccount.google.com/permissions, then connect again.',
        false,
      )
    }
    scope = tokens.scope
    email = await fetchGoogleEmail(tokens.accessToken)

    const { error: saveErr } = await svc
      .from('gmail_account')
      .update({
        email,
        refresh_token: tokens.refreshToken,
        scope,
        connected_at: new Date().toISOString(),
        needs_reauth: false,
        reauth_reason: '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    if (saveErr) return page('Could not save the connection', saveErr.message, false)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return page('Google rejected the connection', msg, false)
  }

  // Housekeeping: drop spent/expired nonces so the table can't grow unbounded.
  await svc.from('oauth_states').delete().lt('expires_at', new Date().toISOString())

  return page(
    'Gmail connected',
    email
      ? `${email} is now your sending account. You can close this tab.`
      : 'Your sending account is connected. You can close this tab.',
    true,
  )
}

// ── POST actions (admin-gated) ──────────────────────────────────────────────────

async function handleStart(creds: GoogleCreds): Promise<Response> {
  const svc = serviceClient()
  const state = newState()

  const { error } = await svc.from('oauth_states').insert({ state, purpose: 'gmail' })
  if (error) return json({ error: error.message }, 500)

  return json({ url: consentUrl(creds, redirectUri(), state) })
}

async function handleTest(creds: GoogleCreds): Promise<Response> {
  const svc = serviceClient()
  const { data, error } = await svc
    .from('gmail_account')
    .select('email, refresh_token')
    .eq('id', 1)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!data?.refresh_token) return json({ error: 'No sending account is connected.' }, 400)

  try {
    await refreshAccessToken(creds, data.refresh_token)
  } catch (e) {
    const invalid = e instanceof GoogleAuthError && e.invalidGrant
    const msg = e instanceof Error ? e.message : String(e)
    // Only a permanent invalid_grant flips the flag — a transient network blip must
    // not tell the user to reconnect a perfectly good account.
    if (invalid) {
      await svc
        .from('gmail_account')
        .update({
          needs_reauth: true,
          reauth_reason: 'Google rejected the saved token. Reconnect the account.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
    }
    return json({ error: msg, needsReauth: invalid }, 502)
  }

  // A successful refresh clears any stale "reconnect needed" state.
  await svc
    .from('gmail_account')
    .update({ needs_reauth: false, reauth_reason: '', updated_at: new Date().toISOString() })
    .eq('id', 1)

  return json({ ok: true, email: data.email ?? '' })
}

async function handleDisconnect(): Promise<Response> {
  const svc = serviceClient()
  const { data, error } = await svc
    .from('gmail_account')
    .select('refresh_token')
    .eq('id', 1)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)

  // Best effort: a failed revoke must not strand the UI in "connected".
  let revoked = false
  if (data?.refresh_token) revoked = await revokeToken(data.refresh_token)

  const { error: clearErr } = await svc
    .from('gmail_account')
    .update({
      email: '',
      refresh_token: null,
      scope: '',
      connected_at: null,
      needs_reauth: false,
      reauth_reason: '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (clearErr) return json({ error: clearErr.message }, 500)

  return json({ ok: true, revoked })
}

async function handleStatus(): Promise<Response> {
  const svc = serviceClient()
  const { data, error } = await svc
    .from('gmail_account')
    .select('email, refresh_token, connected_at, last_send_at, needs_reauth, reauth_reason')
    .eq('id', 1)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)

  return json({
    connected: Boolean(data?.refresh_token),
    email: data?.email ?? '',
    connectedAt: data?.connected_at ?? null,
    lastSendAt: data?.last_send_at ?? null,
    needsReauth: Boolean(data?.needs_reauth),
    reauthReason: data?.reauth_reason ?? '',
  })
}

// ── Entry point ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre

  const url = new URL(req.url)

  // The one unauthenticated route. Everything below this line is admin-only.
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    return await handleCallback(url)
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const denied = await requireAdmin(req)
  if (denied) return denied

  const creds = googleCreds()

  let action = ''
  try {
    const body = await req.json()
    action = typeof body?.action === 'string' ? body.action : ''
  } catch {
    /* empty body → falls through to the unknown-action 400 */
  }

  switch (action) {
    case 'status':
      return await handleStatus() // readable even without OAuth creds
    case 'start':
      return creds ? await handleStart(creds) : json({ error: NOT_CONFIGURED }, 503)
    case 'test':
      return creds ? await handleTest(creds) : json({ error: NOT_CONFIGURED }, 503)
    case 'disconnect':
      return await handleDisconnect() // clearing the row must work even if creds vanish
    default:
      return json({ error: `Unknown action: ${action || '(none)'}` }, 400)
  }
})
