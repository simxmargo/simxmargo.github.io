// Shared admin gate for the studio's Edge Functions.
//
// Why this exists: Supabase's platform-level `verify_jwt` only proves the caller
// holds a token SIGNED BY THIS PROJECT — and the public anon key (embedded in the
// browser bundle) is exactly such a token. So `verify_jwt` alone lets ANY visitor
// invoke a function. Real authorization has to happen inside the function: build an
// anon client carrying the CALLER's JWT and ask the DB `rpc('is_admin')`. Never
// trust the client. This is the same gate `pull-videos/index.ts` applies inline.
//
// Call it FIRST in every credit-spending / service-role function, before any
// external fetch or privileged DB write:
//
//   const denied = await requireAdmin(req)
//   if (denied) return denied
//
// Returns `null` when the caller is the admin, or a ready 401/403/500 Response to
// return as-is otherwise.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json } from './http.ts'

export async function requireAdmin(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Not authorized.' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return json({ error: 'Missing Supabase env' }, 500)

  // Anon client + the caller's bearer token → is_admin() evaluates against THIS
  // user's auth.uid(). A service-role or anon-only call has no uid ⇒ is_admin() is
  // false, which is what we want (this gate is for the human admin / cron presenting
  // an admin session, not for unattended service-role traffic).
  const authed = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: isAdmin, error } = await authed.rpc('is_admin')
  if (error || isAdmin !== true) return json({ error: 'Admin only.' }, 403)

  return null
}
