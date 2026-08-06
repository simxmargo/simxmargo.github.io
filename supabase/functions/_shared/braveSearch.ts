// Open-ended brand discovery via the Brave Search API.
//
// WHY A SEARCH API AT ALL
// Wikidata (the fallback) is a curated database: ~1,100 apparel companies, and when
// you've scraped them the well is dry. A search index is the whole live web, so the
// supply only ends when the queries do — which is why the query pool below is a cross
// product rather than a list.
//
// WHY BRAVE
// Google's Custom Search JSON API is closed to new customers and retires 2027-01-01;
// Bing's free tier is gone; scraping result pages violates the terms and gets blocked.
// Brave publishes a real API with a free monthly credit allowance, and one search
// returns ~10 candidate brands, so a run costs a handful of requests.
//
// Docs: https://api-dashboard.search.brave.com/app/documentation/web-search

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

export interface BrandCandidate {
  brand: string
  website: string
  country: string
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

export function queryPool(): string[] {
  const out: string[] = []
  for (const n of NICHES) for (const f of FRAMINGS) out.push(`${n} ${f}`)
  return out
}

// Hosts that are never a brand to pitch: platforms, marketplaces, publishers,
// review aggregators and the social networks the brands themselves live on.
const BLOCKED_HOST = [
  // social
  'instagram.com', 'tiktok.com', 'facebook.com', 'pinterest.com', 'youtube.com',
  'twitter.com', 'x.com', 'linkedin.com', 'reddit.com', 'tumblr.com', 'threads.net',
  // marketplaces / multi-brand retail
  'amazon.', 'ebay.', 'etsy.com', 'aliexpress.com', 'walmart.com', 'target.com',
  'shein.com', 'temu.com', 'asos.com', 'zalando.', 'farfetch.com', 'revolve.com',
  'net-a-porter.com', 'ssense.com', 'nordstrom.com', 'macys.com', 'zappos.com',
  'depop.com', 'vinted.', 'poshmark.com', 'alibaba.com',
  // publishers / listicles / wikis
  'wikipedia.org', 'wikidata.org', 'medium.com', 'substack.com', 'vogue.',
  'elle.', 'harpersbazaar.', 'cosmopolitan.', 'refinery29.', 'businessoffashion.com',
  'forbes.com', 'nytimes.com', 'theguardian.com', 'buzzfeed.com', 'wired.com',
  'glamour.', 'byrdie.com', 'allure.com', 'whowhatwear.', 'thecut.com',
  // tooling / reviews / directories
  'trustpilot.com', 'yelp.com', 'glassdoor.', 'crunchbase.com', 'linktr.ee',
  'shopify.com', 'myshopify.com', 'wixsite.com', 'squarespace.com', 'bigcartel.com',
  'google.', 'bing.com', 'duckduckgo.com', 'quora.com', 'pinterest.',
]
const BLOCKED_TLD = ['.gov', '.edu', '.mil', '.ac.uk', '.gov.uk']

function isPlausibleBrandHost(host: string): boolean {
  if (!host.includes('.') || host.split('.').length > 4) return false
  if (BLOCKED_HOST.some((b) => host === b.replace(/\.$/, '') || host.includes(b))) return false
  if (BLOCKED_TLD.some((t) => host.endsWith(t))) return false
  return true
}

// Regional and functional prefixes. `us.lounge.com` and `lounge.com` are the same
// company, and treating them as two would break de-duplication and scrape the same
// brand twice.
const SUBDOMAIN_NOISE = new Set([
  'us', 'uk', 'eu', 'ca', 'au', 'nz', 'de', 'fr', 'it', 'es', 'nl', 'se', 'jp', 'kr',
  'en', 'intl', 'global', 'international', 'shop', 'store', 'www2', 'm', 'mobile',
])

/** `us.honeybirdette.com` → `honeybirdette.com`. Leaves real subdomains alone. */
export function apexHost(host: string): string {
  const parts = host.split('.')
  return parts.length >= 3 && SUBDOMAIN_NOISE.has(parts[0]) ? parts.slice(1).join('.') : host
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// "Gymshark | Official Site — Workout Clothes" → "Gymshark".
// Search titles are marketing strings; everything after the first separator is a
// tagline, and the leftovers ("Official Site", "Home") are noise in a pitch.
export function brandFromTitle(title: string, host: string): string {
  const label = apexHost(host).replace(/^www\./, '').split('.')[0]
  const fromDomain = label.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  let s = (title || '').split(/[|｜–—•·>»]|\s[-–]\s/)[0].trim()
  s = s.replace(/\b(official (web)?site|official store|official online store|home ?page|home|shop online|online shop|official)\b/gi, '').trim()
  // Trademark marks and a trailing region code are how big brands title their pages
  // ("GUCCI® US", "kate spade new york®") and both would go out in the greeting.
  s = s.replace(/[®™©]/g, '').trim()
  s = s.replace(/\s+(US|USA|UK|GB|EU|CA|AU|NZ|DE|FR|IT|ES|NL|SE|JP|KR)$/i, '').trim()
  s = s.replace(/[,:;\-–—]+$/, '').trim()
  if (!s || s.length > 40 || s.split(/\s+/).length > 5) return fromDomain

  // THE TAGLINE GUARD. A real brand name echoes its own domain — "Thistle and Spire"
  // lives on thistleandspire.com. A tagline does not: blushlingerie.com titled its
  // page "Luxury Lingerie For Women", which is under the word limit and would have
  // gone out as "Hi Luxury Lingerie For Women team,". If neither string contains the
  // other, trust the domain, which at least can't be a sentence.
  const a = squash(s)
  const b = squash(label)
  if (a && b && !a.includes(b) && !b.includes(a)) return fromDomain

  return s
}

interface BraveResult {
  url?: string
  title?: string
  profile?: { name?: string }
}

/** One search. Returns [] on any failure — the caller decides whether to try more. */
export async function braveSearch(
  apiKey: string,
  query: string,
  offset: number,
): Promise<BrandCandidate[]> {
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&count=20&offset=${offset}&result_filter=web&safesearch=moderate`
  let payload: { web?: { results?: BraveResult[] } }
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip',
        'x-subscription-token': apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    payload = await res.json()
  } catch {
    return []
  }

  const out: BrandCandidate[] = []
  for (const r of payload.web?.results ?? []) {
    let host: string
    try {
      host = new URL(r.url ?? '').hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      continue
    }
    if (!isPlausibleBrandHost(host)) continue
    // Collapse regional subdomains BEFORE storing, so the domain we scrape and
    // de-duplicate on is the company's, not one of its country storefronts.
    const website = apexHost(host)
    out.push({ brand: brandFromTitle(r.title ?? r.profile?.name ?? '', host), website, country: '' })
  }
  return out
}
