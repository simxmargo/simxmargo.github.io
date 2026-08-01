import { supabaseBrowser } from '@/lib/supabase/browser'
import { fnErrorMessage } from '@/lib/admin/fnError'

// Browser-only data layer for the outreach SENDING ACCOUNT (Settings → Sending account).
//
// Unlike every other admin resource, this one does NOT select from its table. The
// `gmail_account` row holds a Gmail refresh token — a long-lived credential to send
// mail as the user — so migration 0012 gives that table RLS-with-no-policies
// (deny-all, service-role only). The browser gets exactly two things:
//
//   read  → rpc('sending_account_status')  — SECURITY DEFINER, admin-gated, and it
//           selects an explicit column list that omits refresh_token.
//   write → the `gmail-oauth` Edge Function (connect / test / disconnect), which
//           holds the service-role key server-side.
//
// There is deliberately no code path here that could ever receive the token.

// PostgREST's "function not in the schema cache" error. Migration 0012 ships in the
// repo but is applied by hand (`npm run db:apply`), so a studio running ahead of the
// database must degrade to a "setup pending" card rather than a red error banner.
const FN_MISSING = 'PGRST202'

export interface SendingAccount {
  connected: boolean
  email: string
  connectedAt: string | null
  lastSendAt: string | null
  needsReauth: boolean
  reauthReason: string
  /** true when migration 0012 hasn't been applied yet — the UI shows a setup hint. */
  setupPending: boolean
}

const DISCONNECTED: SendingAccount = {
  connected: false,
  email: '',
  connectedAt: null,
  lastSendAt: null,
  needsReauth: false,
  reauthReason: '',
  setupPending: false,
}

export async function readSendingAccount(): Promise<SendingAccount> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb.rpc('sending_account_status').maybeSingle()

  if (error) {
    if (error.code === FN_MISSING) return { ...DISCONNECTED, setupPending: true }
    throw new Error(error.message)
  }

  // Zero rows = the RPC's `is_admin()` guard said no. Fail closed, don't throw:
  // the card simply reads "not connected" rather than leaking that a row exists.
  if (!data) return DISCONNECTED

  const r = data as Record<string, unknown>
  return {
    connected: r.connected === true,
    email: typeof r.email === 'string' ? r.email : '',
    connectedAt: typeof r.connected_at === 'string' ? r.connected_at : null,
    lastSendAt: typeof r.last_send_at === 'string' ? r.last_send_at : null,
    needsReauth: r.needs_reauth === true,
    reauthReason: typeof r.reauth_reason === 'string' ? r.reauth_reason : '',
    setupPending: false,
  }
}

// Shared invoke wrapper: every action posts `{ action }` to the same function and
// unwraps our `{ error }` body (see lib/admin/fnError.ts) instead of surfacing
// supabase-js's generic "non-2xx status code".
async function callGmailOAuth<T>(action: string): Promise<T> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb.functions.invoke('gmail-oauth', { body: { action } })
  if (error) throw new Error(await fnErrorMessage(error, 'Could not reach the sending-account service.'))
  return data as T
}

// Mints a single-use state row server-side and returns Google's consent URL.
// The caller opens it in a popup — see SettingsPage for the popup-blocker dance.
export async function startGmailConnect(): Promise<string> {
  const { url } = await callGmailOAuth<{ url?: string }>('start')
  if (!url) throw new Error('Google did not return a consent URL.')
  return url
}

// Proves the stored refresh token still works by exchanging it for an access token.
// Sends no mail. This is the cheap way to catch the "OAuth app left in Testing mode
// → refresh token expired after 7 days" trap before a real send silently fails.
export async function testGmailConnection(): Promise<{ email: string }> {
  const r = await callGmailOAuth<{ email?: string }>('test')
  return { email: r.email ?? '' }
}

// Revokes the grant at Google (best effort) and clears the stored token.
export async function disconnectGmail(): Promise<void> {
  await callGmailOAuth<{ ok?: boolean }>('disconnect')
}
