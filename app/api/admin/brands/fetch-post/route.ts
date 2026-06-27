import { lookup } from 'node:dns/promises'
import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { isBlockedHost } from '@/lib/scrape/meta'
import { detectPostPlatform, tiktokOembedUrl, isAllowedThumbHost } from '@/lib/social/scrape'

// Enrich a brand "Top content" card from a pasted reel/post URL. This is a CONVENIENCE
// pre-fill (the admin reviews + saves; nothing is written to the brand here).
//   • TikTok → KEYLESS oEmbed gives a thumbnail + caption. We RE-HOST the thumbnail
//     into our public storage because TikTok's CDN url is signed with an ~1-month
//     expiry (x-expires) and would otherwise 404 later.
//   • Instagram → posts are login-walled (no keyless thumbnail/caption); the admin
//     pastes a cover + caption and types the counts.
//   • view/like counts are NEVER returned — they aren't fetchable keyless on either
//     platform (verified); the creator types them.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UA = 'simxmargo-mediakit/1.0 (+https://simxmargo.com)'
const THUMB_MAX = 5 * 1024 * 1024
const BUCKET = 'media'
const TIMEOUT = 9000

// True only if the host resolves AND every resolved address is public (SSRF guard).
async function resolvesPublic(host: string): Promise<boolean> {
  if (isBlockedHost(host)) return false
  try {
    const addrs = await lookup(host, { all: true })
    return addrs.length > 0 && !addrs.some((a) => isBlockedHost(a.address))
  } catch {
    return false
  }
}

// Download a remote thumbnail and re-upload it to our public bucket → permanent URL.
// Returns '' on ANY failure so the caller falls back to the raw (expiring) url.
async function rehostThumb(rawUrl: string): Promise<string> {
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
      headers: { 'user-agent': UA, accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return ''
    const ct = res.headers.get('content-type') || 'image/jpeg'
    if (!/^image\//i.test(ct)) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > THUMB_MAX) return ''
    const sb = getSupabaseAdmin()
    const { data: bucket } = await sb.storage.getBucket(BUCKET)
    if (!bucket) await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {})
    const ext = /png/i.test(ct) ? 'png' : /webp/i.test(ct) ? 'webp' : 'jpg'
    const path = `content/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: false })
    if (error) return ''
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return ''
  }
}

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let url: unknown
  try {
    url = (await req.json())?.url
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof url !== 'string' || !url.trim()) {
    return Response.json({ error: 'A post url is required.' }, { status: 400 })
  }
  const postUrl = url.trim()
  const platform = detectPostPlatform(postUrl)
  if (!platform) {
    return Response.json({ error: 'Paste a tiktok.com or instagram.com post URL.' }, { status: 400 })
  }

  if (platform === 'instagram') {
    return Response.json({
      platform: 'instagram',
      thumbUrl: '',
      caption: '',
      note: 'Instagram posts are login-walled — paste a cover image + caption, and type the views/likes.',
    })
  }

  // TikTok — keyless oEmbed.
  try {
    const o = new URL(tiktokOembedUrl(postUrl))
    if (!(await resolvesPublic(o.hostname))) {
      return Response.json({ error: 'Could not resolve TikTok.' }, { status: 502 })
    }
    const res = await fetch(o.toString(), {
      headers: { 'user-agent': UA, accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) {
      return Response.json({
        platform: 'tiktok',
        thumbUrl: '',
        caption: '',
        note: `TikTok oEmbed returned ${res.status} — the post may be private/removed. Enter details manually.`,
      })
    }
    const j = JSON.parse((await res.text()).slice(0, 200_000)) as {
      thumbnail_url?: unknown
      title?: unknown
      author_name?: unknown
    }
    const rawThumb = typeof j.thumbnail_url === 'string' ? j.thumbnail_url : ''
    const caption = typeof j.title === 'string' ? j.title.slice(0, 300) : ''
    const thumbUrl = rawThumb ? (await rehostThumb(rawThumb)) || rawThumb : ''
    return Response.json({
      platform: 'tiktok',
      thumbUrl,
      caption,
      author: typeof j.author_name === 'string' ? j.author_name : '',
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return Response.json({
      platform: 'tiktok',
      thumbUrl: '',
      caption: '',
      note: timedOut ? 'TikTok took too long to respond.' : 'Couldn’t reach TikTok oEmbed. Enter details manually.',
    })
  }
}
