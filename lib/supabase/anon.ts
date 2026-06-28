import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Session-less anonymous client for PUBLIC browser use (media-kit live reads + the
// public "Work with me" form insert). It deliberately carries NO auth session, so it
// only ever sees published/visible rows and can only do the RLS-allowed anon insert
// into collab_inquiries — never anything an admin session could. Distinct from
// lib/supabase/browser.ts (the authed admin client).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabaseAnon: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    : null
