// Brand discovery via the ScrapeCreators Instagram profile search.
//
// Instagram is a better discovery surface than a web search index: a brand's profile
// carries its own site, its size, and very often a contact address in the bio — so one
// credit returns ten candidates already half-enriched.
//
// The hard part is that the same search also returns CREATORS, who are worthless to
// pitch. classifyProfile below is what separates them.
//
// Docs: https://docs.scrapecreators.com  •  1 credit per search, 0 when cached.

import { apexHost, domainLabel, hostOf, isLinkAggregator, isPlausibleBrandHost, squash } from './hosts.ts'

const SC_BASE = 'https://api.scrapecreators.com'
const SC_TIMEOUT = 20_000

export interface BrandCandidate {
  brand: string
  website: string
  country: string
  /** Instagram handle, kept so a later step can look the brand up again. */
  handle: string
  followers: number
  /** Address lifted straight from the bio, when the brand published one. */
  email: string
}

// Queries are a cross product: 20 niches x 7 commerce framings = 140 distinct searches.
// The framings all say "shop"/"store"/"brand" on purpose — searching a bare topic
// ("korean skincare") returns dermatologists and beauty bloggers, while the same topic
// plus a retail word returns the shops.
const NICHES = [
  'activewear', 'swimwear', 'lingerie', 'jewelry', 'skincare', 'haircare',
  'makeup', 'sunglasses', 'handbags', 'sneakers', 'denim', 'loungewear',
  'outerwear', 'athleisure', 'fragrance', 'streetwear', 'knitwear', 'accessories',
  'womens clothing', 'korean skincare',
]
const FRAMINGS = [
  'brand online store',
  'boutique shop',
  'official brand shop',
  'small business shop',
  'independent brand store',
  'sustainable brand shop',
  'new brand online',
]

export function queryPool(): string[] {
  const out: string[] = []
  for (const n of NICHES) for (const f of FRAMINGS) out.push(`${n} ${f}`)
  return out
}

// Categories that mark a PERSON. These are the accounts a topic search drags in.
const CREATOR_CATEGORY = [
  'blogger', 'creator', 'public figure', 'personal blog', 'influencer', 'author',
  'writer', 'musician', 'artist', 'actor', 'model', 'photographer', 'podcast',
  'comedian', 'gamer', 'athlete', 'dancer', 'coach', 'entrepreneur', 'doctor',
  'physician', 'dermatologist', 'teacher', 'chef', 'journalist', 'youtuber',
  'video game', 'tv show', 'motivational',
]

// Categories that mark a SHOP.
const COMMERCE_CATEGORY = [
  'clothing', 'boutique', 'store', 'shop', 'retail', 'brand', 'jewelry', 'jewellery',
  'cosmetics', 'beauty', 'apparel', 'fashion', 'product/service', 'e-commerce',
  'commercial', 'merchandise', 'accessories', 'swimwear', 'lingerie', 'skin care',
]

const hasWord = (haystack: string, words: string[]) =>
  words.some((w) => haystack.includes(w))

export interface RawProfile {
  username?: string
  full_name?: string
  biography?: string
  bio_links?: Array<{ url?: string }>
  external_url?: string
  is_private?: boolean
  is_business_account?: boolean
  category_name?: string
  follower_count?: number
}

/**
 * Does this domain actually belong to this profile?
 *
 * THE GATE. Bios link to all sorts of things — a press feature, an affiliate storefront,
 * a friend's shop — and taking the first one produced real mistakes: @foursistersboutique
 * linked a magazine article and would have been pitched as "Omahamagazine", @tiffanyandco
 * linked an affiliate shim and became "Likeshop". A brand's own domain echoes its name.
 */
export function echoesBrand(host: string, username: string, fullName: string): boolean {
  const label = squash(domainLabel(host))
  if (!label) return false

  const handle = squash(username)
  if (handle && (handle.includes(label) || label.includes(handle))) return true

  // Fall back to word overlap so "Collections by Joya" still matches shop-joya.net.
  const words = (fullName || '')
    .split(/[^A-Za-z0-9]+/)
    .map(squash)
    .filter((w) => w.length >= 4)
  return words.some((w) => label.includes(w) || w.includes(label))
}

/** The profile's own site — first link that both looks like a brand host and echoes it. */
export function ownSite(p: RawProfile): string {
  const urls = [p.external_url ?? '', ...(p.bio_links ?? []).map((l) => l?.url ?? '')]
  for (const u of urls) {
    const host = hostOf(u)
    if (!host || isLinkAggregator(host) || !isPlausibleBrandHost(host)) continue
    if (!echoesBrand(host, p.username ?? '', p.full_name ?? '')) continue
    return apexHost(host)
  }
  return ''
}

const EMAIL_RE = /[\w.\-+]+@[\w\-]+\.[\w.\-]{2,}/

/** Contact address published in the bio, lowercased. '' when there is none. */
export function emailFromBio(bio: string): string {
  const m = (bio || '').replace(/\s+/g, ' ').match(EMAIL_RE)
  if (!m) return ''
  const email = m[0].toLowerCase().replace(/[.,;:]+$/, '')
  // Instagram bios are full of "@handle" mentions; those are not addresses.
  return email.includes('.') ? email : ''
}

/**
 * Score a profile as a brand. >= 2 is a brand, below that is a creator or unreachable.
 *
 * Own-domain is the load-bearing signal — creators overwhelmingly point at a Linktree
 * while shops point at the thing they sell from. Category is a good confirmation but
 * Instagram leaves it blank more often than not, so it cannot be the gate on its own.
 */
export function classifyProfile(p: RawProfile): number {
  if (p.is_private) return -99

  const cat = (p.category_name ?? '').toLowerCase()
  let score = 0

  // Weighted heaviest because ownSite() already proved the domain echoes the profile.
  if (ownSite(p)) score += 3
  else score -= 2

  if (cat && hasWord(cat, CREATOR_CATEGORY)) score -= 3
  else if (cat && hasWord(cat, COMMERCE_CATEGORY)) score += 2

  if (p.is_business_account) score += 1

  return score
}

/** One search. Returns [] on any failure — the caller decides whether to try more. */
export async function searchProfiles(apiKey: string, query: string): Promise<RawProfile[]> {
  try {
    const res = await fetch(
      `${SC_BASE}/v1/instagram/search/profiles?query=${encodeURIComponent(query)}`,
      {
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(SC_TIMEOUT),
      },
    )
    if (!res.ok) return []
    const j = await res.json()
    return Array.isArray(j?.profiles) ? (j.profiles as RawProfile[]) : []
  } catch {
    return []
  }
}

// Emoji, dingbats and arrows. Instagram display names use these as decoration AND as
// separators ("FJ SWIM 👙 Handmade Bikinis"), so they are cut points, not noise to strip.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u

/**
 * The display name, reduced to something that can follow "Hi " in an email.
 *
 * NFKC first: Instagram vanity fonts are mathematical-alphanumeric codepoints, so
 * "𝘴𝘮𝘢𝘭𝘭" is not the word "small" until it is normalized. Then cut at the first
 * separator — a bar, a slash or an emoji — since everything after it is a tagline.
 */
export function cleanBrandName(raw: string): string {
  // Strip the marks BEFORE normalizing — NFKC expands ™ into the letters "TM", which
  // would otherwise survive into the greeting as "The Bikini Shoppe TM".
  const marks = (raw ?? '').replace(/[®™©]/g, ' ')
  const cut = marks.normalize('NFKC').split(/[|｜–—•·/]|\s[-–]\s/)[0]
  return cut
    .split(EMOJI)[0]
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\s+official$/i, '')
    .replace(/[,:;\-–—|]+$/, '')
    .trim()
}

/** A brand-shaped candidate from a raw profile, or null if it reads as a creator. */
export function toCandidate(p: RawProfile): BrandCandidate | null {
  if (classifyProfile(p) < 2) return null
  const website = ownSite(p)
  if (!website) return null

  // Prefer the profile's own name; fall back to the domain when it is a person's name
  // or a tagline, since the domain at least cannot be a sentence.
  const label = domainLabel(website)
  const fromDomain = label.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const full = cleanBrandName(p.full_name ?? '')
  const usable = full && full.length <= 40 && full.split(/\s+/).length <= 5
  const echoes = usable && (squash(full).includes(squash(label)) || squash(label).includes(squash(full)))

  return {
    brand: echoes ? full : fromDomain,
    website,
    country: '',
    handle: p.username ?? '',
    followers: p.follower_count ?? 0,
    email: emailFromBio(p.biography ?? ''),
  }
}
