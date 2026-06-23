// The single Supabase browser client. Uses ONLY the publishable anon key + URL
// (safe to ship — Row Level Security guards the data). Never import service-role
// or DB credentials here; those live server-side (see docs/BACKEND_DESIGN.md §8).
//
// If the env vars are absent, `supabase` is null and `isSupabaseConfigured` is
// false — the store then falls back to mock data so the UI still runs offline.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null
