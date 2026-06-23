import { createClient } from '@supabase/supabase-js'

// Anon Supabase client for SERVER-SIDE public reads (the media kit page + the
// public collab route). Uses only the publishable anon key, so RLS is the
// security boundary — it can read published/visible rows and insert a collab
// inquiry, nothing more. Safe to import anywhere on the server; no session.
export const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
