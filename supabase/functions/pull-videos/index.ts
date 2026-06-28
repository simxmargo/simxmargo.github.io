// `pull-videos` Edge Function — bulk-supply tool for the admin Brand Partners editor.
//
// Flow (the static /admin SPA has no server, so this Deno function does the work):
//   1. Verify the caller is the admin — build an anon client carrying the caller's
//      Authorization header and `rpc('is_admin')`. NEVER trust the client; 403 if false.
//   2. Fetch a creator's OWN recent posts by handle via the ScrapeCreators managed API
//      (a plain server fetch of TikTok only ever returns the SlardarWAF JS-challenge
//      shell — the wall is JS execution, not auth). Capped to MAX_ITEMS to bound credit
//      spend (ScrapeCreators bills 1 credit per page).
//   3. Re-host each cover to the public `media` bucket (TikTok/IG covers carry a ~6h TTL
//      and expire) with a service-role client → a PERMANENT public URL.
//   4. Auto-match each video to a managed brand by scanning its caption for the brand
//      name (ported from lib/social/brandMatch.ts). Best-effort; the admin reviews.
//   5. Return the videos for the modal to review. We DO NOT write portfolio_brands here —
//      the browser persists the admin's chosen videos after review (RLS = is_admin()).
//
// Secrets: SCRAPECREATORS_API_KEY must be set (`npm run sb -- secrets set ...`).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
//
// Deploy:  npm run sb -- functions deploy pull-videos
//   (JWT verification stays ON — this is admin-only; the is_admin() RPC is the gate.)

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'

// ── ScrapeCreators client (ported from lib/social/scrapeCreators.ts → Deno) ──────────
interface RawVideo {
  id: string
  url: string
  caption: string
  cover: string // signed/expiring CDN url — re-host before persisting
  views: number | null
  likes: number | null
  platform: 'tiktok' | 'instagram'
}

interface PullResult {
  videos: RawVideo[]
  note?: string // soft "nothing found" (HTTP 200)
  error?: string // hard failure
  status: number // HTTP status to return
}

const SC_BASE = 'https://api.scrapecreators.com'
const SC_TIMEOUT = 20_000
// Cap the pull HARD: ScrapeCreators bills 1 credit/page, so few pages = low spend, and a
// short review list is friendlier than a prolific creator's whole back-catalog. 1–2 pages
// (TikTok ~30/page, IG ~12/page) comfortably fills MAX_ITEMS.
const MAX_PAGES = 2
const MAX_ITEMS = 12

const scNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null

// ScrapeCreators returns CDN images as { url_list: [string, ...] } (TikTok). Pull the first.
// deno-lint-ignore no-explicit-any
const firstUrl = (o: any): string => (Array.isArray(o?.url_list) && typeof o.url_list[0] === 'string' ? o.url_list[0] : '')

// deno-lint-ignore no-explicit-any
function mapTikTok(j: any, handle: string): RawVideo[] {
  const list = Array.isArray(j?.aweme_list) ? j.aweme_list : []
  const out: RawVideo[] = []
  for (const it of list) {
    const id = String(it?.aweme_id ?? '')
    if (!id) continue
    const v = it?.video ?? {}
    // Prefer dynamic_cover (served as image/webp → browser-renderable + re-hostable);
    // the static cover/origin_cover come back as image/heic, which an <img> can't show.
    const cover = firstUrl(v.dynamic_cover) || firstUrl(v.cover) || firstUrl(v.origin_cover)
    const stats = it?.statistics ?? {}
    out.push({
      id,
      url: typeof it?.share_url === 'string' && it.share_url ? it.share_url : `https://www.tiktok.com/@${handle}/video/${id}`,
      caption: typeof it?.desc === 'string' ? it.desc : '',
      cover,
      views: scNum(stats.play_count),
      likes: scNum(stats.digg_count),
      platform: 'tiktok',
    })
  }
  return out
}

// deno-lint-ignore no-explicit-any
function mapInstagram(j: any): RawVideo[] {
  const items = Array.isArray(j?.items) ? j.items : []
  const out: RawVideo[] = []
  for (const it of items) {
    const id = String(it?.pk ?? it?.code ?? '')
    if (!id) continue
    const cands = it?.image_versions2?.candidates
    const cover =
      (Array.isArray(cands) && typeof cands[0]?.url === 'string' ? cands[0].url : '') ||
      (typeof it?.display_uri === 'string' ? it.display_uri : '')
    const code = typeof it?.code === 'string' ? it.code : ''
    const url = typeof it?.url === 'string' && it.url ? it.url : code ? `https://www.instagram.com/p/${code}/` : ''
    if (!url) continue // no permalink derivable → can't link or dedup; drop it
    out.push({
      id,
      url,
      caption: typeof it?.caption?.text === 'string' ? it.caption.text : '',
      cover,
      views: scNum(it?.play_count ?? it?.ig_play_count),
      likes: scNum(it?.like_count),
      platform: 'instagram',
    })
  }
  return out
}

// deno-lint-ignore no-explicit-any
function pageCursor(platform: 'tiktok' | 'instagram', j: any): { hasMore: boolean; cursor: string | null } {
  if (platform === 'tiktok') {
    const hasMore = j?.has_more === 1 || j?.has_more === true
    const c = j?.max_cursor
    return { hasMore, cursor: c != null && c !== 0 && c !== '0' ? String(c) : null }
  }
  const c = j?.next_max_id
  return { hasMore: j?.more_available === true, cursor: typeof c === 'string' && c ? c : null }
}

function pageUrl(platform: 'tiktok' | 'instagram', h: string, cursor: string | null): string {
  const eh = encodeURIComponent(h)
  if (platform === 'tiktok') {
    return `${SC_BASE}/v3/tiktok/profile/videos?handle=${eh}${cursor ? `&max_cursor=${encodeURIComponent(cursor)}` : ''}`
  }
  return `${SC_BASE}/v2/instagram/user/posts?handle=${eh}${cursor ? `&next_max_id=${encodeURIComponent(cursor)}` : ''}`
}

// Page through a handle's recent posts (dedup by id) and normalize to RawVideo. Returns
// whatever paged successfully if a later page fails (partial > nothing).
async function fetchProfilePosts(platform: 'tiktok' | 'instagram', handle: string): Promise<PullResult> {
  const key = Deno.env.get('SCRAPECREATORS_API_KEY')?.trim()
  if (!key) {
    return {
      videos: [],
      status: 503,
      error:
        'ScrapeCreators API key not configured. Set SCRAPECREATORS_API_KEY as an Edge Function secret (free key at scrapecreators.com).',
    }
  }
  const h = handle.replace(/^@/, '').trim()
  const headers = { 'x-api-key': key, accept: 'application/json' }

  const seen = new Set<string>()
  const all: RawVideo[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    let res: Response
    try {
      res = await fetch(pageUrl(platform, h, cursor), { headers, signal: AbortSignal.timeout(SC_TIMEOUT) })
    } catch (e) {
      if (all.length > 0) break // keep the pages we already have
      const timedOut = e instanceof Error && e.name === 'TimeoutError'
      return { videos: [], status: 502, error: timedOut ? 'ScrapeCreators request timed out.' : 'Could not reach ScrapeCreators.' }
    }
    if (!res.ok) {
      if (all.length > 0) break
      const hint =
        res.status === 401 || res.status === 403
          ? ' API key rejected.'
          : res.status === 402
            ? ' Out of ScrapeCreators credits.'
            : res.status === 404
              ? ` Handle @${h} not found.`
              : res.status === 429
                ? ' Rate limited — try again shortly.'
                : ''
      return { videos: [], status: 502, error: `ScrapeCreators error (HTTP ${res.status}).${hint}` }
    }

    let j: unknown = null
    try {
      j = await res.json()
    } catch {
      j = null
    }
    const pageVids = platform === 'tiktok' ? mapTikTok(j, h) : mapInstagram(j)
    for (const v of pageVids) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      all.push(v)
    }
    const { hasMore, cursor: next } = pageCursor(platform, j)
    if (!hasMore || !next || pageVids.length === 0 || all.length >= MAX_ITEMS) break
    cursor = next
  }

  if (all.length === 0) {
    return { videos: [], status: 200, note: `No posts found for @${h}. Double-check the handle.` }
  }
  return { videos: all.slice(0, MAX_ITEMS), status: 200 }
}

// ── Cover re-host (ported from lib/social/rehost.ts → Deno) ──────────────────────────
const REHOST_UA = 'simxmargo-mediakit/1.0 (+https://simxmargo.com)'
const THUMB_MAX = 5 * 1024 * 1024
const BUCKET = 'media'
const REHOST_TIMEOUT = 9000

// Hosts we'll download a cover from: the platforms' OWN signed CDNs only. Keeps this off
// the SSRF surface — it can never be pointed at an arbitrary/internal host.
function isAllowedThumbHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return /\.tiktokcdn(-us|-eu)?\.com$/.test(h) || /\.cdninstagram\.com$/.test(h) || /\.fbcdn\.net$/.test(h)
}

// SSRF defense-in-depth: block hostnames/IP literals that point at the deploy's own
// network (loopback, link-local incl. 169.254.169.254 metadata, RFC1918, CGNAT, etc.).
// Ported from lib/scrape/meta.ts (the IP-literal branches only — the thumb hosts are
// always real CDN domains, but this still rejects a domain that resolves to a literal).
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2])
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true
    if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true
    if (h.startsWith('::ffff:')) return true
    return false
  }
  return false
}

// True only if the host resolves AND every resolved address is public. Deno.resolveDns is
// best-effort in the edge runtime — if it's unavailable/denied we fall back to the strict
// CDN-domain allowlist (isAllowedThumbHost) as the primary guard.
async function resolvesPublic(host: string): Promise<boolean> {
  if (isBlockedHost(host)) return false
  try {
    if (typeof Deno.resolveDns !== 'function') return true
    const addrs = await Deno.resolveDns(host, 'A')
    return addrs.length > 0 && !addrs.some((a) => isBlockedHost(a))
  } catch {
    // resolveDns unavailable/denied/failed — defer to the host allowlist.
    return true
  }
}

// Download a remote (expiring) cover and re-upload to the public `media` bucket → a
// permanent URL. Returns '' on ANY failure so the caller falls back to the raw cover.
async function rehostImage(sb: ReturnType<typeof createClient>, rawUrl: string, folder = 'videos'): Promise<string> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return ''
  }
  if (u.protocol !== 'https:' || !isAllowedThumbHost(u.hostname)) return ''
  if (!(await resolvesPublic(u.hostname))) return ''
  try {
    const res = await fetch(u.toString(), {
      headers: { 'user-agent': REHOST_UA, accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(REHOST_TIMEOUT),
    })
    if (!res.ok) return ''
    const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase()
    // Raster allowlist only — reject image/svg+xml (can carry script) since the file is
    // served from a public bucket.
    if (!/^image\/(jpe?g|png|webp|gif|avif)$/.test(ct)) return ''
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > THUMB_MAX) return ''
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : ct.includes('avif') ? 'avif' : 'jpg'
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: false })
    if (error) return ''
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return ''
  }
}

// ── Caption → brand matching (ported verbatim from lib/social/brandMatch.ts) ─────────
interface MatchBrand {
  id: string
  brand: string
  website?: string
}

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function brandAliases(b: MatchBrand): string[] {
  const set = new Set<string>()
  const n = norm(b.brand)
  if (n) set.add(n)
  if (b.website) {
    try {
      const host = new URL(b.website.startsWith('http') ? b.website : `https://${b.website}`).hostname.replace(/^www\./, '')
      const root = host.split('.')[0]
      if (root) set.add(norm(root))
    } catch {
      /* not a parseable URL — skip the domain alias */
    }
  }
  return [...set].filter((a) => a.length >= 3)
}

function captionTokens(caption: string): string[] {
  return (caption || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

// The brand ids whose aliases appear in the caption, ordered MOST-SPECIFIC FIRST
// (longest matching alias).
function matchCaption(caption: string, brands: MatchBrand[]): string[] {
  const tokens = captionTokens(caption)
  if (tokens.length === 0) return []
  const tokenSet = new Set(tokens)
  const joined = tokens.join('')
  const scored: { id: string; len: number }[] = []
  for (const b of brands) {
    let best = 0
    for (const a of brandAliases(b)) {
      if (tokenSet.has(a) || (a.length >= 5 && joined.includes(a))) best = Math.max(best, a.length)
    }
    if (best > 0) scored.push({ id: b.id, len: best })
  }
  return scored.sort((x, y) => y.len - x.len).map((s) => s.id)
}

// ── Request handler ──────────────────────────────────────────────────────────────────
// Pull a full profile URL down to a bare handle ("https://www.tiktok.com/@x" → "x",
// "instagram.com/x/" → "x", "@x" → "x"). Platform comes from the body, not the URL.
function cleanHandle(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s) || s.includes('/')) {
    try {
      const u = new URL(s.startsWith('http') ? s : `https://${s}`)
      const seg = u.pathname.split('/').filter(Boolean)[0] ?? ''
      const first = seg.replace(/^@/, '')
      if (first) return first
    } catch {
      /* not a URL — fall through */
    }
  }
  return s.replace(/^@/, '')
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1) Verify the caller is the admin — anon client carrying the caller's JWT, then
  //    rpc('is_admin'). Never trust the client; an unauthenticated/non-admin caller 403s
  //    BEFORE any credit-spending external fetch.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Not authorized.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authed = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: isAdmin, error: adminErr } = await authed.rpc('is_admin')
  if (adminErr || isAdmin !== true) return json({ error: 'Admin only.' }, 403)

  // 2) Parse + validate the body.
  let body: Record<string, unknown> | null = null
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const platform = body?.platform === 'instagram' ? 'instagram' : body?.platform === 'tiktok' ? 'tiktok' : null
  if (!platform) return json({ error: 'platform must be "tiktok" or "instagram".' }, 400)
  const handle = cleanHandle(String(body?.handle ?? ''))
  if (!handle) return json({ error: 'Enter a handle or profile URL.' }, 400)

  // 3) Fetch the creator's recent posts (capped).
  const pulled = await fetchProfilePosts(platform, handle)
  if (pulled.error) return json({ error: pulled.error }, pulled.status)
  if (pulled.videos.length === 0) return json({ videos: [], note: pulled.note ?? 'No posts found.' }, 200)

  // 4) Service-role client for re-hosting + reading the brand list (both bypass RLS;
  //    the admin check above is the gate).
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: brandRows } = await service.from('portfolio_brands').select('id, brand, website')
  const brands: MatchBrand[] = (brandRows ?? []).map((b) => ({
    id: String(b.id),
    brand: String(b.brand ?? ''),
    website: typeof b.website === 'string' ? b.website : undefined,
  }))
  const brandById = new Map(brands.map((b) => [b.id, b]))

  // 5) Re-host every cover to a permanent URL (parallel), then auto-match by caption.
  const videos = await Promise.all(
    pulled.videos.map(async (v) => {
      const rehosted = v.cover ? await rehostImage(service, v.cover) : ''
      const suggestedBrandId = matchCaption(v.caption, brands)[0] ?? null
      return {
        id: v.id,
        url: v.url,
        cover: rehosted || v.cover, // permanent URL, or the raw (expiring) cover as a fallback
        caption: v.caption,
        platform: v.platform,
        views: v.views,
        likes: v.likes,
        suggestedBrandId,
        suggestedBrand: suggestedBrandId ? brandById.get(suggestedBrandId)?.brand ?? null : null,
      }
    }),
  )

  return json({ videos }, 200)
})
