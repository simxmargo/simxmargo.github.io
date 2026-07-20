import { supabaseBrowser } from '@/lib/supabase/browser'

// Browser-only data layer for the Outreach Studio APP CONFIG (the Settings tab).
// Talks to Supabase directly through the authenticated admin session
// (supabaseBrowser) — RLS (`is_admin()`) is the security boundary, never a
// service-role key or x-admin-secret.
//
//   dailyCap → app_settings.daily_cap (outreach send cap, clamped on write)
//
// The favicon moved to the Theme tab (Media Kit) and is owned by the profile
// resource (`saveProfile({ faviconUrl })` → public_profile.favicon_url); this
// module owns ONLY outreach app config.

// The shape readSettings returns.
export interface SettingsShape {
  dailyCap: number
}

// Whitelisted patch accepted by saveSettings. Only keys present on the patch
// are written, so saving is always a partial update.
export interface SettingsSavePatch {
  dailyCap?: number
}

// Read app_settings (id=1) daily_cap. Falls back to the 20 default when the
// row is missing; throws on a read error so the UI can surface it.
export async function readSettings(): Promise<SettingsShape> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb.from('app_settings').select('daily_cap').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)

  return { dailyCap: data?.daily_cap ?? 20 }
}

// Daily send cap → app_settings (outreach concern, clamped 1..200). Throws if
// nothing updatable was provided or on a write error (RLS gates).
export async function saveSettings(patch: SettingsSavePatch): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  if (!('dailyCap' in patch)) throw new Error('No updatable fields provided.')

  const cap = Math.max(1, Math.min(200, Math.trunc(Number(patch.dailyCap) || 0)))
  const { error } = await sb
    .from('app_settings')
    .update({ daily_cap: cap, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw new Error(error.message)
}
