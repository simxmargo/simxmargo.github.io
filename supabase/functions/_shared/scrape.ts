// Shared scraping helpers — pure and dependency-free, so they're trivially
// testable and reused by both `scrape-static` (HTML pages) and `enrich`
// (Hunter.io). NO network or DB here — keep all I/O in the function bodies.
//
// Design rationale: docs/BACKEND_DESIGN.md §3 (scraper) and §4 (enrichment).

// Identify ourselves honestly. Etiquette + good-faith insurance (see §3 "Etiquette").
export const USER_AGENT = 'brand-outreach-studio/1.0 (+contact)'

// Pages most likely to expose a public press@/partnerships@ inbox, cheapest first.
// `/pages/contact` is the Shopify convention; many fashion brands run Shopify.
export const CONTACT_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/pages/contact',
  '/press',
  '/about',
] as const

// Mirrors the `contacts.email_type` check constraint in 0001_init.sql.
export type EmailType = 'partnerships' | 'press' | 'generic' | 'named'

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// --- domain ----------------------------------------------------------------

// "https://www.Brand.com/contact?x=1" -> "brand.com". Returns '' if unparseable
// so callers can skip the job rather than crash.
export function normalizeDomain(website: string): string {
  if (!website) return ''
  let s = website.trim().toLowerCase()
  if (!/^https?:\/\//.test(s)) s = 'https://' + s
  try {
    return new URL(s).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function pageUrl(domain: string, path: string): string {
  return `https://${domain}${path}`
}

// --- robots.txt ------------------------------------------------------------

// Parse Disallow rules that apply to us: the `*` group plus any group naming our
// UA. Deliberately simple — prefix matching only, ignores Allow/wildcards/`$`.
// This is a good-faith courtesy, not a spec-complete crawler. Within one group,
// stacked `User-agent:` lines are OR-ed; a Disallow line ends the group header.
export function parseDisallowed(robotsTxt: string, userAgent = USER_AGENT): string[] {
  const disallowed: string[] = []
  const uaLower = userAgent.toLowerCase()
  let applies = false
  let prevWasRule = false

  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (key === 'user-agent') {
      if (prevWasRule) applies = false // a rule line closed the previous group
      const ua = value.toLowerCase()
      if (ua === '*' || (ua && uaLower.includes(ua))) applies = true
      prevWasRule = false
    } else if (key === 'disallow' || key === 'allow') {
      prevWasRule = true
      if (key === 'disallow' && applies && value) disallowed.push(value)
    }
  }
  return disallowed
}

export function isPathAllowed(path: string, disallowed: string[]): boolean {
  return !disallowed.some((d) => d !== '' && path.startsWith(d))
}

// --- emails ----------------------------------------------------------------

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi

// Strings that match the email shape but never are one: asset hosts, error
// trackers (Sentry/Wix), and the placeholder addresses that litter templates.
const JUNK_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'domain.com', 'email.com',
  'yourdomain.com', 'yoursite.com', 'sentry.io', 'wixpress.com',
  'sentry.wixpress.com', 'sentry-next.wixpress.com', 'wix.com',
  'squarespace.com', 'godaddy.com', 'schema.org', 'w3.org',
])
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|eot|mp4|webm|pdf)$/i

// Anchored, and stricter than EMAIL_RE: local and domain parts may not START or END
// with a separator, and nothing outside the allowed sets may appear anywhere. This is
// the last gate before an address is stored — EMAIL_RE only has to FIND a candidate in
// a wall of markup, whereas this decides whether we're willing to email it.
const STRICT_EMAIL =
  /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

// Filter out the usual scraping false-positives. Conservative: when unsure, drop it.
export function isLikelyContactEmail(email: string): boolean {
  const e = email.toLowerCase()
  // Anything carrying escape debris ("customercare@gorjana.com\") fails here rather
  // than being stored and hard-bouncing later. A bounce costs sender reputation; a
  // dropped lead costs nothing but the lead.
  if (!STRICT_EMAIL.test(e)) return false
  if (e.includes('@2x') || e.includes('@3x')) return false // retina asset refs (image@2x.png)
  if (ASSET_EXT.test(e)) return false
  if (e.length > 100) return false
  const at = e.lastIndexOf('@')
  if (at < 1) return false
  if (JUNK_DOMAINS.has(e.slice(at + 1))) return false
  if (/^[0-9a-f]{16,}$/.test(e.slice(0, at))) return false // Sentry/Raygun hash keys
  return true
}

// decodeURIComponent throws on a malformed `%` sequence — never let one bad
// mailto crash a scrape. Also trims trailing punctuation that hrefs sometimes carry.
function cleanMailto(raw: string): string {
  let s = raw
  try {
    s = decodeURIComponent(raw)
  } catch {
    /* leave it encoded; the filter below still applies */
  }
  // Trailing debris an href picks up in escaped markup: backslashes from JSON string
  // escaping, stray quotes/brackets, ordinary punctuation.
  return s.toLowerCase().replace(/[\\"'>)\]}.,;:]+$/, '')
}

// Modern storefronts inline their state as JSON inside <script> tags, where `>` is
// written `>` and `/` is `\/`. Scanning the RAW text therefore captured those
// escapes as part of the address — `>hello@brand.com` yields
// "u003ehello@brand.com", which is a *syntactically valid* email, so every downstream
// filter passed it and the send hard-bounced. Decoding first makes the escape a real
// `>`, which the extraction patterns already treat as a boundary.
function decodeSource(html: string): string {
  return html
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/gi, '&')
}

// Pull emails from `mailto:` links first (highest-signal), then a regex pass over the
// page. Returns a deduped, lowercased, filtered list.
export function extractEmails(html: string): string[] {
  const source = decodeSource(html)
  const found = new Set<string>()
  // `\\` added to the exclusion set: a JSON-escaped href would otherwise pull the
  // backslash into the address.
  for (const m of source.matchAll(/mailto:([^"'?>\s\\]+)/gi)) {
    const e = cleanMailto(m[1])
    if (isLikelyContactEmail(e)) found.add(e)
  }
  for (const m of source.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase()
    if (isLikelyContactEmail(e)) found.add(e)
  }
  return [...found]
}

const PRESS_RE = /^(press|pr|media|publicity|news)/
const PARTNER_RE = /(partner|collab|influenc|creator|ambassador|wholesale|affiliat|marketing|brand)/
const GENERIC_RE =
  /^(info|hello|hi|hey|contact|support|team|sales|admin|enquir|inquir|help|customer|care|office|general|shop|service|order)/

// Map an address to an outreach category from its local part. Order matters:
// a press/partnership role beats the generic bucket; a `first.last@` pattern is
// the only thing we'll confidently call a named individual.
export function classifyEmail(email: string): EmailType {
  const local = email.slice(0, email.indexOf('@')).toLowerCase()
  if (PRESS_RE.test(local)) return 'press'
  if (PARTNER_RE.test(local)) return 'partnerships'
  if (GENERIC_RE.test(local)) return 'generic'
  if (/^[a-z]+[._][a-z]+/.test(local)) return 'named' // first.last / first_last
  return 'generic'
}
