// SERVER-ONLY. Fetch a creator's OWN recent posts from TikTok / Instagram via the
// ScrapeCreators managed API (https://scrapecreators.com) and normalize them to RawVideo.
//
// This REPLACED the old cookie-based profile scrape. A plain server-side fetch() of a
// TikTok profile only ever returns TikTok's ~1.5KB "SlardarWAF" JavaScript-challenge
// shell — identical with or without a session cookie (verified empirically) — because
// the wall is JS execution, not auth. ScrapeCreators runs the JS-walled fetch for us and
// returns structured JSON. Covers come back on the platforms' OWN CDNs
// (*.tiktokcdn(-us).com / *.cdninstagram.com / *.fna.fbcdn.net), so the existing re-host
// allowlist (isAllowedThumbHost) covers them unchanged — see add-videos + rehost.
//
// Auth: a single x-api-key header (env SCRAPECREATORS_API_KEY). The host is fixed to
// api.scrapecreators.com, so unlike the old route there is no SSRF surface to guard.
// Docs: https://docs.scrapecreators.com — see docs/mediakit-social-oauth-sync.md §8b.

export interface RawVideo {
  id: string
  url: string
  caption: string
  cover: string // signed/expiring CDN url — re-host before persisting (add-videos does this)
  views: number | null
  likes: number | null
  platform: 'tiktok' | 'instagram'
}

export interface PullResult {
  videos: RawVideo[]
  note?: string // soft "nothing found" message (HTTP 200)
  error?: string // hard failure message
  status: number // HTTP status the route should return
}

const BASE = 'https://api.scrapecreators.com'
const TIMEOUT = 20_000

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null

// ScrapeCreators returns CDN images as { url_list: [string, ...] } (TikTok). Pull the first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firstUrl = (o: any): string => (Array.isArray(o?.url_list) && typeof o.url_list[0] === 'string' ? o.url_list[0] : '')

// TikTok: /v3/tiktok/profile/videos → { aweme_list: [...] }. `handle` is used only to
// build the canonical /@<handle>/video/<id> permalink when share_url is absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTikTok(json: any, handle: string): RawVideo[] {
  const list = Array.isArray(json?.aweme_list) ? json.aweme_list : []
  const out: RawVideo[] = []
  for (const it of list) {
    const id = String(it?.aweme_id ?? '')
    if (!id) continue
    const v = it?.video ?? {}
    // Prefer dynamic_cover: TikTok serves it as image/webp (browser-renderable + re-hostable),
    // whereas the static cover/origin_cover come back as image/heic, which an <img> can't show.
    const cover = firstUrl(v.dynamic_cover) || firstUrl(v.cover) || firstUrl(v.origin_cover)
    const stats = it?.statistics ?? {}
    out.push({
      id,
      url: typeof it?.share_url === 'string' && it.share_url ? it.share_url : `https://www.tiktok.com/@${handle}/video/${id}`,
      caption: typeof it?.desc === 'string' ? it.desc : '',
      cover,
      views: num(stats.play_count),
      likes: num(stats.digg_count),
      platform: 'tiktok',
    })
  }
  return out
}

// Instagram: /v2/instagram/user/posts → { items: [...] }. `caption` can be null;
// reels carry play_count, photos don't; carousels (media_type 8) still expose a
// representative thumbnail at the top level, which is all this tool needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInstagram(json: any): RawVideo[] {
  const items = Array.isArray(json?.items) ? json.items : []
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
    if (!url) continue // no permalink derivable → unusable (can't link or dedup); drop it
    out.push({
      id,
      url,
      caption: typeof it?.caption?.text === 'string' ? it.caption.text : '',
      cover,
      views: num(it?.play_count ?? it?.ig_play_count),
      likes: num(it?.like_count),
      platform: 'instagram',
    })
  }
  return out
}

// Per-page cursor + has-more, platform-shaped. TikTok: has_more (0/1) + max_cursor;
// Instagram: more_available (bool) + next_max_id (string).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageCursor(platform: 'tiktok' | 'instagram', json: any): { hasMore: boolean; cursor: string | null } {
  if (platform === 'tiktok') {
    const hasMore = json?.has_more === 1 || json?.has_more === true
    const c = json?.max_cursor
    return { hasMore, cursor: c != null && c !== 0 && c !== '0' ? String(c) : null }
  }
  const c = json?.next_max_id
  return { hasMore: json?.more_available === true, cursor: typeof c === 'string' && c ? c : null }
}

function pageUrl(platform: 'tiktok' | 'instagram', h: string, cursor: string | null): string {
  const eh = encodeURIComponent(h)
  if (platform === 'tiktok') {
    return `${BASE}/v3/tiktok/profile/videos?handle=${eh}${cursor ? `&max_cursor=${encodeURIComponent(cursor)}` : ''}`
  }
  return `${BASE}/v2/instagram/user/posts?handle=${eh}${cursor ? `&next_max_id=${encodeURIComponent(cursor)}` : ''}`
}

// ScrapeCreators bills 1 credit per page; cap the pull so a prolific creator can't burn
// many credits or build an unwieldy review list. ~5 pages covers the recent back-catalog.
const MAX_PAGES = 5
const MAX_ITEMS = 60

// Page through a handle's recent posts (dedup by id) and normalize to RawVideo. Returns
// whatever paged successfully if a later page fails (partial > nothing).
export async function fetchProfilePosts(platform: 'tiktok' | 'instagram', handle: string): Promise<PullResult> {
  const key = process.env.SCRAPECREATORS_API_KEY?.trim()
  if (!key) {
    return {
      videos: [],
      status: 503,
      error: 'ScrapeCreators API key not configured. Add SCRAPECREATORS_API_KEY to the server environment (free key at scrapecreators.com).',
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
      res = await fetch(pageUrl(platform, h, cursor), { headers, signal: AbortSignal.timeout(TIMEOUT) })
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

    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    const pageVids = platform === 'tiktok' ? mapTikTok(json, h) : mapInstagram(json)
    for (const v of pageVids) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      all.push(v)
    }
    const { hasMore, cursor: next } = pageCursor(platform, json)
    if (!hasMore || !next || pageVids.length === 0 || all.length >= MAX_ITEMS) break
    cursor = next
  }

  if (all.length === 0) {
    return { videos: [], status: 200, note: `No posts found for @${h}. Double-check the handle.` }
  }
  return { videos: all.slice(0, MAX_ITEMS), status: 200 }
}
