import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Browser Supabase client for the authenticated /admin SPA. Uses ONLY the anon
// (publishable) key — RLS + the logged-in admin's session are the security boundary,
// never a service-role key in the browser. The session is persisted + auto-refreshed
// so the admin stays signed in across visits.
//
// Distinct from lib/supabase/public.ts (server-side, no session) — this one is for
// client components under app/admin only.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabaseBrowser: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'simxmargo-admin-auth',
        },
      })
    : null

export const isBrowserSupabaseConfigured = Boolean(url && anon)
