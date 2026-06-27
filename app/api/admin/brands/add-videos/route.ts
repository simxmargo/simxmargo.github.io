import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { rehostImage } from '@/lib/social/rehost'
import type { BrandMedia } from '@/lib/mediakit-types'

// Commit pulled videos into brands' "Top content". Body: { assignments: [{ brandId,
// video }] }. Per brand: read current media, re-host each cover (the source url is
// signed/expiring), map → BrandMedia, append (dedup by url), cap at 24, save. The
// re-host is why this is a server step, not a client media PUT.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface IncomingVideo {
  url?: unknown
  caption?: unknown
  cover?: unknown
  views?: unknown
  likes?: unknown
  platform?: unknown
}

// The persisted url is rendered as an <a href> in the portfolio (PortfolioGrid), so
// only ever store an absolute http(s) link — never a javascript:/data: scheme.
function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u).protocol
    return p === 'https:' || p === 'http:'
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  let body: { assignments?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const assignments = Array.isArray(body.assignments) ? body.assignments : null
  if (!assignments || assignments.length === 0) {
    return Response.json({ error: 'No assignments provided.' }, { status: 400 })
  }

  // Group videos by brand (cap total work to keep the request bounded).
  const byBrand = new Map<string, IncomingVideo[]>()
  for (const a of assignments.slice(0, 200) as { brandId?: unknown; video?: IncomingVideo }[]) {
    if (!a || typeof a.brandId !== 'string' || !a.video || typeof a.video !== 'object') continue
    const list = byBrand.get(a.brandId) ?? []
    list.push(a.video)
    byBrand.set(a.brandId, list)
  }
  if (byBrand.size === 0) return Response.json({ error: 'No valid assignments.' }, { status: 400 })

  const CAP = 24
  let added = 0
  let skipped = 0
  for (const [brandId, vids] of byBrand) {
    const { data: row, error } = await sb.from('portfolio_brands').select('media').eq('id', brandId).single()
    if (error || !row) {
      skipped += vids.length
      continue
    }
    const existing: BrandMedia[] = Array.isArray(row.media) ? row.media : []
    const urls = new Set(existing.map((m) => m.url))
    // Filter to new, non-duplicate urls FIRST, then cap to the remaining room — so we
    // never re-host (slow) a cover we're about to drop, and never silently overflow the cap.
    const candidates: IncomingVideo[] = []
    for (const v of vids) {
      const url = typeof v.url === 'string' ? v.url.trim() : ''
      if (!url || !isHttpUrl(url) || urls.has(url)) {
        skipped++
        continue
      }
      urls.add(url)
      candidates.push(v)
    }
    const room = Math.max(0, CAP - existing.length)
    const capped = candidates.slice(0, room)
    skipped += candidates.length - capped.length // dropped because the brand is at the cap
    if (capped.length === 0) continue
    const fresh: BrandMedia[] = []
    for (const v of capped) {
      const url = (v.url as string).trim().slice(0, 600)
      const rawCover = typeof v.cover === 'string' ? v.cover : ''
      const cover = rawCover ? (await rehostImage(rawCover)) || '' : ''
      const item: BrandMedia = { type: 'video', url, platform: v.platform === 'instagram' ? 'instagram' : 'tiktok' }
      if (cover) item.thumbUrl = cover
      if (typeof v.caption === 'string' && v.caption.trim()) item.caption = v.caption.trim().slice(0, 300)
      if (typeof v.views === 'number' && v.views >= 0) item.views = Math.trunc(v.views)
      if (typeof v.likes === 'number' && v.likes >= 0) item.likes = Math.trunc(v.likes)
      fresh.push(item)
    }
    const merged = [...existing, ...fresh]
    const { error: upErr } = await sb.from('portfolio_brands').update({ media: merged }).eq('id', brandId)
    if (upErr) {
      skipped += fresh.length
      continue
    }
    added += fresh.length
  }

  return Response.json({ ok: true, added, skipped })
}
