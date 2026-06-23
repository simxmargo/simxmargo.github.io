import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin, getAdminReadClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  if ('media' in body) out.media = body.media
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
    .order('featured', { ascending: false })
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
