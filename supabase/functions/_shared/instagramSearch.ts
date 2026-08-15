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

import {
  apexHost,
  domainLabel,
  hostOf,
  isLinkAggregator,
  isNotABrandName,
  isPlausibleBrandHost,
  squash,
} from './hosts.ts'

const SC_BASE = 'https://api.scrapecreators.com'
// 9s, not 20s. Measured 2026-08-10: a search answers in 10-20s when the API is warm and
// hangs to the full timeout when it is not. At 20s a run of 30 searches is 515s against
// a 150s Edge Function wall clock — which is exactly how discovery started returning 504
// instead of brands. There are 1,000+ queries in the pool, so a slow one is not worth
// waiting on: drop it and spend the time on the next.
const SC_TIMEOUT = 9_000

export interface BrandCandidate {
  brand: string
  website: string
  country: string
  /** Instagram handle, kept so a later step can look the brand up again. */
  handle: string
  followers: number
  /** Address lifted straight from the bio, when the brand published one. */
  email: string
  /** The bio says it is looking for creators — an ambassador programme, UGC, gifting. */
  wantsCreators: boolean
}

// ── WHAT WE SEARCH FOR ──────────────────────────────────────────────────────────
//
// These niches are drawn from the creator's OWN portfolio (`portfolio_brands`) and
// profile niche, not from a generic idea of "fashion". The brands she has actually
// been paid by, as of 2026-08-10:
//
//   FASHION  Fashion Nova · Oh Polly · Halara · LaceMade · CHNGE · Fashion Chingu ·
//            Glowmode        → affordable women's fashion, several Asia-based
//   APPS     Filmora · BeautyPlus · VivaVideo · Hypic · OldRoll · ProCCD ·
//            Kapi Cam · Reelsapp  → photo/video editing and retro-camera apps
//   MEDIA    Warner Music Group · Flighthouse Media · Field Office
//
// The APPS family is nearly HALF that list and previously had zero query coverage —
// every search was a clothing search. It is the most proven lead type she has, so it
// gets its own family rather than being wedged into retail framings that don't fit a
// company with no storefront.
//
// COMMERCE framings say "shop"/"store"/"brand" on purpose — searching a bare topic
// ("korean skincare") returns dermatologists and beauty bloggers, while the same topic
// plus a retail word returns the shops. They are the volume engine.
//
// INTENT framings target brands that are ALREADY recruiting creators. A brand running
// an ambassador programme has a budget line and a person whose job is answering pitches;
// a brand that merely exists has neither. These convert far better and are far scarcer.

const FASHION_NICHES = [
  'activewear', 'swimwear', 'lingerie', 'jewelry', 'skincare', 'haircare',
  'makeup', 'sunglasses', 'handbags', 'sneakers', 'denim', 'loungewear',
  'outerwear', 'athleisure', 'fragrance', 'streetwear', 'knitwear', 'accessories',
  'womens clothing', 'korean skincare', 'korean fashion', 'y2k fashion',
]

// No storefront to search for, so these are named the way the companies name
// themselves. Every one of these categories is represented in the portfolio.
const APP_NICHES = [
  'photo editing app', 'video editing app', 'camera app', 'retro camera app',
  'photo filter app', 'ai photo editor', 'selfie editor app', 'reels editing app',
  'lightroom presets', 'preset pack', 'canva templates', 'instagram templates',
  'content planner app', 'social media scheduling app',
]

// Agencies and media companies buy creator work in bulk and on retainer — a single
// yes is worth more than a one-off gifting deal. Warner Music, Flighthouse and Field
// Office all arrived this way.
const PARTNER_NICHES = [
  'influencer marketing agency', 'ugc agency', 'creator talent management',
  'social media agency', 'record label', 'music marketing agency',
  'creative agency', 'brand partnerships agency',
]

const COMMERCE_FRAMINGS = [
  'brand online store',
  'boutique shop',
  'official brand shop',
  'small business shop',
  'independent brand store',
  'sustainable brand shop',
  'new brand online',
]
const INTENT_FRAMINGS = [
  'ambassador program',
  'brand ambassador',
  'influencer collab',
  'ugc creators',
  'creator program',
  'pr packages',
]
// An app or an agency has no "shop", so retail framings return nothing for them.
// These say the thing those companies actually put in a bio.
const PARTNER_FRAMINGS = [
  'creator partnerships',
  'influencer marketing',
  'ugc creators wanted',
  'affiliate program',
  'official',
  'now casting creators',
]

/** One niche list crossed with one framing list. */
interface QueryFamily {
  niches: string[]
  framings: string[]
}

// ORDER IS THE PRIORITY. A run now stops on a wall-clock DEADLINE (see
// discover-brands), so it may only ever reach the first ten or fifteen queries —
// which makes the front of this list the part that actually runs. Warm, high-affinity
// families go first; the broad commerce sweep is the tail that fills a slow day.
const FAMILIES: QueryFamily[] = [
  { niches: FASHION_NICHES, framings: INTENT_FRAMINGS }, // brands recruiting creators
  { niches: APP_NICHES, framings: PARTNER_FRAMINGS }, // the proven portfolio lane
  { niches: PARTNER_NICHES, framings: PARTNER_FRAMINGS }, // agencies, retainers
  { niches: FASHION_NICHES, framings: COMMERCE_FRAMINGS }, // volume
]

/**
 * The search pool, INTERLEAVED across families.
 *
 * Interleaving matters because a run stops on a deadline or when the batch is full —
 * whichever comes first. Concatenating the families would mean a run that ends early
 * never issues a single app or agency query, and the whole point of having them is
 * lost. Round-robin guarantees every family gets a share of whatever budget the run
 * turns out to have.
 *
 * `extra` folds in the creator's own `public_profile.niche` terms so retuning the
 * media kit retunes discovery, with no redeploy.
 */
export function queryPool(extra: string[] = []): string[] {
  const lists = FAMILIES.map(({ niches, framings }) => {
    const out: string[] = []
    for (const n of niches) for (const f of framings) out.push(`${n} ${f}`)
    return out
  })

  // Profile niches ride at the FRONT of their own list: they are the creator's own
  // words for what she covers, so they are the least likely to be off-target.
  if (extra.length) {
    lists.unshift(extra.flatMap((n) => INTENT_FRAMINGS.map((f) => `${n} ${f}`)))
  }

  const out: string[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) {
    for (const l of lists) if (i < l.length) out.push(l[i])
  }
  return out
}

/**
 * Search terms from `public_profile.niche` ("FASHION · BEAUTY · EDITING · TEMPLATES").
 *
 * Single generic words are dropped: "fashion ambassador program" returns the same
 * mega-brands every run, and those are exactly the accounts that never answer.
 */
export function profileNiches(niche: string): string[] {
  return (niche || '')
    .split(/[·,|/]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 4 && s.split(/\s+/).length <= 3)
    .filter((s) => !['fashion', 'beauty', 'style', 'lifestyle', 'content'].includes(s))
}

// What a brand that wants creators actually writes in its bio. Deliberately phrase-led
// rather than keyword-led: "collab" alone matches creators advertising themselves for
// collabs, which is the exact population this pipeline exists to filter OUT.
const WANTS_CREATORS =
  /(ambassador program|ambassador programme|brand ambassador|become an ambassador|creator program|creator programme|influencer program|affiliate program|ugc creators?|ugc welcome|looking for (ugc |content )?creators?|looking for influencers|looking for ambassadors|seeking creators|creators? wanted|influencers? wanted|apply to (be|join)|join our team of|collab(?:oration)?s? (?:welcome|open)|open for collab|dm (?:us )?(?:for|to) collab|pr (?:package|list)|gifting program)/i

/** Does this bio say the brand is recruiting creators right now? */
export function wantsCreators(bio: string): boolean {
  return WANTS_CREATORS.test((bio || '').replace(/\s+/g, ' '))
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

export interface SearchOutcome {
  profiles: RawProfile[]
  /** 402 — the credit balance is spent. The caller must switch source, not retry. */
  outOfCredits: boolean
  /** Balance reported by the API, so a run can say what it cost. */
  creditsRemaining: number | null
}

/**
 * One search.
 *
 * Returns an OUTCOME rather than a bare array because "found nothing" and "we are out
 * of credits" need opposite responses — retry the next query, versus stop and fall back
 * to Brave. Collapsing both into `[]` made an exhausted balance look like a quiet niche.
 */
export async function searchProfiles(apiKey: string, query: string): Promise<SearchOutcome> {
  const empty = (outOfCredits = false): SearchOutcome => ({
    profiles: [],
    outOfCredits,
    creditsRemaining: null,
  })
  try {
    const res = await fetch(
      `${SC_BASE}/v1/instagram/search/profiles?query=${encodeURIComponent(query)}`,
      {
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(SC_TIMEOUT),
      },
    )
    if (res.status === 402) return empty(true)
    if (!res.ok) return empty()
    const j = await res.json()
    return {
      profiles: Array.isArray(j?.profiles) ? (j.profiles as RawProfile[]) : [],
      outOfCredits: false,
      creditsRemaining: typeof j?.credits_remaining === 'number' ? j.credits_remaining : null,
    }
  } catch {
    return empty()
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

  const brand = echoes ? full : fromDomain
  // Checked on both the display name and the domain-derived fallback: a magazine's
  // profile is a brand-shaped account by every other signal we have.
  if (isNotABrandName(brand) || isNotABrandName(p.full_name ?? '')) return null

  return {
    brand,
    website,
    country: '',
    handle: p.username ?? '',
    followers: p.follower_count ?? 0,
    email: emailFromBio(p.biography ?? ''),
    wantsCreators: wantsCreators(p.biography ?? ''),
  }
}

/**
 * Brands that say they want creators, first.
 *
 * The bio scan is the load-bearing intent signal, not the query. Instagram's profile
 * search matches mostly on username and display name, so an "ambassador program" query
 * returns brands whose NAME contains it — a handful. The bio, which every search result
 * carries anyway, is where a brand actually announces that it is recruiting. So the
 * intent queries widen the net and this ordering is what reads it.
 *
 * Stable: equal-intent candidates keep discovery order.
 */
export function intentFirst(candidates: BrandCandidate[]): BrandCandidate[] {
  return [...candidates].sort((a, b) => Number(b.wantsCreators) - Number(a.wantsCreators))
}
