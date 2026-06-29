// Shared cover re-host: download a remote (signed/expiring) TikTok/IG CDN image and
// re-upload it to the public `media` bucket → a PERMANENT public URL. TikTok + IG covers
// carry a ~6h TTL, so any cover we want to keep MUST be re-hosted.
//
// SSRF-guarded (defense-in-depth): only the platforms' OWN CDN hosts (isAllowedThumbHost),
// only public-resolving addresses (resolvesPublic), raster content-types only (no SVG),
// a 5MB cap, and HTTPS-only. Returns '' on ANY failure so callers fall back to the raw
// (expiring) cover rather than breaking.
//
// NOTE: `pull-videos` still carries an inline copy of this logic; it predates this shared
// module and is left untouched (it's deployed + working). Unify it here if you touch it.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const REHOST_UA = 'simxmargo-mediakit/1.0 (+https://simxmargo.com)'
const THUMB_MAX = 5 * 1024 * 1024
const BUCKET = 'media'
const REHOST_TIMEOUT = 9000

// Hosts we'll download a cover from: the platforms' OWN signed CDNs only. Keeps this off
// the SSRF surface — it can never be pointed at an arbitrary/internal host.
export function isAllowedThumbHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return /\.tiktokcdn(-us|-eu)?\.com$/.test(h) || /\.cdninstagram\.com$/.test(h) || /\.fbcdn\.net$/.test(h)
}

// Block hostnames/IP literals that point at the deploy's own network (loopback, link-local
// incl. 169.254.169.254 metadata, RFC1918, CGNAT, etc.).
export function isBlockedHost(host: string): boolean {
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
    return true
  }
}

// Download a remote (expiring) cover and re-upload to the public `media` bucket → a
// permanent URL. Returns '' on ANY failure so the caller falls back to the raw cover.
export async function rehostImage(sb: SupabaseClient, rawUrl: string, folder = 'content'): Promise<string> {
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
