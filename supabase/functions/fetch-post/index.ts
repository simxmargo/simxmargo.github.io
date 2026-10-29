// `fetch-post` Edge Function — single-post auto-fill for the Brand editor's "Top content".
//
// Paste ONE TikTok video / Instagram reel URL → this returns its cover (re-hosted to a
// permanent URL), caption, view count and like count, so the editor can auto-fill the row.
// It's the per-URL sibling of `pull-videos` (per-handle), and shares its security model:
//   1. Admin-only — anon client carrying the caller's JWT + rpc('is_admin'); 403 BEFORE
//      any credit-spending external fetch. Never trust the client.
//   2. ScrapeCreators managed API does the JS-walled fetch (a plain server fetch of a
//      TikTok/IG post only returns a JS-challenge / login-wall shell). 1 credit per call.
//   3. Re-host the cover to the public `media` bucket (the CDN url expires in ~6h).
//   4. No credits / no key / ScrapeCreators down → read the public post page instead (free;
//      Instagram has no public view count) and say so in `notice`.
//
// ScrapeCreators single-post endpoints:
//   TikTok:    GET /v2/tiktok/video?url=<post>
//   Instagram: GET /v1/instagram/post?url=<post>
//
// Field paths vary by payload version, so extraction is DEFENSIVE (tries nested + flat).
//
// Secrets: SCRAPECREATORS_API_KEY (already set for pull-videos — no new secret needed).
// Deploy:  npm run sb -- functions deploy fetch-post   (JWT verification ON — admin only.)

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { decodeEntities, extractOgImage } from '../_shared/meta.ts'
import { rehostImage } from '../_shared/rehost.ts'

const SC_BASE = 'https://api.scrapecreators.com'
const SC_TIMEOUT = 20_000
const PUBLIC_TIMEOUT = 12_000

// Free fallback when ScrapeCreators can't answer (out of credits, key missing, outage).
// TikTok serves the full post JSON (counts included) to a normal browser; Instagram serves
// its link-preview tags (cover, caption, likes — never views) to a link-preview crawler.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const LINK_PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

interface PostFields {
  thumbUrl: string // raw (expiring) cover URL — re-hosted by the handler
  caption: string
  views: number | null
  likes: number | null
}

const scNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && /^\d+$/.test(v.trim())
      ? Number(v.trim())
      : null

// ScrapeCreators returns TikTok CDN images as { url_list: [string, ...] }; sometimes a
// bare string. Pull the first usable URL.
// deno-lint-ignore no-explicit-any
const firstUrl = (o: any): string =>
  typeof o === 'string' ? o : Array.isArray(o?.url_list) && typeof o.url_list[0] === 'string' ? o.url_list[0] : ''

function detectPlatform(raw: string): 'tiktok' | 'instagram' | null {
  try {
    const h = new URL(raw.trim()).hostname.replace(/^www\./, '').toLowerCase()
    if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok'
    if (h === 'instagram.com' || h.endsWith('.instagram.com')) return 'instagram'
  } catch {
    /* not a URL */
  }
  return null
}

// Map /v2/tiktok/video defensively: the post may be wrapped in `aweme_detail` (or `aweme`)
// or flat; stats may be nested under `statistics` or flat. Prefer dynamic_cover (served as
// image/webp → renderable + re-hostable) over the static cover/origin_cover (image/heic).
// deno-lint-ignore no-explicit-any
function mapTikTok(j: any): PostFields {
  const d = j?.aweme_detail ?? j?.aweme ?? j ?? {}
  const v = d.video ?? {}
  const s = d.statistics ?? d.stats ?? d
  return {
    thumbUrl: firstUrl(v.dynamic_cover) || firstUrl(v.cover) || firstUrl(v.origin_cover) || firstUrl(d.cover),
    caption: typeof d.desc === 'string' ? d.desc : typeof d.title === 'string' ? d.title : '',
    views: scNum(s.play_count ?? d.play_count),
    likes: scNum(s.digg_count ?? s.like_count ?? d.digg_count),
  }
}

// Map /v1/instagram/post defensively: payload is usually under data.xdt_shortcode_media;
// fall back to data / root and to the alternate flat field names.
// deno-lint-ignore no-explicit-any
function mapInstagram(j: any): PostFields {
  const m = j?.data?.xdt_shortcode_media ?? j?.xdt_shortcode_media ?? j?.data ?? j ?? {}
  const caption =
    m?.edge_media_to_caption?.edges?.[0]?.node?.text ??
    (typeof m?.caption === 'string' ? m.caption : m?.caption?.text) ??
    ''
  const cands = m?.image_versions2?.candidates
  return {
    thumbUrl:
      (typeof m?.thumbnail_src === 'string' ? m.thumbnail_src : '') ||
      (typeof m?.display_url === 'string' ? m.display_url : '') ||
      (typeof m?.display_uri === 'string' ? m.display_uri : '') ||
      (Array.isArray(cands) && typeof cands[0]?.url === 'string' ? cands[0].url : ''),
    caption: typeof caption === 'string' ? caption : '',
    views: scNum(m?.video_play_count ?? m?.video_view_count ?? m?.play_count ?? m?.ig_play_count),
    likes: scNum(m?.edge_media_preview_like?.count ?? m?.like_count ?? m?.edge_liked_by?.count),
  }
}

function endpoint(platform: 'tiktok' | 'instagram', url: string): string {
  const u = encodeURIComponent(url)
  return platform === 'tiktok' ? `${SC_BASE}/v2/tiktok/video?url=${u}` : `${SC_BASE}/v1/instagram/post?url=${u}`
}

async function fetchPost(
  platform: 'tiktok' | 'instagram',
  url: string,
): Promise<{ data?: PostFields; error?: string; status: number }> {
  const key = Deno.env.get('SCRAPECREATORS_API_KEY')?.trim()
  if (!key) {
    return {
      status: 503,
      error: 'ScrapeCreators API key not configured. Set SCRAPECREATORS_API_KEY as an Edge Function secret.',
    }
  }
  let res: Response
  try {
    res = await fetch(endpoint(platform, url), {
      headers: { 'x-api-key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(SC_TIMEOUT),
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return { status: 502, error: timedOut ? 'ScrapeCreators request timed out.' : 'Could not reach ScrapeCreators.' }
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? ' API key rejected.'
        : res.status === 402
          ? ' Out of ScrapeCreators credits.'
          : res.status === 404
            ? ' Post not found, private, or unsupported link.'
            : res.status === 429
              ? ' Rate limited — try again shortly.'
              : ''
    return { status: 502, error: `ScrapeCreators error (HTTP ${res.status}).${hint}` }
  }
  let j: unknown = null
  try {
    j = await res.json()
  } catch {
    j = null
  }
  return { data: platform === 'tiktok' ? mapTikTok(j) : mapInstagram(j), status: 200 }
}

// "19K" / "1.2M" / "1,234" → number. Instagram's preview text uses the compact form.
function compactCount(raw: string): number | null {
  const m = raw.replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i)
  if (!m) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return Math.round(Number(m[1]) * mult)
}

// Double-quoted <meta content> only: captions carry raw apostrophes ("it's"), which the
// shared any-quote matcher in _shared/meta.ts would cut off.
function metaDq(html: string, key: string): string {
  const m =
    html.match(new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]*?\\bcontent="([^"]*)"`, 'i')) ??
    html.match(new RegExp(`<meta[^>]+\\bcontent="([^"]*)"[^>]*?(?:property|name)="${key}"`, 'i'))
  return m ? decodeEntities(m[1]) : ''
}

// Short links (vt.tiktok.com) redirect, so redirects are followed BY HAND: every hop must
// stay https on the same platform's hosts before it's requested — never fetch off-platform.
async function fetchPage(url: string, ua: string, platform: 'tiktok' | 'instagram'): Promise<{ html: string; base: URL } | null> {
  const signal = AbortSignal.timeout(PUBLIC_TIMEOUT)
  try {
    let next = new URL(url)
    for (let hop = 0; hop <= 5; hop++) {
      if (next.protocol !== 'https:' || detectPlatform(next.href) !== platform) return null
      const res = await fetch(next, {
        headers: { 'user-agent': ua, accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' },
        redirect: 'manual',
        signal,
      })
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!loc) return res.ok ? { html: await res.text(), base: next } : null
      await res.body?.cancel()
      next = new URL(loc, next)
    }
  } catch {
    /* bad URL / network / timeout */
  }
  return null
}

// TikTok: the page embeds the post as JSON (__UNIVERSAL_DATA_FOR_REHYDRATION__), counts
// included. If that blob is missing, fall back to the og:image cover alone.
async function fetchTikTokPublic(url: string): Promise<PostFields | null> {
  const page = await fetchPage(url, BROWSER_UA, 'tiktok')
  if (!page) return null
  const blob = page.html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
  if (blob) {
    try {
      const item = JSON.parse(blob[1])?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct
      if (item) {
        const v = item.video ?? {}
        const s = item.stats ?? {}
        return {
          thumbUrl: (typeof v.dynamicCover === 'string' && v.dynamicCover) || (typeof v.cover === 'string' && v.cover) || '',
          caption: typeof item.desc === 'string' ? item.desc : '',
          views: scNum(s.playCount),
          likes: scNum(s.diggCount),
        }
      }
    } catch {
      /* malformed blob — use the tags below */
    }
  }
  const thumbUrl = extractOgImage(page.html, page.base)
  return thumbUrl ? { thumbUrl, caption: '', views: null, likes: null } : null
}

// Instagram: description reads `19K likes, 43 comments - simxmargo on February 20, 2026: "caption"`.
async function fetchInstagramPublic(url: string): Promise<PostFields | null> {
  const page = await fetchPage(url, LINK_PREVIEW_UA, 'instagram')
  if (!page) return null
  const desc = metaDq(page.html, 'og:description') || metaDq(page.html, 'description')
  const likes = desc.match(/^([\d.,]+\s*[KMB]?)\s+likes?\b/i)
  const caption = desc.match(/:\s*"([\s\S]*)"\.?\s*$/)
  const fields: PostFields = {
    thumbUrl: extractOgImage(page.html, page.base),
    caption: caption ? caption[1] : '',
    views: null,
    likes: likes ? compactCount(likes[1]) : null,
  }
  return fields.thumbUrl || fields.caption ? fields : null
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1) Admin gate BEFORE spending a credit.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Not authorized.' }, 401)
  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authed = createClient(supaUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: isAdmin, error: adminErr } = await authed.rpc('is_admin')
  if (adminErr || isAdmin !== true) return json({ error: 'Admin only.' }, 403)

  // 2) Validate the body + link.
  let body: Record<string, unknown> | null = null
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const postUrl = String(body?.url ?? '').trim()
  if (!postUrl) return json({ error: 'Paste a post URL.' }, 400)
  const platform = detectPlatform(postUrl)
  if (!platform) return json({ error: 'Only TikTok and Instagram links are supported.' }, 400)

  // 3) Fetch the single post (1 credit). If ScrapeCreators can't answer — out of credits
  //    above all — read the public page instead, so adding content never dead-ends.
  const sc = await fetchPost(platform, postUrl)
  let data = sc.data
  let notice: string | undefined
  if (sc.error || !data) {
    data = (platform === 'tiktok' ? await fetchTikTokPublic(postUrl) : await fetchInstagramPublic(postUrl)) ?? undefined
    if (!data) return json({ error: sc.error ?? 'Could not read that post.' }, sc.status)
    const why = sc.error?.includes('credits') ? 'Out of ScrapeCreators credits' : 'ScrapeCreators unavailable'
    const missing = [data.views == null && 'views', data.likes == null && 'likes', !data.caption && 'caption'].filter(Boolean)
    notice =
      `${why} — filled from the public ${platform === 'tiktok' ? 'TikTok' : 'Instagram'} page.` +
      (missing.length ? ` Type in the ${missing.join(' & ')}.` : '')
  }

  // 4) Re-host the cover (service role; the admin check above is the gate).
  const service = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const thumbUrl = data.thumbUrl ? await rehostImage(service, data.thumbUrl, 'content') : ''

  return json(
    {
      platform,
      thumbUrl: thumbUrl || data.thumbUrl, // permanent, or the raw (expiring) cover as a fallback
      caption: data.caption,
      views: data.views,
      likes: data.likes,
      ...(notice ? { notice } : {}),
    },
    200,
  )
})
