import type { PortfolioBrand } from '@/lib/mediakit-types'

// View-model for the brand-performance MODAL (Claude Design "Media Kit v3"),
// matching the design's expected output exactly. Pure + framework-free so it's
// trivially testable and stays out of the component.
//
// DATA SOURCE — CURATED.  The modal's campaign data (type, start/end, deliverables,
// total views, and the top-clip "peak" the content grid is built from) is the
// creator's authored showcase content, hardcoded in the source design's DETAILS
// table. It is NOT derived from the live portfolio_brands metrics (those are empty),
// so we port the table verbatim and join it to each live brand by NAME. This is the
// single source of these numbers — see docs/mediakit-brand-detail-backend.md for the
// path to make them admin-editable (move CURATED → DB columns) later.
//   TODO(mediakit-brand-detail-backend): persist per-brand campaign detail in the DB.

export type CategoryKey = 'fashion' | 'beauty' | 'app' | 'media'

export interface MetaCell {
  label: string
  value: string
  accent?: boolean
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

const CAPTIONS: Record<CategoryKey, string[]> = {
  fashion: ['styling the new drop ✦', 'vs the female gaze', 'get ready with me', 'fit check: 3 ways'],
  beauty: ['my everyday glam', 'grwm: soft glow', 'first impressions', 'one product · 3 looks'],
  app: ['how I edit my reels', 'my full editing workflow', 'before / after', 'quick tutorial ✦'],
  media: ['behind the scenes', 'the campaign cut', 'feature drop', 'on set with the team'],
}

// Ported verbatim from "Media Kit v3.dc.html" (BRANDS + DETAILS), keyed by slug.
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

// 1_300_000 → "1.3M", 740_000 → "740K" (the design's fmtViews).
function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

// Top-clip falloff from the design. Cards are peak × these (NOT normalized to total —
// the design keeps a separate `peak` per brand, so the cards don't sum to total).
const FALLOFF = [1, 0.62, 0.41, 0.29]

function buildContent(cat: CategoryKey, peak: number): ContentCard[] {
  const caps = CAPTIONS[cat]
  return FALLOFF.map((f, i) => {
    const views = Math.round(peak * f)
    return {
      viewsLabel: fmt(views),
      likesLabel: fmt(Math.round(views * 0.11)),
      caption: caps[i % caps.length],
      platform: i === 1 ? 'instagram' : 'tiktok',
      thumbVariant: (i % 4) as 0 | 1 | 2 | 3,
    }
  })
}

// Map a brand's REAL managed content (admin-curated reels) → ContentCard[]. These
// carry a real thumbnail + post link + manually-entered view/like counts. Used in
// preference to the synthetic falloff whenever a brand has at least one item.
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
  const real = mapRealContent(brand.media)

  if (curated) {
    // Real managed reels win; otherwise fall back to the synthetic peak breakdown.
    const content = real.length ? real : buildContent(curated.cat, curated.peak)
    return {
      name: brand.brand,
      logoUrl: brand.logoUrl,
      categoryKey: curated.cat,
      catLabel: CAT_LABEL[curated.cat],
      type: curated.type,
      blurb: '', // design shows none when curated content is present
      metaCells: [
        { label: 'Start', value: curated.start },
        { label: 'End', value: curated.end },
        { label: 'Deliverables', value: curated.deliv },
        { label: 'Total views', value: fmt(curated.total), accent: true },
      ],
      content,
      countLabel: `${content.length} pieces`,
    }
  }

  // FALLBACK — a brand not in the curated set (e.g. added later in admin): show what
  // the DB has (aggregate metrics, if any) and the blurb. No fabricated content grid.
  const key = categoryKey(brand.category)
  const m = brand.metrics || {}
  const metaCells: MetaCell[] = []
  if (m.reach) metaCells.push({ label: 'Reach', value: m.reach })
  if (m.views) metaCells.push({ label: 'Total views', value: m.views, accent: true })
  if (m.engagement) metaCells.push({ label: 'Engagement', value: m.engagement })
  const delivCount = Array.isArray(m.deliverables) ? m.deliverables.length : 0
  if (delivCount) metaCells.push({ label: 'Deliverables', value: `${delivCount} ${delivCount === 1 ? 'piece' : 'pieces'}` })

  return {
    name: brand.brand,
    logoUrl: brand.logoUrl,
    categoryKey: key,
    catLabel: CAT_LABEL[key],
    type: brand.campaignTitle || CAT_LABEL[key],
    blurb: brand.blurb || '',
    metaCells,
    content: real,
    countLabel: real.length ? `${real.length} pieces` : '',
  }
}
