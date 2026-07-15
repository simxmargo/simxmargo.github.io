'use client'

// Direct-to-Supabase data layer for the admin BRANDS (portfolio) editor. Replaces
// the old /api/admin/brands route 1:1 — every call goes through `supabaseBrowser`,
// which carries the signed-in admin's session, so RLS (`is_admin()`) is the security
// boundary (no service-role key, no x-admin-secret). The snake_case ⇆ camelCase
// mapping + media sanitization are copied verbatim from the route so behaviour can't
// drift.
import { supabaseBrowser } from '@/lib/supabase/browser'
import { parseCompact, type BrandMedia, type BrandMetrics, type PortfolioBrand } from '@/lib/mediakit-types'
import { detectPostPlatform } from '@/lib/social/scrape'

// AdminBrand — the brands-list shape the editor reads: the public PortfolioBrand
// fields plus the admin-only sort_order / is_visible columns (mirrors the GET map).
export type AdminBrand = PortfolioBrand & { isVisible: boolean; sortOrder: number }

// Whitelisted camelCase write payload. The editor passes a superset (the whole form);
// mapBody picks only the keys actually present, so updateBrand stays a partial update.
export interface BrandWriteInput {
  brand?: string
  website?: string
  logoUrl?: string
  blurb?: string
  campaignTitle?: string
  category?: string
  featured?: boolean
  metrics?: BrandMetrics
  media?: unknown
  rowIndex?: '' | 1 | 2 | number | null
  sortOrder?: number
  isVisible?: boolean
  startDate?: string | null // ISO 'YYYY-MM-DD'; '' ⇒ cleared (null)
  endDate?: string | null // ISO 'YYYY-MM-DD'; '' ⇒ cleared (null)
  totalViews?: string | number | null // compact ("3.4M") or raw; parsed at the boundary
}

// One reorder entry: a bare id (sort only) or { id, rowIndex } (sort + lane), exactly
// like the old PUT { order: [...] } bulk branch accepted.
export type ReorderItem = string | { id: string; rowIndex?: 1 | 2 | null }

// supabaseBrowser is null only when the studio env vars are unset. Fail loud — the
// admin SPA can't write without it (mirrors the contract's required guard message).
function client() {
  if (!supabaseBrowser) throw new Error('Studio is not configured.')
  return supabaseBrowser
}

// rowIndex is only 1 or 2 (a real carousel lane); anything else ⇒ null (Auto-split).
function coerceRowIndex(v: unknown): 1 | 2 | null {
  return v === 1 || v === 2 ? v : null
}

// Validate + coerce the form's `media` array at the boundary — never store raw client
// jsonb. Whitelists fields, caps per-field lengths, parses compact counts ("1.8M"),
// drops empties. Deliberately NO item-count cap — the modal grid scrolls.
function sanitizeMedia(input: unknown): BrandMedia[] {
  if (!Array.isArray(input)) return []
  const out: BrandMedia[] = []
  for (const raw of input) {
    const m = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const url = typeof m.url === 'string' ? m.url.trim().slice(0, 600) : ''
    if (!url) continue
    const item: BrandMedia = { type: 'video', url }
    // Platform: trust the client value, else derive from the URL host so an Instagram
    // reel saved WITHOUT a fetch still renders with the right badge.
    if (m.platform === 'instagram' || m.platform === 'tiktok') item.platform = m.platform
    else {
      const p = detectPostPlatform(url)
      if (p) item.platform = p
    }
    if (typeof m.thumbUrl === 'string' && m.thumbUrl.trim()) item.thumbUrl = m.thumbUrl.trim().slice(0, 600)
    if (typeof m.caption === 'string' && m.caption.trim()) item.caption = m.caption.trim().slice(0, 300)
    // Counts are user-typed: accept compact "1.8M"/"740K"/"1,234,567". Empty ⇒ omitted.
    for (const k of ['views', 'likes'] as const) {
      const n = parseCompact(m[k] as string | number | null | undefined)
      if (n != null && n >= 0) item[k] = n
    }
    out.push(item)
  }
  return out
}

// Whitelist + map an incoming camelCase payload to snake_case columns. Only keys the
// caller actually sent are included, so an update becomes a partial update.
function mapBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('brand' in body) out.brand = body.brand
  if ('website' in body) out.website = body.website
  if ('logoUrl' in body) out.logo_url = body.logoUrl
  if ('blurb' in body) out.blurb = body.blurb
  if ('campaignTitle' in body) out.campaign_title = body.campaignTitle
  if ('category' in body) out.category = body.category
  if ('featured' in body) out.featured = Boolean(body.featured)
  if ('metrics' in body) out.metrics = body.metrics
  if ('media' in body) out.media = sanitizeMedia(body.media)
  if ('rowIndex' in body) out.row_index = coerceRowIndex(body.rowIndex)
  if ('sortOrder' in body) out.sort_order = body.sortOrder
  if ('isVisible' in body) out.is_visible = Boolean(body.isVisible)
  // Campaign fields: empty ⇒ NULL (the modal shows a quiet "~"). Dates pass through
  // as ISO strings; total_views accepts compact ("3.4M") or raw, parsed to a number.
  if ('startDate' in body) out.start_date = nullableDate(body.startDate)
  if ('endDate' in body) out.end_date = nullableDate(body.endDate)
  if ('totalViews' in body) out.total_views = parseCompact(body.totalViews as string | number | null | undefined)
  return out
}

// Coerce a form date value to an ISO date string or null (blank ⇒ cleared column).
function nullableDate(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// Map a snake_case portfolio_brands row → the camelCase AdminBrand the editor reads.
// (rowIndex is undefined rather than null — PortfolioBrand types it `number | undefined`;
// every consumer only checks `=== 1 || === 2`, so this is behaviour-identical.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBrand(r: any): AdminBrand {
  return {
    id: r.id,
    brand: r.brand,
    website: r.website ?? '',
    logoUrl: r.logo_url ?? '',
    blurb: r.blurb ?? '',
    campaignTitle: r.campaign_title ?? '',
    category: r.category ?? '',
    featured: Boolean(r.featured),
    isVisible: r.is_visible ?? true,
    sortOrder: r.sort_order ?? 0,
    metrics: r.metrics ?? {},
    media: Array.isArray(r.media) ? r.media : [],
    rowIndex: r.row_index === 1 || r.row_index === 2 ? r.row_index : undefined,
    startDate: r.start_date ?? null,
    endDate: r.end_date ?? null,
    totalViews: r.total_views != null ? Number(r.total_views) : null,
  }
}

// GET: all brands ordered by sort_order, mapped to AdminBrand[].
export async function readBrands(): Promise<AdminBrand[]> {
  const sb = client()
  const { data, error } = await sb
    .from('portfolio_brands')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapBrand)
}

// POST: insert one brand (brand name required, as the route enforced).
export async function createBrand(payload: BrandWriteInput): Promise<AdminBrand> {
  const sb = client()
  if (typeof payload.brand !== 'string' || payload.brand.trim() === '') {
    throw new Error('brand is required')
  }
  const row = mapBody(payload as Record<string, unknown>)
  const { data, error } = await sb.from('portfolio_brands').insert(row).select().single()
  if (error) throw new Error(error.message)
  return mapBrand(data)
}

// PUT (single-update branch): partial update of one brand.
export async function updateBrand(id: string, patch: BrandWriteInput): Promise<void> {
  const sb = client()
  const updates = mapBody(patch as Record<string, unknown>)
  if (Object.keys(updates).length === 0) throw new Error('No updatable fields provided')
  const { error } = await sb.from('portfolio_brands').update(updates).eq('id', id).select().single()
  if (error) throw new Error(error.message)
}

// DELETE: remove one brand by id.
export async function deleteBrand(id: string): Promise<void> {
  const sb = client()
  const { error } = await sb.from('portfolio_brands').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// PUT (bulk-reorder branch): re-sequence sort_order = index so a drag that moves a row
// across many positions is ONE pass of parallel partial UPDATEs (never upsert — that
// would null other columns). Entries carrying rowIndex also lock in the carousel lane.
export async function reorderBrands(order: ReorderItem[]): Promise<void> {
  const sb = client()
  const items = order
    .map((x) =>
      typeof x === 'string'
        ? { id: x }
        : x && typeof x === 'object'
          ? (x as { id?: unknown; rowIndex?: unknown })
          : null,
    )
    .filter((x): x is { id: string; rowIndex?: unknown } => !!x && typeof x.id === 'string')
  if (items.length === 0) throw new Error('order must be a non-empty array of ids')
  const results = await Promise.all(
    items.map((it, i) => {
      const patch: Record<string, unknown> = { sort_order: i }
      if ('rowIndex' in it) patch.row_index = coerceRowIndex(it.rowIndex)
      return sb.from('portfolio_brands').update(patch).eq('id', it.id)
    }),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
}
