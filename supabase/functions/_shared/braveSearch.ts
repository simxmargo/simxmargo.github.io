// Contact-email lookup via the Brave Search API.
//
// WHY A SEARCH INDEX INSTEAD OF FETCHING THE PAGE
// Two thirds of scrape_jobs came back `needs_browser`: the brand's own site answered our
// fetch with 403/429 or timed out. Brave already crawled those same pages, so reading its
// index gets us the contact address without ever touching the origin that blocks us.
//
// BRAVE IS AN ENRICHMENT STEP, NOT A FALLBACK (changed 2026-08-09)
// It used to run only when the site scrape returned nothing, which meant a brand whose
// homepage published `support@` was written off with `support@` — even though Brave had
// `press@` indexed from a press-release page the crawler never reached. The index sees
// pages our six-path crawl does not: press releases, stockist directories, partner
// listings, the brand's own /collaborations page linked from nowhere obvious.
//
// So `scrape-static` now runs BOTH and hands the union to the ranker. Which is also why
// this module no longer sorts: returning one "best" address meant Brave's idea of best
// competed with the ranker's. It returns everything that passes ownership, and
// lib/outreach/pickEmail.ts decides.
//
// Docs: https://api-dashboard.search.brave.com/app/documentation/web-search
// NOTE: the free plan is rate-limited to ~1 request/second — callers must pace themselves.

import {
  apexHost,
  brandFromTitle,
  emailBelongsToBrand,
  hostOf,
  isNotABrandName,
  isPlausibleBrandHost,
} from './hosts.ts'

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

/** Addresses that are never a human contact — platform noise found on any page. */
const JUNK_LOCAL = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'postmaster', 'abuse',
  'webmaster@example', 'sentry', 'wixpress', 'example', 'yourdomain', 'domain',
  'test', 'user', 'name', 'email', 'someone', 'privacy@domainsbyproxy',
]
const JUNK_DOMAIN = [
  'example.com', 'example.org', 'domain.com', 'yourdomain.com', 'email.com',
  'sentry.io', 'wixpress.com', 'godaddy.com', 'domainsbyproxy.com', 'squarespace.com',
  'shopify.com', 'myshopify.com', 'wordpress.com', 'schema.org', 'w3.org',
  'sentry-next.wixpress.com', '2x.png', 'jpg', 'png', 'webp',
]

// The ROLE_RANK list that lived here is gone. Ordering role mailboxes was a THIRD copy
// of "which address is best", alongside the scraper's classifyEmail and the admin UI's
// TYPE_RANK — and it had already drifted, ranking `press` above `collabs`. All three now
// defer to lib/outreach/pickEmail.ts.

const EMAIL_RE = /[\w.\-+]+@[\w\-]+\.[\w.\-]{2,}/g

interface BraveResult {
  url?: string
  title?: string
  description?: string
  extra_snippets?: string[]
}

export interface EmailHit {
  email: string
  /** Page the address was found on, stored as the contact's source_url. */
  sourceUrl: string
}

function isJunk(email: string): boolean {
  const [local, domain] = email.split('@')
  if (!local || !domain) return true
  if (JUNK_LOCAL.some((j) => local.includes(j))) return true
  if (JUNK_DOMAIN.some((j) => domain === j || domain.endsWith(`.${j}`) || domain.includes(j))) return true
  // Image filenames and versioned assets regularly regex as addresses.
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(domain)) return true
  if (local.length > 40 || domain.length > 50) return true
  return false
}

/** Ownership test lives in hosts.ts — the static scraper applies the same rule. */
export const belongsToBrand = emailBelongsToBrand

/** Every address in one result's text, paired with the page it came from. */
function harvest(r: BraveResult): EmailHit[] {
  const text = [r.title ?? '', r.description ?? '', ...(r.extra_snippets ?? [])].join(' ')
  const found = text.match(EMAIL_RE) ?? []
  return found.map((e) => ({
    email: e.toLowerCase().replace(/[.,;:]+$/, ''),
    sourceUrl: r.url ?? '',
  }))
}

/** One Brave query. Returns [] on any failure so the caller can try the next phrasing. */
async function search(apiKey: string, query: string, offset = 0): Promise<BraveResult[]> {
  try {
    const res = await fetch(
      `${ENDPOINT}?q=${encodeURIComponent(query)}&count=20&offset=${offset}&result_filter=web&safesearch=off`,
      {
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip',
          'x-subscription-token': apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) return []
    const payload = await res.json()
    return (payload?.web?.results ?? []) as BraveResult[]
  } catch {
    return []
  }
}

/**
 * EVERY contact address the index knows for one brand, unranked.
 *
 * Runs up to three phrasings and STOPS at the first that yields usable addresses — the
 * early break is the quota control. Brave's free plan is ~2,000 queries a month and a
 * 100-brand discovery run enriches most of them, so spending three queries per brand
 * where one answered would put a single run near a fifth of the monthly budget.
 *
 * Returns the whole harvest from that phrasing rather than a single winner: the caller
 * merges these with whatever the site scrape found and ranks the union once. A page can
 * list `press@` and `collabs@` together, and picking one here would throw the other away
 * before the ranker ever saw it.
 *
 * `pause` is awaited between queries because the free plan allows ~1 req/sec.
 */
export async function findBrandEmails(
  apiKey: string,
  brand: string,
  website: string,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<EmailHit[]> {
  const site = website.replace(/^www\./, '')
  const queries = [
    `"${site}" contact email`,
    `${brand} ${site} press OR wholesale OR collaborations contact email`,
    `"@${site}" email`,
  ]

  const seen = new Set<string>()
  const candidates: EmailHit[] = []

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await pause(1100)
    const results = await search(apiKey, queries[i])

    for (const r of results) {
      // Prefer the brand's own pages, but accept any page that yields an address we
      // can prove belongs to the brand.
      const onOwnSite = hostOf(r.url ?? '').endsWith(site)
      for (const hit of harvest(r)) {
        if (seen.has(hit.email)) continue
        seen.add(hit.email)
        if (isJunk(hit.email)) continue
        if (!belongsToBrand(hit.email, site, brand)) continue
        candidates.push({ ...hit, sourceUrl: hit.sourceUrl || (onOwnSite ? r.url ?? '' : '') })
      }
    }

    if (candidates.length) break
  }

  return candidates
}

// ── Brand discovery (the fallback when ScrapeCreators credits run out) ───────────

/** Same shape `instagramSearch` produces, so discover-brands can use either source. */
export interface BraveBrandCandidate {
  brand: string
  website: string
  country: string
  handle: string
  followers: number
  email: string
  /** Always false here — a web result carries no bio to read intent from. */
  wantsCreators: boolean
}

// A cross product, not a list — 18 niches x 6 framings = 108 distinct searches, each
// pageable 4 deep. That is ~430 result pages before a single query would repeat.
const NICHES = [
  'activewear', 'swimwear', 'lingerie', 'jewellery', 'skincare', 'haircare',
  'makeup', 'sunglasses', 'handbags', 'sneakers', 'denim', 'loungewear',
  'outerwear', 'athleisure', 'fragrance', 'streetwear', 'knitwear', 'accessories',
]
const FRAMINGS = [
  'independent brand official site',
  'sustainable brand official store',
  'new direct to consumer brand',
  'small brand official website',
  'emerging brand shop online',
  'boutique brand official site',
]

export function braveQueryPool(): string[] {
  const out: string[] = []
  for (const n of NICHES) for (const f of FRAMINGS) out.push(`${n} ${f}`)
  return out
}

/** One discovery search. Returns [] on any failure — the caller decides whether to try more. */
export async function braveDiscover(
  apiKey: string,
  query: string,
  offset: number,
): Promise<BraveBrandCandidate[]> {
  const results = await search(apiKey, query, offset)
  const out: BraveBrandCandidate[] = []
  for (const r of results) {
    const host = hostOf(r.url ?? '')
    if (!host || !isPlausibleBrandHost(host)) continue
    // Collapse regional subdomains BEFORE storing, so the domain we scrape and
    // de-duplicate on is the company's, not one of its country storefronts.
    const website = apexHost(host)
    const brand = brandFromTitle(r.title ?? '', host)
    // A web search for "sustainable brand official store" surfaces award pages and
    // trade-body directories that sit on perfectly ordinary domains.
    if (isNotABrandName(brand) || isNotABrandName(r.title ?? '')) continue
    out.push({
      brand,
      website,
      country: '',
      handle: '',
      followers: 0,
      email: '',
      wantsCreators: false,
    })
  }
  return out
}
