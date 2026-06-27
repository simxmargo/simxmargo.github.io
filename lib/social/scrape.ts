// Best-effort follower-count scraping from PUBLIC social profile pages — no API
// keys. SERVER-ONLY. This is a convenience pre-fill, NOT a reliable sync: from a
// datacenter IP, Instagram/Facebook often serve a login wall (no count), TikTok
// rate-limits, and markup changes break parsing. The influencer always confirms +
// saves the number by hand (the manual value is the source of truth).

export interface ScrapeResult {
  platform: string
  followers: number | null
  found: boolean
  note?: string
}

// "1.3M" / "394K" / "1,234,567" → 1300000 / 394000 / 1234567.
export function parseCompactNumber(input: string): number | null {
  const s = input.trim().replace(/,/g, '')
  const m = s.match(/^([\d.]+)\s*([kmb])?/i)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const suffix = m[2]?.toLowerCase()
  const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1
  return Math.round(n * mult)
}

// ReDoS-safe follower matcher. The digit run is BOUNDED ({0,14}) so a large
// digits/whitespace blob with no "Followers" terminator can't trigger super-linear
// backtracking — the scrape route runs on the single-threaded node runtime over a
// remote page body up to ~1.5MB, so a slow regex would block the WHOLE process. A
// real follower count is ≤ ~13 chars ("1,234,567,890"). Replaces the old
// /([\d.,]+\s*[KMB]?)\s+Followers/i, which backtracked catastrophically.
const FOLLOWERS_RE = /(\d[\d.,]{0,14}[KMB]?)\s{0,3}Followers/i

function ogDescription(html: string): string {
  return (
    html.match(/<meta[^>]+(?:property|name)\s*=\s*["']og:description["'][^>]*?\bcontent\s*=\s*["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+\bcontent\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["']og:description["']/i)?.[1] ||
    ''
  )
}

// Extract the follower count from a profile page's HTML (or a JSON API response),
// platform-aware. Order: exact embedded JSON → og:description → any "<n> Followers".
export function extractFollowerCount(platform: string, html: string): number | null {
  // 1) Platform JSON embedded in the page / returned by a JSON API — the EXACT count.
  // TikTok embeds it in its rehydration JSON; this is the most reliable source.
  if (platform === 'tiktok') {
    const m = html.match(/"followerCount":\s*(\d+)/)
    if (m) return Number(m[1])
  }
  // Instagram's web-profile JSON API (and, rarely, the page) carries the exact count.
  if (platform === 'instagram') {
    const m = html.match(/"edge_followed_by":\s*\{\s*"count":\s*(\d+)/)
    if (m) return Number(m[1])
  }
  // Facebook sometimes embeds it as follower_count in inline JSON.
  if (platform === 'facebook') {
    const m = html.match(/"follower_count":\s*(\d+)/)
    if (m) return Number(m[1])
  }
  // 2) og:description carries "1,234,567 Followers, 567 Following, …". Instagram
  // serves this to link-preview CRAWLERS (see CRAWLER_UA) — rounded ("1M") but
  // reliable; often TikTok/Facebook too.
  const desc = ogDescription(html)
  if (desc) {
    const m = desc.match(FOLLOWERS_RE)
    if (m) return parseCompactNumber(m[1])
  }
  // 3) Last resort: any "<n> Followers" anywhere in the HTML. Scan a bounded slice
  // (the count, when present, sits near the top) so a huge body can't blow up the scan.
  const any = html.slice(0, 300_000).match(FOLLOWERS_RE)
  return any ? parseCompactNumber(any[1]) : null
}

// Hostnames we will fetch (the three supported platforms only — keeps this off the
// SSRF surface: it can never be pointed at an arbitrary/internal host).
const ALLOWED_HOSTS = ['tiktok.com', 'instagram.com', 'facebook.com', 'fb.com']

export function isAllowedProfileHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\.|^m\./, '')
  return ALLOWED_HOSTS.some((d) => h === d || h.endsWith('.' + d))
}

// --- Fetch identity --------------------------------------------------------
// WHICH user-agent to present matters more than anything else here. Verified
// empirically against simxmargo from a datacenter IP:
//   • TikTok    → serves its rehydration JSON to a normal browser UA.        ✅
//   • Instagram → login-walls/429s a browser UA AND its JSON API, but serves
//     clean og: tags (incl. the follower count) to LINK-PREVIEW CRAWLERS so
//     share cards render → fetch IG as facebookexternalhit.                  ✅
//   • Facebook  → 400s browsers; preview crawlers get a contentless "join
//     Facebook" page with NO count → keyless is impossible, needs the Graph
//     API token (see facebookGraphUrl).                                      ❌ keyless

// A normal desktop-browser UA. TikTok serves its rehydration JSON to this.
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// A link-preview crawler UA. Instagram deliberately serves og: tags (incl. the
// follower count) to these so shared profile links render a card — even while it
// login-walls normal browsers. This is the keyless Instagram fix.
export const CRAWLER_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

// Per-platform fetch UA for the public profile PAGE.
export function userAgentFor(platform: string): string {
  return platform === 'instagram' ? CRAWLER_UA : BROWSER_UA
}

// Instagram's keyless public web-profile API — returns JSON with the EXACT count
// (edge_followed_by.count) when not throttled. The app-id is Instagram's own public
// web client id, sent as x-ig-app-id. PRECISION-ONLY/best-effort: datacenter IPs
// are frequently 429'd, so callers fall back to the crawler-UA og:description
// (rounded but reliable). Host stays on instagram.com → on the SSRF allowlist.
export const IG_WEB_APP_ID = '936619743392459'
export function instagramWebProfileUrl(handle: string): string {
  const u = handle.replace(/^@/, '').trim()
  return `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(u)}`
}

// --- Per-post content (brand "Top content" cards) ---------------------------------
// Detect the platform of a POST/reel link (not a profile). null = unsupported host.
export function detectPostPlatform(input: string): 'tiktok' | 'instagram' | null {
  try {
    const h = new URL(input).hostname.toLowerCase().replace(/^www\.|^m\.|^vm\./, '')
    if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok'
    if (h === 'instagram.com' || h.endsWith('.instagram.com')) return 'instagram'
    return null
  } catch {
    return null
  }
}

// TikTok's KEYLESS oEmbed endpoint — returns title (caption), author, and a
// thumbnail_url for a public video. Verified working without any token.
export function tiktokOembedUrl(postUrl: string): string {
  return `https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`
}

// Hosts we'll download a re-hosted thumbnail from (TikTok's signed CDN). The SSRF
// guard (private-IP check) still runs on the resolved address in the route.
export function isAllowedThumbHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return /\.tiktokcdn(-us|-eu)?\.com$/.test(h) || /\.cdninstagram\.com$/.test(h) || /\.fbcdn\.net$/.test(h)
}

// Pull the vanity username / page id from a profile URL's first path segment
// (handles facebook.com/profile.php?id=123 too). Falls back to the stored handle.
export function handleFromProfileUrl(profileUrl: string, fallbackHandle: string): string {
  try {
    const u = new URL(profileUrl)
    const seg = u.pathname.split('/').filter(Boolean)[0] ?? ''
    if (seg === 'profile.php') return u.searchParams.get('id') ?? fallbackHandle.replace(/^@/, '').trim()
    if (seg) return decodeURIComponent(seg)
  } catch {
    // fall through to the stored handle
  }
  return fallbackHandle.replace(/^@/, '').trim()
}
