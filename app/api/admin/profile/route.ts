import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin, getAdminReadClient } from '@/lib/supabase/admin'
import { formatCount } from '@/lib/mediakit-types'

// Admin API for the single public_profile row (id=1) — the full creator identity:
// media-kit fields + outreach fields (reply-to / mailing address) + read-only reach
// metrics derived from social_stats. The Profile tab owns ALL of this now; Settings
// is app-config only (favicon + daily cap). requireAdmin gates BOTH methods.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

// Map a snake_case public_profile row → the camelCase shape ProfileEditor reads
// directly off res.json() (NOT wrapped in { data }). Mirrors lib/mediakit/data.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProfile(r: any) {
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
    ogImageUrl: seo.og_image_url ?? '',
    rateCard: Array.isArray(r.rate_card) ? r.rate_card : [],
    pressLogos: Array.isArray(r.press_logos) ? r.press_logos : [],
    seo,
    theme: r.theme ?? {},
    totalFollowers: r.total_followers ?? null,
    isPublished: Boolean(r.is_published),
  }
}

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const sb = getAdminReadClient()
  const [profileRes, socialsRes] = await Promise.all([
    sb.from('public_profile').select('*').eq('id', 1).maybeSingle(),
    sb.from('social_stats').select('platform, followers, avg_views, engagement_rate, is_visible'),
  ])
  if (profileRes.error) return Response.json({ error: profileRes.error.message }, { status: 500 })
  if (!profileRes.data) return Response.json(null)

  const m = deriveMetrics(socialsRes.data ?? [])
  // Profile read = the camelCase profile + derived read-only metrics (shown by ProfileEditor).
  return Response.json({
    ...mapProfile(profileRes.data),
    metrics: { followers: m.followers, avgViews: m.avgViews, engagement: m.engagement },
    platforms: m.platforms,
  })
}

export async function PUT(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  // Whitelist client camelCase fields → snake_case columns. Only keys present in
  // the body are mapped, so PUT is a partial update. Never trust the client to
  // name columns directly.
  const updates: Record<string, unknown> = {}
  const map: Record<string, string> = {
    displayName: 'display_name', handle: 'handle', tagline: 'tagline', bioMd: 'bio_md',
    avatarUrl: 'avatar_url', heroImageUrl: 'hero_image_url', location: 'location', niche: 'niche',
    audience: 'audience', replyToEmail: 'reply_to_email', mailingAddress: 'mailing_address',
    mediaKitUrl: 'media_kit_url', totalFollowers: 'total_followers', rateCard: 'rate_card',
    pressLogos: 'press_logos', theme: 'theme', isPublished: 'is_published',
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

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No updatable fields provided' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await sb
    .from('public_profile')
    .update(updates)
    .eq('id', 1)
    .select('*')
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}
