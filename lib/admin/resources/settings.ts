import { supabaseBrowser } from '@/lib/supabase/browser'

// Browser-only data layer for the Outreach Studio APP CONFIG (the Settings tab).
// Replicates app/api/admin/settings 1:1, but talks to Supabase directly through the
// authenticated admin session (supabaseBrowser) — RLS (`is_admin()`) is the security
// boundary, never a service-role key or x-admin-secret.
//
//   faviconUrl → public_profile.favicon_url (whole-site browser-tab icon)
//   dailyCap   → app_settings.daily_cap     (outreach send cap, clamped server-side)
//
// The creator identity (name/handle/niche/etc.) lives on the Profile tab; this owns
// only app config.

// The shape readSettings returns — mirrors the GET route's response body exactly.
export interface SettingsShape {
  faviconUrl: string
  dailyCap: number
}

// Whitelisted patch accepted by saveSettings (mirrors the PUT route's accepted keys).
// Only keys present on the patch are written, so saving is always a partial update.
export interface SettingsSavePatch {
  faviconUrl?: string
  dailyCap?: number
}

// Replicates GET /api/admin/settings: read public_profile (id=1) favicon_url +
// app_settings (id=1) daily_cap. Throws only on the profile read error (the route
// returns 500 there; the settings read falls back to the 20 default, as the route did).
export async function readSettings(): Promise<SettingsShape> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const [profileRes, settingsRes] = await Promise.all([
    sb.from('public_profile').select('favicon_url').eq('id', 1).maybeSingle(),
    sb.from('app_settings').select('daily_cap').eq('id', 1).maybeSingle(),
  ])
  if (profileRes.error) throw new Error(profileRes.error.message)

  return {
    faviconUrl: profileRes.data?.favicon_url ?? '',
    dailyCap: settingsRes.data?.daily_cap ?? 20,
  }
}

// Replicates PUT /api/admin/settings: favicon → public_profile.favicon_url; dailyCap →
// app_settings.daily_cap (clamped 1..200, server-side). Only keys present in the patch
// are written. Throws if nothing updatable was provided or on a write error (RLS gates).
export async function saveSettings(patch: SettingsSavePatch): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const b = patch as Record<string, unknown>
  let touched = false

  // Favicon → public_profile.favicon_url (a dedicated column, not the seo blob).
  if ('faviconUrl' in b) {
    const { error } = await sb
      .from('public_profile')
      .update({ favicon_url: b.faviconUrl, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) throw new Error(error.message)
    touched = true
  }

  // Daily send cap → app_settings (outreach concern, clamped server-side).
  if ('dailyCap' in b) {
    const cap = Math.max(1, Math.min(200, Math.trunc(Number(b.dailyCap) || 0)))
    const { error } = await sb
      .from('app_settings')
      .update({ daily_cap: cap, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) throw new Error(error.message)
    touched = true
  }

  if (!touched) throw new Error('No updatable fields provided.')
}
