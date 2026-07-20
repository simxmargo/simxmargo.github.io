import { supabaseBrowser } from '@/lib/supabase/browser'
import { formatCount } from '@/lib/mediakit-types'
import type { PublicProfile, RateCardItem, PressLogo } from '@/lib/mediakit-types'

// Browser-only data layer for the single public_profile row (id=1) — the full
// creator identity (media-kit fields + outreach fields + read-only reach metrics).
// This replicates the old app/api/admin/profile route handler EXACTLY, but talks
// to Supabase directly through the authenticated admin session (supabaseBrowser).
// RLS (`is_admin()`) is the security boundary; there is no service-role key here.
//
// The `profile` row is shared by BOTH ProfileEditor and ThemeEditor.

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook',
  youtube: 'YouTube', x: 'X', twitch: 'Twitch',
}

// Read-only reach metrics derived from social_stats. Follower-weighted: a platform
// reporting null for a metric is excluded from that average (not counted as zero).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveMetrics(socials: any[]) {
  const visible = socials.filter((s) => s.is_visible !== false)
  const followers = visible.reduce((sum, s) => sum + Number(s.followers ?? 0), 0)
  const wAvg = (key: string) => {
    let num = 0, den = 0
    for (const s of visible) {
      if (s[key] == null) continue
      const w = Number(s.followers ?? 0)
      num += Number(s[key]) * w
      den += w
    }
    return den > 0 ? num / den : null
  }
  const avg = wAvg('avg_views')
  const eng = wAvg('engagement_rate')
  return {
    followers: followers > 0 ? formatCount(followers) : '—',
    avgViews: avg != null ? formatCount(Math.round(avg)) : '—',
    engagement: eng != null ? `${eng.toFixed(1)}%` : '—',
    platforms: visible
      .sort((a, b) => Number(b.followers ?? 0) - Number(a.followers ?? 0))
      .map((s) => PLATFORM_LABEL[s.platform] ?? s.platform),
  }
}

// Map a snake_case public_profile row → the camelCase shape the editors read.
// ogImageUrl is surfaced at the top level (it lives inside the seo jsonb).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProfile(r: any): Omit<ProfileReadResult, 'metrics' | 'platforms'> {
  const seo = r.seo ?? {}
  return {
    displayName: r.display_name ?? '',
    handle: r.handle ?? '',
    tagline: r.tagline ?? '',
    niche: r.niche ?? '',
    location: r.location ?? '',
    audience: r.audience ?? '',
    replyToEmail: r.reply_to_email ?? '',
    mailingAddress: r.mailing_address ?? '',
    mediaKitUrl: r.media_kit_url ?? '',
    bioMd: r.bio_md ?? '',
    avatarUrl: r.avatar_url ?? '',
    heroImageUrl: r.hero_image_url ?? '',
    faviconUrl: r.favicon_url ?? '',
    ogImageUrl: seo.og_image_url ?? '',
    rateCard: Array.isArray(r.rate_card) ? r.rate_card : [],
    showRates: r.show_rates !== false, // default true (column added in 0009)
    showRatesSection: r.show_rates_section !== false, // default true (column added in 0011)
    pressLogos: Array.isArray(r.press_logos) ? r.press_logos : [],
    seo,
    theme: r.theme ?? {},
    content: r.content ?? {},
    totalFollowers: r.total_followers ?? null,
    isPublished: Boolean(r.is_published),
  }
}

// Read-only reach metrics shown (never written back) by ProfileEditor.
export interface ProfileMetrics {
  followers: string
  avgViews: string
  engagement: string
}

// The shape readProfile returns — the camelCase profile (mirrors PublicProfile,
// plus the top-level ogImageUrl pulled out of seo) + the derived read-only
// metrics/platforms. Structurally assignable to `Partial<PublicProfile>`, which is
// what the editors type their reads as.
export interface ProfileReadResult {
  displayName: string
  handle: string
  tagline: string
  niche: string
  location: string
  audience: string
  replyToEmail: string
  mailingAddress: string
  mediaKitUrl: string
  bioMd: string
  avatarUrl: string
  heroImageUrl: string
  faviconUrl: string
  ogImageUrl: string
  rateCard: RateCardItem[]
  showRates: boolean
  showRatesSection: boolean
  pressLogos: PressLogo[]
  seo: PublicProfile['seo']
  theme: NonNullable<PublicProfile['theme']>
  content: NonNullable<PublicProfile['content']>
  totalFollowers: number | null
  isPublished: boolean
  metrics: ProfileMetrics
  platforms: string[]
}

// Replicates GET /api/admin/profile: read public_profile (id=1) + social_stats,
// map snake_case → camelCase, and derive read-only reach metrics. Returns null
// when the row doesn't exist (matching the route's `Response.json(null)`).
export async function readProfile(): Promise<ProfileReadResult | null> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const [profileRes, socialsRes] = await Promise.all([
    sb.from('public_profile').select('*').eq('id', 1).maybeSingle(),
    sb.from('social_stats').select('platform, followers, avg_views, engagement_rate, is_visible'),
  ])
  if (profileRes.error) throw new Error(profileRes.error.message)
  if (!profileRes.data) return null

  const m = deriveMetrics(socialsRes.data ?? [])
  return {
    ...mapProfile(profileRes.data),
    metrics: { followers: m.followers, avgViews: m.avgViews, engagement: m.engagement },
    platforms: m.platforms,
  }
}

// Whitelisted camelCase patch accepted by saveProfile (mirrors the route's PUT map).
// Only keys present on the patch are written, so saving is always a partial update.
// ogImageUrl is merged into the seo jsonb; `seo` is a fallback for whole-blob callers.
export interface ProfileSavePatch {
  displayName?: string
  handle?: string
  tagline?: string
  bioMd?: string
  avatarUrl?: string
  heroImageUrl?: string
  location?: string
  niche?: string
  audience?: string
  replyToEmail?: string
  mailingAddress?: string
  mediaKitUrl?: string
  totalFollowers?: number | null
  rateCard?: RateCardItem[]
  showRates?: boolean
  showRatesSection?: boolean
  pressLogos?: PressLogo[]
  faviconUrl?: string
  theme?: PublicProfile['theme']
  content?: PublicProfile['content']
  isPublished?: boolean
  ogImageUrl?: string
  seo?: PublicProfile['seo']
}

// Replicates PUT /api/admin/profile: whitelist camelCase → snake_case columns,
// merge ogImageUrl into the seo jsonb, then update public_profile id=1. Throws on
// error (RLS `is_admin()` gates the write). No-op fields are never sent.
export async function saveProfile(patch: ProfileSavePatch): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const b = patch as Record<string, unknown>

  // Whitelist client camelCase fields → snake_case columns. Only keys present in
  // the patch are mapped, so this is a partial update. Never trust the client to
  // name columns directly.
  const updates: Record<string, unknown> = {}
  const map: Record<string, string> = {
    displayName: 'display_name', handle: 'handle', tagline: 'tagline', bioMd: 'bio_md',
    avatarUrl: 'avatar_url', heroImageUrl: 'hero_image_url', location: 'location', niche: 'niche',
    audience: 'audience', replyToEmail: 'reply_to_email', mailingAddress: 'mailing_address',
    mediaKitUrl: 'media_kit_url', totalFollowers: 'total_followers', rateCard: 'rate_card',
    showRates: 'show_rates', showRatesSection: 'show_rates_section', pressLogos: 'press_logos',
    faviconUrl: 'favicon_url', theme: 'theme', isPublished: 'is_published',
  }
  for (const [camel, snake] of Object.entries(map)) {
    if (camel in b) updates[snake] = b[camel]
  }

  // og:image lives inside the seo jsonb — merge rather than clobber. A raw `seo`
  // object is still accepted as a fallback for callers that send the whole blob.
  if ('ogImageUrl' in b) {
    const cur = await sb.from('public_profile').select('seo').eq('id', 1).maybeSingle()
    const seo = (cur.data?.seo as Record<string, unknown>) ?? {}
    updates.seo = { ...seo, og_image_url: b.ogImageUrl }
  } else if ('seo' in b) {
    updates.seo = b.seo
  }

  // `content` is a jsonb copy-map (footer headline, …) — shallow-merge so saving one
  // slot never clobbers the others. Only the keys present in the patch overwrite their
  // siblings; everything else on the row's content is preserved.
  if ('content' in b) {
    const cur = await sb.from('public_profile').select('content').eq('id', 1).maybeSingle()
    const content = (cur.data?.content as Record<string, unknown>) ?? {}
    updates.content = { ...content, ...((b.content as Record<string, unknown>) ?? {}) }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No updatable fields provided')
  }
  updates.updated_at = new Date().toISOString()

  const { error } = await sb.from('public_profile').update(updates).eq('id', 1)
  if (error) throw new Error(error.message)
}
