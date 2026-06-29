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
import { rehostImage } from '../_shared/rehost.ts'

const SC_BASE = 'https://api.scrapecreators.com'
const SC_TIMEOUT = 20_000

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

  // 3) Fetch the single post (1 credit).
  const { data, error, status } = await fetchPost(platform, postUrl)
  if (error || !data) return json({ error: error ?? 'Could not read that post.' }, status)

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
    },
    200,
  )
})
