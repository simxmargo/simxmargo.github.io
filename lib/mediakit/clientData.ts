// Client-side live reader for the public media kit. Mirrors getMediaKit() in
// lib/mediakit/data.ts but runs in the BROWSER, so admin edits to live Supabase
// show up on the next page load WITHOUT a rebuild of the static export.
//
// SECURITY: uses a SEPARATE anonymous Supabase client with NO session —
// deliberately NOT lib/supabase/browser.ts (that one carries the admin's auth
// session, which would let an admin viewing this page read unpublished/hidden
// rows). RLS on the anon key is the boundary, exactly like the server reader.
//
// Returns null on missing config / any error / not-yet-published, so the caller
// keeps the build-time SSR snapshot instead of flashing an empty page.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Module-level anon client (no session). Null when env is unconfigured.
const supabaseAnon: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    : null

/* eslint-disable @typescript-eslint/no-explicit-any */
// Mappers copied verbatim from lib/mediakit/data.ts (not exported there) so the
// browser read produces byte-identical shapes to the server snapshot.
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
    pressLogos: r.press_logos ?? [],
    seo: r.seo ?? {},
    theme: r.theme ?? {},
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
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Replicates getMediaKit()'s SELECTs against the anon (session-less) client.
// Returns null on any error/empty so MediaKitLive keeps the SSR snapshot.
export async function getMediaKitClient(): Promise<MediaKitData | null> {
  if (!supabaseAnon) return null
  try {
    const [profileRes, socialsRes, brandsRes] = await Promise.all([
      supabaseAnon.from('public_profile').select('*').eq('id', 1).eq('is_published', true).maybeSingle(),
      supabaseAnon.from('social_stats').select('*').eq('is_visible', true).order('sort_order', { ascending: true }),
      supabaseAnon
        .from('portfolio_brands')
        .select('*')
        .eq('is_visible', true)
        .order('sort_order', { ascending: true }),
    ])
    if (profileRes.error) throw profileRes.error
    // Not published yet → keep the snapshot rather than blanking the page.
    if (!profileRes.data) return null

    return {
      profile: mapProfile(profileRes.data),
      socials: (socialsRes.data ?? []).map(mapSocial),
      brands: (brandsRes.data ?? []).map(mapBrand),
    }
  } catch (err) {
    console.error('[mediakit] live client read failed; keeping snapshot:', err instanceof Error ? err.message : err)
    return null
  }
}
