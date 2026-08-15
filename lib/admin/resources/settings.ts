import { supabaseBrowser } from '@/lib/supabase/browser'

// Browser-only data layer for the Outreach Studio APP CONFIG (the Settings tab).
// Talks to Supabase directly through the authenticated admin session
// (supabaseBrowser) — RLS (`is_admin()`) is the security boundary, never a
// service-role key or x-admin-secret.
//
//   dailyCap  → app_settings.daily_cap (outreach send cap, clamped on write)
//   safety    → app_settings.* knobs from migration 0017 (pause, auto-queue,
//               send window). ENFORCED server-side in drain-queue/sendPitch —
//               these fields only edit the knobs, they are not the guard.
//
// The favicon moved to the Theme tab (Media Kit) and is owned by the profile
// resource (`saveProfile({ faviconUrl })` → public_profile.favicon_url); this
// module owns ONLY outreach app config.

// The shape readSettings returns.
export interface SettingsShape {
  dailyCap: number
  warmupStart: number
  sendingPaused: boolean
  pausedReason: string
  autoQueue: boolean
  autoQueueMinConfidence: number
  sendWeekdaysOnly: boolean
  sendWindowStart: number
  sendWindowEnd: number
}

// Whitelisted patch accepted by saveSettings. Only keys present on the patch
// are written, so saving is always a partial update. `pausedReason` is set
// alongside sendingPaused (cleared on unpause) — never written alone.
export interface SettingsSavePatch {
  dailyCap?: number
  sendingPaused?: boolean
  autoQueue?: boolean
  autoQueueMinConfidence?: number
  sendWeekdaysOnly?: boolean
  sendWindowStart?: number
  sendWindowEnd?: number
}

// Read app_settings (id=1). `select *` + per-field defaults so the studio still
// renders against a database that has not applied 0017 yet.
export async function readSettings(): Promise<SettingsShape> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)

  const s = (data ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)

  return {
    dailyCap: num(s.daily_cap, 20),
    warmupStart: num(s.warmup_start, 5),
    sendingPaused: bool(s.sending_paused, false),
    pausedReason: typeof s.paused_reason === 'string' ? s.paused_reason : '',
    autoQueue: bool(s.auto_queue, false),
    autoQueueMinConfidence: num(s.auto_queue_min_confidence, 55),
    sendWeekdaysOnly: bool(s.send_weekdays_only, true),
    sendWindowStart: num(s.send_window_start, 8),
    sendWindowEnd: num(s.send_window_end, 11),
  }
}

// Partial write of the outreach knobs (RLS gates). Throws if nothing updatable
// was provided or on a write error.
export async function saveSettings(patch: SettingsSavePatch): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const row: Record<string, unknown> = {}

  if ('dailyCap' in patch) {
    row.daily_cap = Math.max(1, Math.min(200, Math.trunc(Number(patch.dailyCap) || 0)))
  }
  if ('sendingPaused' in patch) {
    row.sending_paused = Boolean(patch.sendingPaused)
    // A manual pause states its author; an unpause clears the reason so a stale
    // auto-pause explanation can't outlive the condition it described.
    row.paused_reason = patch.sendingPaused ? 'Paused manually in Settings.' : ''
  }
  if ('autoQueue' in patch) row.auto_queue = Boolean(patch.autoQueue)
  if ('autoQueueMinConfidence' in patch) {
    row.auto_queue_min_confidence = Math.max(0, Math.min(100, Math.trunc(Number(patch.autoQueueMinConfidence) || 0)))
  }
  if ('sendWeekdaysOnly' in patch) row.send_weekdays_only = Boolean(patch.sendWeekdaysOnly)
  if ('sendWindowStart' in patch) {
    row.send_window_start = Math.max(0, Math.min(23, Math.trunc(Number(patch.sendWindowStart) || 0)))
  }
  if ('sendWindowEnd' in patch) {
    row.send_window_end = Math.max(1, Math.min(24, Math.trunc(Number(patch.sendWindowEnd) || 0)))
  }

  if (Object.keys(row).length === 0) throw new Error('No updatable fields provided.')
  row.updated_at = new Date().toISOString()

  const { error } = await sb.from('app_settings').update(row).eq('id', 1)
  if (error) throw new Error(error.message)
}