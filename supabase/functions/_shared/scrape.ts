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

// Classification lives in the shared ranker so the `email_type` column and the address
// ranking can never disagree about what a mailbox IS. Re-exported here because three
// call sites already import it from this module.
export { classifyEmail, type EmailType } from '../../../lib/outreach/pickEmail.ts'
import { mailableReason } from '../../../lib/outreach/pickEmail.ts'

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
  // The send-gate's rules, applied here too. This filter is the EXTRACTION gate and is
  // deliberately looser overall, but the checks that catch scraping debris — an
  // unrecognised TLD (`…@hearst.comif`, from "…hearst.com if you…"), markup fused to
  // the local part (`nbspsupport@`, `u003ehello@`) — belong at both gates: there is no
  // value in storing a row that the sender will refuse anyway.
  if (mailableReason(e) !== '') return false
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

/** An address plus HOW it was published — `mailto:` is a deliberate act, a body match isn't. */
export interface ExtractedEmail {
  email: string
  via: 'mailto' | 'body'
}

// Pull emails from `mailto:` links first (highest-signal), then a regex pass over the
// page. Returns deduped, lowercased, filtered hits, each carrying its provenance.
//
// Provenance is kept because it is one of the few honest liveness signals available
// without a verification API: somebody wrote `<a href="mailto:…">` on purpose and a
// visitor clicking it would reach a human. The same address matched inside a minified
// script blob might be a leftover in a config object nobody has read since 2019. The
// ranker weights the two differently; collapsing them to a bare string threw that away.
export function extractEmailHits(html: string): ExtractedEmail[] {
  const source = decodeSource(html)
  const found = new Map<string, ExtractedEmail['via']>()
  // `\\` added to the exclusion set: a JSON-escaped href would otherwise pull the
  // backslash into the address.
  for (const m of source.matchAll(/mailto:([^"'?>\s\\]+)/gi)) {
    const e = cleanMailto(m[1])
    if (isLikelyContactEmail(e)) found.set(e, 'mailto')
  }
  for (const m of source.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase()
    // Never downgrade: an address already seen in an href stays 'mailto'.
    if (isLikelyContactEmail(e) && !found.has(e)) found.set(e, 'body')
  }
  return [...found].map(([email, via]) => ({ email, via }))
}

/** Addresses only. Kept for callers that don't care where an address came from. */
export function extractEmails(html: string): string[] {
  return extractEmailHits(html).map((h) => h.email)
}

// classifyEmail moved to lib/outreach/pickEmail.ts (re-exported at the top of this
// file). The copy that lived here anchored press as `^(press|pr|…)` with no token
// boundary, so `privacy@`, `promo@` and `pricing@` all classified as PRESS — which not
// only mislabelled them, it PROMOTED them, since press outranks generic when choosing
// who to pitch. The shared version requires `pr` to be a whole token.
