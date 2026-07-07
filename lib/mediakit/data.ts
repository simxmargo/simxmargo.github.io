// Server-side data layer for the public media kit. Reads live Supabase via the
// anon client (RLS-gated) and maps snake_case rows → the camelCase types the
// components consume. Falls back to mock data if Supabase is unconfigured, the
// profile isn't published yet, or a read fails — so the page never looks broken.
//
// Only import this from Server Components / Route Handlers (never the client).
import { cache } from 'react'
import { supabasePublic, isSupabaseConfigured } from '@/lib/supabase/public'
import { mockMediaKit } from '@/lib/mock/mediakit'
import type {
  BrandMedia,
  BrandMetrics,
  MediaKitData,
  Platform,
  PortfolioBrand,
  PublicProfile,
  RateCardItem,
  SocialStat,
} from '@/lib/mediakit-types'

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapProfile(r: any): PublicProfile {
  return {
    displayName: r.display_name ?? '',
    handle: r.handle ?? '',
    tagline: r.tagline ?? '',
    bioMd: r.bio_md ?? '',
    avatarUrl: r.avatar_url ?? '',
    heroImageUrl: r.hero_image_url ?? '',
    faviconUrl: r.favicon_url ?? '',
    location: r.location ?? '',
    niche: r.niche ?? '',
    audience: r.audience ?? '',
    replyToEmail: r.reply_to_email ?? '',
    mailingAddress: r.mailing_address ?? '',
    mediaKitUrl: r.media_kit_url ?? '',
    totalFollowers: r.total_followers ?? null,
    rateCard: (r.rate_card ?? []) as RateCardItem[],
    showRates: r.show_rates !== false, // default true (column added in 0009)
    showRatesSection: r.show_rates_section !== false, // default true (column added in 0011)
    pressLogos: r.press_logos ?? [],
    seo: r.seo ?? {},
    theme: r.theme ?? {},
    content: r.content ?? {},
    isPublished: Boolean(r.is_published),
  }
}

function mapSocial(r: any): SocialStat {
  return {
    platform: r.platform as Platform,
    handle: r.handle ?? '',
    profileUrl: r.profile_url ?? '',
    followers: Number(r.followers ?? 0),
    avgViews: r.avg_views != null ? Number(r.avg_views) : null,
    engagementRate: r.engagement_rate != null ? Number(r.engagement_rate) : null,
    growth30d: r.growth_30d != null ? Number(r.growth_30d) : null,
    history: Array.isArray(r.history) ? r.history : [],
  }
}

function mapBrand(r: any): PortfolioBrand {
  return {
    id: r.id,
    brand: r.brand,
    website: r.website ?? '',
    logoUrl: r.logo_url ?? '',
    blurb: r.blurb ?? '',
    campaignTitle: r.campaign_title ?? '',
    metrics: (r.metrics ?? {}) as BrandMetrics,
    media: (r.media ?? []) as BrandMedia[],
    category: r.category ?? '',
    featured: Boolean(r.featured),
    rowIndex: r.row_index === 1 || r.row_index === 2 ? r.row_index : undefined,
    startDate: r.start_date ?? null,
    endDate: r.end_date ?? null,
    totalViews: r.total_views != null ? Number(r.total_views) : null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Lightweight reader for just the favicon URL (the whole-site browser-tab icon),
// used by the root layout's generateMetadata. Reads only favicon_url — not the
// full media kit — so /admin requests don't pull brands + socials just for an icon.
// React-cached per request; returns '' on any failure → layout falls back to /icon.svg.
export const getFaviconUrl = cache(async (): Promise<string> => {
  if (!isSupabaseConfigured) return ''
  try {
    const { data } = await supabasePublic.from('public_profile').select('favicon_url').eq('id', 1).maybeSingle()
    return (data?.favicon_url as string | null) ?? ''
  } catch {
    return ''
  }
})

// The theme accent colour (public_profile.theme.accent), used to tint the dynamic
// favicon so the browser-tab mark follows the selected theme. '' when unset/unavailable
// → the favicon falls back to the design default. React-cached per request.
export const getThemeAccent = cache(async (): Promise<string> => {
  if (!isSupabaseConfigured) return ''
  try {
    const { data } = await supabasePublic.from('public_profile').select('theme').eq('id', 1).maybeSingle()
    const theme = (data?.theme ?? {}) as { accent?: string }
    return typeof theme.accent === 'string' ? theme.accent : ''
  } catch {
    return ''
  }
})

// Static-export (GitHub Pages CI) builds bake this read into the published site.
// If Supabase is unreachable there — most likely the free-tier project PAUSED from
// inactivity — falling back to mock would silently REPLACE the live site with
// placeholder content on the next push. Failing the build keeps the last good
// deploy up instead; local/dev builds keep the friendly mock fallback.
const isStaticExport = process.env.EXPORT_STATIC === '1'

// Wrapped in React cache() so the page render AND generateMetadata share a single
// read per request (Supabase queries aren't deduped by Next's fetch cache).
export const getMediaKit = cache(async (): Promise<MediaKitData> => {
  if (!isSupabaseConfigured) return mockMediaKit
  try {
    const [profileRes, socialsRes, brandsRes] = await Promise.all([
      supabasePublic.from('public_profile').select('*').eq('id', 1).eq('is_published', true).maybeSingle(),
      supabasePublic.from('social_stats').select('*').eq('is_visible', true).order('sort_order', { ascending: true }),
      supabasePublic
        .from('portfolio_brands')
        .select('*')
        .eq('is_visible', true)
        .order('sort_order', { ascending: true }),
    ])
    if (profileRes.error) throw profileRes.error
    // Not published yet → show the polished mock rather than a half-empty live page
    // (but never publish the mock: a real project with no published profile means an
    // export build should stop, same as an outage).
    if (!profileRes.data) {
      if (isStaticExport)
        throw new Error('public_profile id=1 is missing/unpublished — refusing to bake the mock into the export')
      return mockMediaKit
    }

    return {
      profile: mapProfile(profileRes.data),
      socials: (socialsRes.data ?? []).map(mapSocial),
      brands: (brandsRes.data ?? []).map(mapBrand),
    }
  } catch (err) {
    if (isStaticExport) {
      console.error(
        '[mediakit] EXPORT build could not read live data (Supabase paused/unreachable?) — failing the build so the last good deploy stays up.',
      )
      throw err
    }
    console.error('[mediakit] live read failed; using mock:', err instanceof Error ? err.message : err)
    return mockMediaKit
  }
})
