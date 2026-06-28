import { supabaseBrowser } from '@/lib/supabase/browser'
import type { Platform, SocialStat } from '@/lib/mediakit-types'

// Browser-only data layer for the "simxmargo" social_stats table. This replicates
// the old app/api/admin/socials route handlers EXACTLY, but talks to Supabase
// directly through the authenticated admin session (supabaseBrowser). RLS
// (`is_admin()`) is the security boundary; there is no service-role key here.

// The camelCase shape SocialStatsEditor reads (a DIRECT array, NOT wrapped in
// { data }). Extends SocialStat with the UI `visible` mirror + integration
// provenance (source / syncedAt). Mirrors the route's mapSocial output exactly.
export interface SocialRow extends SocialStat {
  isVisible: boolean
  visible: boolean
  source: string // 'manual' | 'api' — integration provenance
  syncedAt: string | null
}

// Map a snake_case social_stats row → the camelCase shape the editor reads. The
// editor expects a UI `visible` flag derived from is_visible. Mirrors the route.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSocial(r: any): SocialRow {
  return {
    platform: r.platform as Platform,
    handle: r.handle ?? '',
    profileUrl: r.profile_url ?? '',
    followers: Number(r.followers ?? 0),
    avgViews: r.avg_views != null ? Number(r.avg_views) : null,
    engagementRate: r.engagement_rate != null ? Number(r.engagement_rate) : null,
    growth30d: r.growth_30d != null ? Number(r.growth_30d) : null,
    history: Array.isArray(r.history) ? r.history : [],
    isVisible: r.is_visible ?? true,
    visible: r.is_visible ?? true,
    source: r.source ?? 'manual',
    syncedAt: r.synced_at ?? null,
  }
}

// Replicates GET /api/admin/socials: list every row (incl. hidden), ordered by
// sort_order asc, mapped snake_case → camelCase. Throws on error.
export async function readSocials(): Promise<SocialRow[]> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb
    .from('social_stats')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapSocial)
}

// Whitelisted camelCase patch accepted by saveSocial (mirrors the route's PUT map).
// Only keys present on the patch are written, so saving is always a partial update.
export interface SocialSavePatch {
  handle?: string | null
  profileUrl?: string | null
  followers?: number | null
  avgViews?: number | null
  engagementRate?: number | null
  growth30d?: number | null
  isVisible?: boolean
}

// Replicates PUT /api/admin/socials: whitelist camelCase → snake_case columns,
// then update the matching platform row (the natural key). Numeric coercion
// mirrors the route (followers/avgViews truncated to ints; rates kept as floats;
// null stays null). Throws on error (RLS `is_admin()` gates the write).
export async function saveSocial(idOrPlatform: string, patch: SocialSavePatch): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const b = patch as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  if ('handle' in b) updates.handle = b.handle
  if ('profileUrl' in b) updates.profile_url = b.profileUrl
  if ('followers' in b) {
    updates.followers = b.followers === null ? null : Math.trunc(Number(b.followers))
  }
  if ('avgViews' in b) {
    updates.avg_views = b.avgViews === null ? null : Math.trunc(Number(b.avgViews))
  }
  if ('engagementRate' in b) {
    updates.engagement_rate = b.engagementRate === null ? null : Number(b.engagementRate)
  }
  if ('growth30d' in b) {
    updates.growth_30d = b.growth30d === null ? null : Number(b.growth30d)
  }
  if ('isVisible' in b) updates.is_visible = b.isVisible

  if (Object.keys(updates).length === 0) {
    throw new Error('No editable fields supplied.')
  }
  updates.updated_at = new Date().toISOString()

  const { error } = await sb.from('social_stats').update(updates).eq('platform', idOrPlatform)
  if (error) throw new Error(error.message)
}
