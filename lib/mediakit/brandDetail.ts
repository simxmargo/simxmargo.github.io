import { formatCount, type PortfolioBrand } from '@/lib/mediakit-types'

// View-model for the brand-performance MODAL (Claude Design "Media Kit v3").
// Pure + framework-free so it's trivially testable and stays out of the component.
//
// DATA SOURCE — LIVE, per-brand.  The campaign stats (START / END / TOTAL VIEWS)
// now come from real, admin-editable columns on portfolio_brands; DELIVERABLES is
// DERIVED from the count of top-content pieces. Any stat the admin leaves blank
// renders a quiet "~" (never a fabricated value), and the content grid is the
// brand's REAL managed reels — empty ⇒ the component shows a social CTA instead.
//
// The CURATED table below is retained ONLY to label the modal header (the campaign
// `type` + category) for the original showcase brands; it no longer supplies any
// shown numbers. Brands not in it degrade gracefully to DB-derived labels.

export type CategoryKey = 'fashion' | 'beauty' | 'app' | 'media'

export interface MetaCell {
  label: string
  value: string
  accent?: boolean
  empty?: boolean // true when value is the "~" placeholder → rendered dimmed
}

export interface ContentCard {
  viewsLabel: string
  likesLabel: string
  caption: string
  platform: 'tiktok' | 'instagram'
  thumbVariant: 0 | 1 | 2 | 3
  thumbUrl?: string // real cover image (when curated/managed); '' → gradient fallback
  url?: string // the post link (opens on click) — only set for real managed content
}

export interface BrandDetailVM {
  name: string
  logoUrl: string
  categoryKey: CategoryKey
  catLabel: string
  type: string
  blurb: string
  metaCells: MetaCell[]
  content: ContentCard[]
  countLabel: string
}

interface CuratedDetail {
  name: string
  cat: CategoryKey
  type: string
  start: string
  end: string
  deliv: string
  total: number
  peak: number
}

const CAT_LABEL: Record<CategoryKey, string> = {
  fashion: 'Fashion & Styling',
  beauty: 'Beauty',
  app: 'Creative App',
  media: 'Media',
}

// Ported from "Media Kit v3.dc.html" (BRANDS + DETAILS), keyed by slug. Only `cat`
// and `type` are read now (header labels); the date/total/peak values are retained
// as reference but no longer rendered — live DB columns supply those stats.
const CURATED: Record<string, CuratedDetail> = {
  fashionnova: { name: 'Fashion Nova', cat: 'fashion', type: 'Brand partner', start: '11/02/25', end: '12/14/25', deliv: '2 TikToks · 1 Reel', total: 3_400_000, peak: 1_800_000 },
  ohpolly: { name: 'Oh Polly', cat: 'fashion', type: 'Lookbook campaign', start: '10/20/25', end: '11/10/25', deliv: '1 TikTok · 3 Stories', total: 1_900_000, peak: 980_000 },
  lacemade: { name: 'LaceMade', cat: 'fashion', type: 'Partnership', start: '12/12/25', end: '12/19/25', deliv: '1 Instagram Reel', total: 1_200_000, peak: 1_200_000 },
  chnge: { name: 'CHNGE', cat: 'fashion', type: 'Editorial feature', start: '09/15/25', end: '10/05/25', deliv: '2 TikToks', total: 1_500_000, peak: 820_000 },
  glowmode: { name: 'Glowmode', cat: 'fashion', type: 'Seasonal campaign', start: '11/18/25', end: '12/08/25', deliv: '3 TikToks · 2 Reels', total: 2_600_000, peak: 1_100_000 },
  halara: { name: 'Halara', cat: 'fashion', type: 'UGC bundle', start: '10/01/25', end: '10/22/25', deliv: '3 videos', total: 1_700_000, peak: 760_000 },
  fashionchingu: { name: 'Fashion Chingu', cat: 'fashion', type: 'Partnership', start: '08/12/25', end: '09/02/25', deliv: '2 TikToks', total: 1_100_000, peak: 540_000 },
  beautyplusapp: { name: 'Beautyplus App', cat: 'beauty', type: 'App partner', start: '11/05/25', end: '11/26/25', deliv: '2 TikToks · 1 Reel', total: 2_100_000, peak: 990_000 },
  beautyplus: { name: 'BeautyPlus', cat: 'beauty', type: 'Brand ambassador', start: '07/01/25', end: 'Ongoing', deliv: 'Monthly content', total: 3_000_000, peak: 1_300_000 },
  filmora: { name: 'Filmora', cat: 'app', type: 'App partner', start: '10/10/25', end: '11/01/25', deliv: '1 tutorial TikTok', total: 1_400_000, peak: 1_400_000 },
  vivavideo: { name: 'VivaVideo', cat: 'app', type: 'App partner', start: '09/20/25', end: '10/12/25', deliv: '2 TikToks', total: 1_000_000, peak: 600_000 },
  kapicam: { name: 'Kapi Cam', cat: 'app', type: 'App partner', start: '08/25/25', end: '09/15/25', deliv: '1 TikTok', total: 720_000, peak: 720_000 },
  oldroll: { name: 'OldRoll Cam', cat: 'app', type: 'App partner', start: '11/12/25', end: '12/02/25', deliv: '2 TikToks', total: 1_300_000, peak: 680_000 },
  reelsapp: { name: 'Reelsapp', cat: 'app', type: 'App partner', start: '10/05/25', end: '10/26/25', deliv: '1 TikTok', total: 880_000, peak: 880_000 },
  proccd: { name: 'ProCCD', cat: 'app', type: 'App partner', start: '09/08/25', end: '09/29/25', deliv: '1 TikTok', total: 640_000, peak: 640_000 },
  hypic: { name: 'Hypic', cat: 'app', type: 'App partner', start: '11/22/25', end: '12/12/25', deliv: '2 TikToks', total: 1_600_000, peak: 900_000 },
  flighthouse: { name: 'Flighthouse', cat: 'media', type: 'Media feature', start: '08/01/25', end: '08/15/25', deliv: '1 feature', total: 2_400_000, peak: 2_400_000 },
}

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// slug index by normalized brand name (e.g. "Beautyplus App" → "beautyplusapp").
const NAME_INDEX: Record<string, string> = Object.fromEntries(
  Object.entries(CURATED).map(([slug, d]) => [norm(d.name), slug]),
)

// Resolve a live PortfolioBrand to its curated detail by name. Exact normalized
// match first, then prefix tolerance so DB variants like "Flighthouse Media" still
// match the design's "Flighthouse". Returns null for brands not in the curated set
// (e.g. one added later in admin) → the modal degrades to header + blurb.
function resolveCurated(brand: PortfolioBrand): CuratedDetail | null {
  const n = norm(brand.brand)
  if (!n) return null
  const exact = NAME_INDEX[n]
  if (exact) return CURATED[exact]
  for (const [name, slug] of Object.entries(NAME_INDEX)) {
    if (n.startsWith(name) || name.startsWith(n)) return CURATED[slug]
  }
  return null
}

export function categoryKey(category: string): CategoryKey {
  const c = (category || '').toLowerCase()
  if (c.includes('beaut')) return 'beauty'
  if (c.includes('app')) return 'app'
  if (c.includes('media')) return 'media'
  return 'fashion'
}

// 1_300_000 → "1.3M", 740_000 → "740K" (per-clip view/like labels).
function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

// A date column ('YYYY-MM-DD') → 'MM/DD/YY' for the modal. Parsed from the string
// parts (NOT `new Date()`) so it's timezone-safe. Blank/malformed ⇒ '' (caller
// substitutes the "~" empty state).
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return ''
  const [, y, mo, d] = m
  return `${mo}/${d}/${y.slice(2)}`
}

// The single quiet empty state shared by every modal stat (no "N/A", no fake value).
const DASH = '~'

// Map a brand's REAL managed content (admin-curated reels) → ContentCard[]. These
// carry a real thumbnail + post link + manually-entered view/like counts. This is the
// modal's only content source now; an empty result drives the social CTA empty state.
function mapRealContent(media: PortfolioBrand['media']): ContentCard[] {
  return (Array.isArray(media) ? media : [])
    .filter((m) => m && typeof m.url === 'string' && m.url)
    .slice(0, 8)
    .map((m, i) => ({
      viewsLabel: typeof m.views === 'number' ? fmt(m.views) : '',
      likesLabel: typeof m.likes === 'number' ? fmt(m.likes) : '',
      caption: m.caption || '',
      platform: m.platform === 'instagram' ? 'instagram' : 'tiktok',
      thumbVariant: (i % 4) as 0 | 1 | 2 | 3,
      thumbUrl: m.thumbUrl || '',
      url: m.url,
    }))
}

export function buildBrandDetail(brand: PortfolioBrand): BrandDetailVM {
  const curated = resolveCurated(brand)
  // The content grid is the brand's REAL managed reels. Empty ⇒ no fabricated cards;
  // the modal swaps in a social CTA banner (handled in PortfolioGrid).
  const content = mapRealContent(brand.media)

  // Header labels: curated `type`/category for the original showcase brands, else
  // DB-derived (campaign title + category). Stats below are always live, never curated.
  const key = curated?.cat ?? categoryKey(brand.category)
  const type = curated?.type ?? brand.campaignTitle ?? ''

  // The four stats. START / END / TOTAL VIEWS read the per-brand campaign columns;
  // DELIVERABLES is DERIVED from the count of top-content pieces. Any blank ⇒ a quiet
  // "~" placeholder (empty:true → dimmed), never "N/A" and never a fabricated value.
  const start = fmtDate(brand.startDate)
  const end = fmtDate(brand.endDate)
  const pieces = content.length
  const tv = brand.totalViews

  const metaCells: MetaCell[] = [
    { label: 'Start', value: start || DASH, empty: !start },
    { label: 'End', value: end || DASH, empty: !end },
    {
      label: 'Deliverables',
      value: pieces ? `${pieces} ${pieces === 1 ? 'piece' : 'pieces'}` : DASH,
      empty: pieces === 0,
    },
    {
      label: 'Total views',
      value: tv != null ? formatCount(tv) : DASH,
      accent: tv != null,
      empty: tv == null,
    },
  ]

  return {
    name: brand.brand,
    logoUrl: brand.logoUrl,
    categoryKey: key,
    catLabel: CAT_LABEL[key],
    type: type || CAT_LABEL[key],
    blurb: brand.blurb || '',
    metaCells,
    content,
    countLabel: pieces ? `${pieces} ${pieces === 1 ? 'piece' : 'pieces'}` : '',
  }
}
