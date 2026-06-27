import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin, getAdminReadClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCompact, type BrandMedia } from '@/lib/mediakit-types'
import { detectPostPlatform } from '@/lib/social/scrape'

// rowIndex is only 1 or 2 (a real carousel lane); anything else ⇒ null (Auto-split).
// Shared by the single-update (mapBody) and bulk-reorder paths so they can't drift.
function coerceRowIndex(v: unknown): 1 | 2 | null {
  return v === 1 || v === 2 ? v : null
}

// Validate + coerce the client's `media` array at the boundary — never store raw
// client jsonb. Caps length, whitelists fields, parses compact counts ("1.8M"), drops
// empties. (views/likes arrive as strings from the form; empty ⇒ omitted, not 0.)
function sanitizeMedia(input: unknown): BrandMedia[] {
  if (!Array.isArray(input)) return []
  const out: BrandMedia[] = []
  for (const raw of input.slice(0, 12)) {
    const m = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const url = typeof m.url === 'string' ? m.url.trim().slice(0, 600) : ''
    if (!url) continue
    const item: BrandMedia = { type: 'video', url }
    // Platform: trust the client value, else derive from the URL host so an Instagram
    // reel saved WITHOUT clicking "Fetch" still renders with the right badge — without
    // it, mapRealContent defaults any non-'instagram' value to 'tiktok'.
    if (m.platform === 'instagram' || m.platform === 'tiktok') item.platform = m.platform
    else {
      const p = detectPostPlatform(url)
      if (p) item.platform = p
    }
    if (typeof m.thumbUrl === 'string' && m.thumbUrl.trim()) item.thumbUrl = m.thumbUrl.trim().slice(0, 600)
    if (typeof m.caption === 'string' && m.caption.trim()) item.caption = m.caption.trim().slice(0, 300)
    // Counts are user-typed: accept compact "1.8M"/"740K"/"1,234,567" (parseCompact),
    // not just raw integers. Empty/unparseable ⇒ omitted (not stored as 0).
    for (const k of ['views', 'likes'] as const) {
      const n = parseCompact(m[k] as string | number | null | undefined)
      if (n != null && n >= 0) item[k] = n
    }
    out.push(item)
  }
  return out
}

// Admin CRUD for portfolio_brands. Every method is passphrase-gated by
// requireAdmin (the entire security boundary). Reads use getAdminReadClient
// (service-role with anon fallback); writes use getSupabaseAdmin (service-role
// only, guarded — 503 if the key is unset). Client input is never trusted: each
// writable column is mapped explicitly from a whitelisted body field.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Whitelist + map an incoming JSON body to snake_case columns. Only keys the
// caller actually sent are included, so PUT becomes a partial update.
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
  return out
}

// Map a snake_case portfolio_brands row → the camelCase shape PortfolioManager
// reads directly off res.json() (a DIRECT array, NOT wrapped in { data }).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBrand(r: any) {
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
    rowIndex: r.row_index === 1 || r.row_index === 2 ? r.row_index : null,
  }
}

async function parseBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  const sb = getAdminReadClient()
  const { data, error } = await sb
    .from('portfolio_brands')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // PortfolioManager reads a DIRECT camelCase array (not { data }).
  return Response.json((data ?? []).map(mapBrand))
}

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  let sb: SupabaseClient
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  const body = await parseBody(req)
  if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  if (typeof body.brand !== 'string' || body.brand.trim() === '') {
    return Response.json({ error: 'brand is required' }, { status: 400 })
  }

  const row = mapBody(body)
  const { data, error } = await sb.from('portfolio_brands').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function PUT(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  let sb: SupabaseClient
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  const body = await parseBody(req)
  if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Bulk reorder: { order: [id, id, ...] } → re-sequence sort_order = index, so a
  // drag that moves a row across many positions is ONE request (vs N neighbour
  // swaps). Per-row partial UPDATEs (never upsert — that would null other columns).
  if (Array.isArray(body.order)) {
    // Each entry is either an id (sort only) or { id, rowIndex } (sort + lane). The
    // two-lane editor sends objects so ONE request re-sequences sort_order AND writes
    // the explicit carousel row for every brand (locking in the lane split).
    const items = (body.order as unknown[])
      .map((x) =>
        typeof x === 'string'
          ? { id: x }
          : x && typeof x === 'object'
            ? (x as { id?: unknown; rowIndex?: unknown })
            : null,
      )
      .filter((x): x is { id: string; rowIndex?: unknown } => !!x && typeof x.id === 'string')
    if (items.length === 0) {
      return Response.json({ error: 'order must be a non-empty array of ids' }, { status: 400 })
    }
    const results = await Promise.all(
      items.map((it, i) => {
        const patch: Record<string, unknown> = { sort_order: i }
        if ('rowIndex' in it) patch.row_index = coerceRowIndex(it.rowIndex)
        return sb.from('portfolio_brands').update(patch).eq('id', it.id)
      }),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (typeof body.id !== 'string' || body.id.trim() === '') {
    return Response.json({ error: 'id is required' }, { status: 400 })
  }

  const updates = mapBody(body)
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('portfolio_brands')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function DELETE(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  let sb: SupabaseClient
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  const { error } = await sb.from('portfolio_brands').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
