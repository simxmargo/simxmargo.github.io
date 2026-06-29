// Pure, dependency-free HTML <meta>/<title>/favicon/logo extractors for the admin
// "Add brand from URL" feature — the DENO TWIN of lib/scrape/meta.ts (kept byte-for-
// byte behaviour-identical so the two never drift). Used by the `brand-meta` Edge
// Function; no network or DB here — the function body owns all I/O so these stay
// pure and trivially testable. (lib/scrape/meta.ts is the Node copy that tsc checks;
// the supabase/ dir is excluded from the app tsconfig, so this Deno copy exists.)

// Identify ourselves honestly when fetching a brand's homepage.
export const SCRAPE_USER_AGENT = 'simxmargo-mediakit/1.0 (+https://simxmargo.com)'

// Platform "site names" that are NOT the brand — Apple/Google store pages set
// og:site_name to these, so when we see one we fall back to the page <title>
// to recover the real app/brand name (e.g. "Kapi Cam", not "App Store").
export const GENERIC_SITE_NAMES = new Set([
  'app store', 'mac app store', 'itunes', 'google play', 'google play store',
  'youtube', 'facebook', 'instagram', 'tiktok', 'x', 'twitter', 'linkedin',
  'pinterest', 'amazon.com', 'amazon', 'etsy', 'spotify',
])

// App-store / platform hosts whose DOMAIN must not be sent to logo.dev — it would
// return Apple/Google's logo, not the app's. For these we use og:image instead.
export const PLATFORM_DOMAINS = new Set([
  'apps.apple.com', 'itunes.apple.com', 'play.google.com', 'chromewebstore.google.com',
])

// Clean square brand logo via logo.dev (resolves a logo BY DOMAIN — the same
// service the source media kit used). Requires a publishable token (env
// LOGO_DEV_TOKEN). Returns '' with no token/domain so the caller can fall back to
// og:image/favicon — i.e. the feature degrades, it never hard-depends on logo.dev.
export function logoDevUrl(domain: string, token: string): string {
  if (!domain || !token) return ''
  return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(token)}&format=png&size=256`
}

// Coerce loose user input ("brand.com", "https://Brand.com/x") into a URL.
// Returns null when unparseable / non-http(s) so the caller can 400 cleanly.
export function toUrl(input: string): URL | null {
  if (!input) return null
  let s = input.trim()
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

// "https://www.Brand.com/x" -> "brand.com". '' when unparseable.
export function normalizeDomain(input: string): string {
  const u = toUrl(input)
  return u ? u.hostname.replace(/^www\./i, '') : ''
}

// SSRF defense-in-depth: block hostnames/IPs that point at the deploy's own
// network — loopback, link-local (incl. the cloud metadata endpoint
// 169.254.169.254), RFC1918 private ranges, CGNAT, multicast, IPv6 ULA/link-local,
// and internal TLDs. Accepts BOTH a hostname (string before DNS) and a resolved
// IP literal (the function calls it on both). Hostname-level checks can't stop DNS
// rebinding on their own — the function also resolves the host and re-runs this on
// each returned IP; full protection still needs egress firewalling.
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true

  // IPv4 literal
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1]),
      b = Number(v4[2])
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true
    if (a === 0 || a === 127 || a === 10) return true // this-host, loopback, private
    if (a === 169 && b === 254) return true // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    if (a >= 224) return true // multicast / reserved
    return false
  }

  // IPv6 literal
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true // loopback / unspecified
    if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true // link-local + ULA
    if (h.startsWith('::ffff:')) return true // IPv4-mapped — block to be safe
    return false
  }

  return false // a normal domain name; the caller still DNS-checks its IPs
}

// Resolve a possibly-relative URL (favicon / og:image) against the page origin.
export function resolveUrl(maybe: string, base: URL): string {
  if (!maybe) return ''
  try {
    return new URL(maybe, base).toString()
  } catch {
    return ''
  }
}

// Guard invalid/over-range code points so String.fromCodePoint can't throw.
function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return ''
  try {
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

// Decode the HTML entities that show up in title/description text: numeric/hex
// (curly quotes, em/en dashes — &#8217; &#8212;) first, then the common named
// ones, with &amp; LAST so a literal "&amp;lt;" doesn't double-decode.
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

// Pull the `content` of a <meta> whose property/name equals `key`
// (case-insensitive), tolerating attribute order in BOTH directions and
// single/double quotes. Regex (not a DOM parser) is fine for head meta tags.
function metaContent(html: string, key: string): string {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reA = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${k}["'][^>]*?\\bcontent\\s*=\\s*["']([^"']*)["']`,
    'i',
  )
  const reB = new RegExp(
    `<meta[^>]+\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${k}["']`,
    'i',
  )
  const m = html.match(reA) ?? html.match(reB)
  return m ? decodeEntities(m[1]) : ''
}

// og:image (preferred) → twitter:image, resolved absolute. '' if none.
export function extractOgImage(html: string, base: URL): string {
  const v =
    metaContent(html, 'og:image:secure_url') ||
    metaContent(html, 'og:image') ||
    metaContent(html, 'twitter:image') ||
    metaContent(html, 'twitter:image:src')
  return v ? resolveUrl(v, base) : ''
}

export function extractMetaDescription(html: string): string {
  return (
    metaContent(html, 'og:description') ||
    metaContent(html, 'description') ||
    metaContent(html, 'twitter:description')
  )
}

export function extractTitle(html: string): string {
  const og = metaContent(html, 'og:title')
  if (og) return og
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeEntities(m[1]) : ''
}

export function extractSiteName(html: string): string {
  return metaContent(html, 'og:site_name')
}

// <link rel="icon|shortcut icon|apple-touch-icon" href="..."> resolved absolute,
// tolerating attribute order; falls back to /favicon.ico at the origin.
export function extractFavicon(html: string, base: URL): string {
  const cands: { rel: string; href: string }[] = []
  for (const m of html.matchAll(
    /<link[^>]+\brel\s*=\s*["']([^"']*)["'][^>]*?\bhref\s*=\s*["']([^"']+)["']/gi,
  ))
    cands.push({ rel: m[1].toLowerCase(), href: m[2] })
  for (const m of html.matchAll(
    /<link[^>]+\bhref\s*=\s*["']([^"']+)["'][^>]*?\brel\s*=\s*["']([^"']*)["']/gi,
  ))
    cands.push({ rel: m[2].toLowerCase(), href: m[1] })

  const icon =
    cands.find((c) => c.rel.includes('apple-touch-icon')) ||
    cands.find((c) => c.rel.split(/\s+/).includes('icon')) ||
    cands.find((c) => c.rel.includes('shortcut'))
  return icon ? resolveUrl(icon.href, base) : resolveUrl('/favicon.ico', base)
}

// A clean SQUARE brand logo from the page — preferring apple-touch-icon (usually a
// 180×180 logo) and the largest declared <link rel="icon"> size. Deliberately does
// NOT include og:image (that's a social/hero BANNER, not a logo) or the tiny
// /favicon.ico fallback. '' when the page declares no real icon.
export function extractAppleTouchIcon(html: string, base: URL): string {
  const cands: { href: string; size: number }[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1]?.toLowerCase() ?? ''
    if (!/apple-touch-icon|(^|\s)icon(\s|$)/.test(rel)) continue
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    // apple-touch-icon outranks a plain icon; within each, larger declared size wins.
    const base0 = rel.includes('apple-touch-icon') ? 1_000_000 : 0
    const sz = Number(tag.match(/\bsizes\s*=\s*["'](\d+)x\d+["']/i)?.[1] ?? 0)
    cands.push({ href, size: base0 + sz })
  }
  if (!cands.length) return ''
  cands.sort((a, b) => b.size - a.size)
  return resolveUrl(cands[0].href, base)
}

// schema.org logo from any ld+json block (Organization/WebSite .logo). Best-effort
// — a logo declared in structured data is almost always the real brand mark.
export function extractJsonLdLogo(html: string, base: URL): string {
  for (const m of html.matchAll(
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown
    try {
      data = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const found = findJsonLdLogo(data)
    if (found) return resolveUrl(found, base)
  }
  return ''
}

function findJsonLdLogo(node: unknown, depth = 0): string {
  if (depth > 6 || !node || typeof node !== 'object') return ''
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findJsonLdLogo(x, depth + 1)
      if (r) return r
    }
    return ''
  }
  const o = node as Record<string, unknown>
  const logo = o.logo
  if (typeof logo === 'string') return logo
  if (logo && typeof logo === 'object' && !Array.isArray(logo)) {
    const u = (logo as Record<string, unknown>).url
    if (typeof u === 'string') return u
  }
  if (o['@graph']) return findJsonLdLogo(o['@graph'], depth + 1)
  return ''
}

// Best-effort brand name from the title: drop a trailing " | Tagline" segment and
// skip a literal "Home". The ASCII hyphen only separates when SPACE-delimited
// (" - "), so hyphenated brands ("Coca-Cola", "Mercedes-Benz") survive intact.
// Falls back to the domain's second-level label, Title-cased.
export function deriveBrandName(title: string, domain: string): string {
  if (title) {
    const parts = title
      .split(/\s+-\s+|\s*[|–—:·•]\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
    const firstReal = parts.find((p) => !/^home$/i.test(p))
    if (firstReal) return firstReal
  }
  const label = domain.split('.')[0] ?? ''
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : ''
}
