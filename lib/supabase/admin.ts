import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabasePublic } from '@/lib/supabase/public'

// SERVER-ONLY service-role client. It BYPASSES RLS, so it must NEVER be imported
// by a client component or any module that reaches the browser bundle — only by
// passphrase-gated Route Handlers under app/api/admin/*. Lazy on purpose: the
// service-role key may be unset (it's not needed for Phases 1–4 public reads), so
// importing this module must not throw at build time — only calling it does.
let client: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Set it (and ADMIN_SECRET) in .env to enable admin writes.',
    )
  }
  client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

export const isAdminConfigured = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.ADMIN_SECRET,
)

// For admin READS: prefer the service-role client (sees unpublished/hidden rows +
// collab_inquiries, which anon cannot read), but fall back to the anon client so
// the admin UI still shows live public data before the service-role key is set.
// WRITES must always use getSupabaseAdmin() directly (no anon fallback).
export function getAdminReadClient(): SupabaseClient {
  try {
    return getSupabaseAdmin()
  } catch {
    return supabasePublic
  }
}
