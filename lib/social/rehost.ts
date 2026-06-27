// SERVER-ONLY. Download a remote (signed/expiring) image and re-upload it to our
// public Supabase bucket → a permanent URL. TikTok covers carry a ~6h TTL and IG CDN
// urls expire too, so any cover we want to keep MUST be re-hosted. SSRF-guarded: only
// known media CDNs (isAllowedThumbHost) AND only public-resolving addresses.
import { lookup } from 'node:dns/promises'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { isBlockedHost } from '@/lib/scrape/meta'
import { isAllowedThumbHost } from '@/lib/social/scrape'

const UA = 'simxmargo-mediakit/1.0 (+https://simxmargo.com)'
const THUMB_MAX = 5 * 1024 * 1024
const BUCKET = 'media'
const TIMEOUT = 9000

// True only if the host resolves AND every resolved address is public (SSRF guard).
export async function resolvesPublic(host: string): Promise<boolean> {
  if (isBlockedHost(host)) return false
  try {
    const addrs = await lookup(host, { all: true })
    return addrs.length > 0 && !addrs.some((a) => isBlockedHost(a.address))
  } catch {
    return false
  }
}

// Returns a permanent public URL, or '' on ANY failure so callers can fall back to the
// raw (expiring) url.
export async function rehostImage(rawUrl: string, folder = 'content'): Promise<string> {
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
    const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase()
    // Raster allowlist only — reject image/svg+xml (can carry script) and non-images,
    // since the file is served from a public bucket.
    if (!/^image\/(jpe?g|png|webp|gif|avif)$/.test(ct)) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > THUMB_MAX) return ''
    const sb = getSupabaseAdmin()
    const { data: bucket } = await sb.storage.getBucket(BUCKET)
    if (!bucket) await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {})
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : ct.includes('avif') ? 'avif' : 'jpg'
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: false })
    if (error) return ''
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return ''
  }
}
