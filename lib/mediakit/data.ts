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
    tagline: r.tagline ?? '',
    bioMd: r.bio_md ?? '',
    avatarUrl: r.avatar_url ?? '',
    heroImageUrl: r.hero_image_url ?? '',
    location: r.location ?? '',
    niche: r.niche ?? '',
    totalFollowers: r.total_followers ?? null,
    rateCard: (r.rate_card ?? []) as RateCardItem[],
    pressLogos: r.press_logos ?? [],
    seo: r.seo ?? {},
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
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
        .order('featured', { ascending: false })
        .order('sort_order', { ascending: true }),
    ])
    if (profileRes.error) throw profileRes.error
    // Not published yet → show the polished mock rather than a half-empty live page.
    if (!profileRes.data) return mockMediaKit

    return {
      profile: mapProfile(profileRes.data),
      socials: (socialsRes.data ?? []).map(mapSocial),
      brands: (brandsRes.data ?? []).map(mapBrand),
    }
  } catch (err) {
    console.error('[mediakit] live read failed; using mock:', err instanceof Error ? err.message : err)
    return mockMediaKit
  }
})
