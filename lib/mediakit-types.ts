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
  handle: string
  tagline: string
  bioMd: string
  avatarUrl: string
  heroImageUrl: string
  faviconUrl: string // browser-tab icon for the whole site (edited in Settings)
  location: string
  niche: string
  audience: string
  replyToEmail: string
  mailingAddress: string
  mediaKitUrl: string
  totalFollowers: number | null // null ⇒ compute SUM(socialStats.followers)
  rateCard: RateCardItem[]
  showRates: boolean // false ⇒ hide the public Rates section (+ its nav link)
  pressLogos: PressLogo[]
  seo: { title?: string; description?: string; ogImageUrl?: string }
  // Editable from the admin Theme editor; applied as CSS vars on the public page.
  // recentAccents = the last few saved accent colours (newest first), for quick re-pick.
  theme?: { accent?: string; tileTheme?: 'light' | 'dark'; recentAccents?: string[] }
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
  url: string // the post/reel link (opened when a content card is clicked)
  thumbUrl?: string // re-hosted cover image (TikTok oEmbed auto-fetch, or manual)
  platform?: string // 'tiktok' | 'instagram'
  views?: number // manual — per-post counts aren't fetchable keyless
  likes?: number // manual
  caption?: string // TikTok oEmbed title (auto), or manual
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
  rowIndex?: number // 1 | 2 — which marquee row this brand appears in (null ⇒ auto-split)
  // Per-brand campaign fields shown in the brand-detail modal (manual, nullable).
  // Unset ⇒ the modal renders a quiet "~" rather than a fabricated value.
  startDate?: string | null // ISO date 'YYYY-MM-DD'
  endDate?: string | null // ISO date 'YYYY-MM-DD'
  totalViews?: number | null // raw campaign-wide view count
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

// Inverse of formatCount: "1.9M" / "740K" / "1,234,567" → number | null. Tolerates
// k/m/b suffixes, commas, surrounding whitespace, and trailing text; null when there's
// no leading number. Lets admins type compact counts that render back the same way —
// shared by the brand-content editor (PortfolioManager) and the brands API boundary.
export function parseCompact(input: string | number | null | undefined): number | null {
  if (input == null) return null
  const s = String(input).trim().replace(/,/g, '')
  const m = s.match(/^([\d.]+)\s*([kmb])?/i)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const suf = m[2]?.toLowerCase()
  return Math.round(n * (suf === 'k' ? 1e3 : suf === 'm' ? 1e6 : suf === 'b' ? 1e9 : 1))
}
