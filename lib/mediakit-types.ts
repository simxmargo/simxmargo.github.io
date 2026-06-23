// Public mediakit data shapes (camelCase), mirroring the snake_case tables in
// supabase/migrations/0003_mediakit.sql. The data layer (lib/mediakit/*) maps
// DB rows → these, so components never see DB naming. Used by both the mock
// (lib/mock/mediakit.ts) and the live reads (Phase 4).

export interface RateCardItem {
  deliverable: string
  price: string
  note?: string
}

export interface PressLogo {
  name: string
  logoUrl?: string
  url?: string
}

export interface PublicProfile {
  displayName: string
  tagline: string
  bioMd: string
  avatarUrl: string
  heroImageUrl: string
  location: string
  niche: string
  totalFollowers: number | null // null ⇒ compute SUM(socialStats.followers)
  rateCard: RateCardItem[]
  pressLogos: PressLogo[]
  seo: { title?: string; description?: string; ogImageUrl?: string }
  isPublished: boolean
}

export type Platform = 'tiktok' | 'instagram' | 'facebook' | 'youtube' | 'x' | 'twitch'

export interface SocialStat {
  platform: Platform
  handle: string
  profileUrl: string
  followers: number
  avgViews: number | null
  engagementRate: number | null
  growth30d: number | null
  history: { date: string; followers: number }[]
}

export interface BrandMedia {
  type: 'image' | 'video' | 'embed'
  url: string
  thumbUrl?: string
  platform?: string
}

export interface BrandMetrics {
  reach?: string
  views?: string
  engagement?: string
  deliverables?: string[]
}

export interface PortfolioBrand {
  id: string
  brand: string
  website: string
  logoUrl: string
  blurb: string
  campaignTitle: string
  metrics: BrandMetrics
  media: BrandMedia[]
  category: string
  featured: boolean
}

// What the public "Work with me" form submits (→ collab_inquiries).
export interface CollabInquiryInput {
  name: string
  email: string
  company?: string
  budget?: string
  message: string
  deliverables: string[]
}

// Convenience bundle the public page passes down.
export interface MediaKitData {
  profile: PublicProfile
  socials: SocialStat[]
  brands: PortfolioBrand[]
}

// Total reach across platforms (profile override wins when set).
export function totalReach(profile: PublicProfile, socials: SocialStat[]): number {
  if (profile.totalFollowers != null) return profile.totalFollowers
  return socials.reduce((sum, s) => sum + s.followers, 0)
}

// Compact follower formatting: 2_700_000 → "2.7M", 394_000 → "394K".
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
