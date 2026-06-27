import { isAllowedThumbHost } from '@/lib/social/scrape'
import { resolvesPublic } from '@/lib/social/rehost'

// Preview-thumbnail proxy for the "Pull videos" review list. TikTok/Instagram CDN images
// 403 when an <img> hotlinks them cross-origin from the browser, so the modal points its
// preview <img src> here and we mirror the bytes from our own origin instead.
//
// INTENTIONALLY UNAUTHENTICATED: an <img src> GET can't carry the admin header. Safe
// because it's locked to the social-CDN allowlist (isAllowedThumbHost) + public-IP check
// (resolvesPublic) + a size cap + a raster-only content-type allowlist — so it can only
// ever mirror a public TikTok/IG cover image, never an arbitrary or internal host. This
// is preview-only; persisted covers are re-hosted separately (add-videos + rehost.ts).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UA = 'simxmargo-mediakit/1.0 (+https://simxmargo.com)'
const MAX = 5 * 1024 * 1024
const TIMEOUT = 9000

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('u') || ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return new Response('bad url', { status: 400 })
  }
  if (target.protocol !== 'https:' || !isAllowedThumbHost(target.hostname)) {
    return new Response('forbidden host', { status: 403 })
  }
  if (!(await resolvesPublic(target.hostname))) {
    return new Response('forbidden', { status: 403 })
  }

  let res: Response
  try {
    res = await fetch(target.toString(), {
      headers: { 'user-agent': UA, accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    })
  } catch {
    return new Response('fetch failed', { status: 502 })
  }
  if (!res.ok) return new Response('upstream error', { status: 502 })

  const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase()
  if (!/^image\/(jpe?g|png|webp|gif|avif)$/.test(ct)) return new Response('not an image', { status: 415 })
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0 || buf.byteLength > MAX) return new Response('bad size', { status: 413 })

  return new Response(buf, {
    status: 200,
    headers: { 'content-type': ct, 'cache-control': 'private, max-age=600' },
  })
}
