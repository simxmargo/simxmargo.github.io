// Which ONE address do we write to, when a brand's site hands us twenty?
//
// This is the single ranking definition for the whole system. It runs:
//   • in `scrape-static` (Deno)      — deciding what to store after a crawl
//   • in `discover-brands` (Deno)    — validating an address lifted from an IG bio
//   • in the admin bundle (browser)  — `dedupeContacts.ts`, for bulk queueing
//   • in `scripts/dedupe-contacts.mjs` (Node) — collapsing rows already in the table
//
// It lives in `lib/` because that is the direction imports already run: Edge Functions
// reach up into `lib/` (`sendPitch.ts` → `lib/emailBody.ts`), the Next bundle imports
// it natively, and Node 24 strips the types on the way in. Four copies of "best
// address" is how a scraper and a sender end up disagreeing about who to email.
//
// ── The two questions this answers ──────────────────────────────────────────────
// 1. WHO READS IT. A pitch to `partnerships@` is read by the person whose job is
//    partnerships. The same pitch to `returns@` is read by nobody. Role intent is the
//    dominant term for that reason, and it is why this file exists at all.
// 2. IS IT STILL ALIVE. There is no verification API here — nothing pings the mailbox.
//    Liveness is inferred from how the address was published: a `mailto:` href a human
//    wrote, repeated across pages, on the brand's own apex domain, is a live desk. A
//    personal name found once in a script blob on a sibling domain is a person who may
//    have left in 2019. These are adjustments, never the deciding term, because a
//    confident guess about liveness is still a guess.
//
// PURE — no network, no DB, no Deno/browser globals.

import { apexHost, domainLabel, emailBelongsToBrand, hasPlausibleTld, squash } from './hosts.ts'

/** Mirrors the `contacts.email_type` CHECK constraint (0001_init.sql). Do not extend. */
export type EmailType = 'partnerships' | 'press' | 'generic' | 'named'

/** How an address reached us. Ordered by how deliberate the publication was. */
export type FoundVia = 'mailto' | 'bio' | 'search' | 'body'

export interface EmailCandidate {
  email: string
  via: FoundVia
  /** Page it was first seen on — becomes `contacts.source_url`. */
  sourceUrl?: string
  /** Distinct pages that carried it. 2+ means the site still maintains it. */
  pageHits?: number
  /** True when it appeared on a dedicated contact/press page, not just the homepage. */
  onContactPage?: boolean
}

export interface ScoredEmail {
  email: string
  type: EmailType
  /** 0-100. Stored in the long-unused `contacts.confidence` column. */
  score: number
  sourceUrl: string
  via: FoundVia
  /** Human-readable trace of what moved the score. Shown in the cleanup report. */
  reasons: string[]
}

export interface PickResult {
  /** The address to actually write to. Null when nothing survived the gate. */
  winner: ScoredEmail | null
  /** Runners-up, best first, capped. Stored on the winner as `contacts.alternates`. */
  alternates: ScoredEmail[]
  /** Dropped before scoring, with the reason. Diagnostics only. */
  rejected: Array<{ email: string; reason: string }>
}

// ── Role vocabulary ──────────────────────────────────────────────────────────────
//
// Tiers, not a flat list. "Prioritise partnerships" is the headline rule, but
// `partnerships@` and `wholesale@` are not the same desk: one exists to talk to
// creators, the other to talk to stockists. Both classify as `partnerships` for the
// email_type column — the CHECK constraint only knows four values — and the tier is
// what actually decides which one gets the pitch.

/** Reads creator pitches as its job. */
const ROLE_COLLAB = /^(partnership|partners?|collab|collaboration|influencer|creator|ambassador|ugc|prcollab|talent|seeding|gifting)/
/** Owns the brand's voice; forwards creator mail to whoever handles it. */
const ROLE_MARKETING = /^(marketing|brand|community|social|socialmedia|content|digital)/
/** Trade desks. Real humans, wrong department — still better than support. */
const ROLE_TRADE = /^(wholesale|affiliate|affiliates|reseller|stockist|b2b|retail|retailers|distribut)/
/** Press. `pr` must be a whole token: unanchored, `^pr` also swallowed privacy@ and promo@. */
const ROLE_PRESS = /^(press|pr|media|publicity|newsroom|editorial)([._\-+]|$)/
/** The front door. Generic, but a human reads it. */
const ROLE_FRONTDOOR = /^(hello|hi|hey|info|contact|enquir|inquir|ask|team|office|general|studio|hola|bonjour)/
/** Post-purchase. A creator pitch here is a ticket in a support queue. */
const ROLE_SERVICE = /^(support|help|care|customercare|customerservice|customer|service|orders?|returns?|refund|shipping|delivery|warranty|repairs?|shop|sales|store)/
/** Back office. Never the right recipient for a collaboration. */
const ROLE_BACKOFFICE = /^(legal|careers?|jobs|hr|recruit|accounts?|billing|invoice|finance|payable|receivable|privacy|dpo|gdpr|security|compliance|tax|audit|it|webmaster|dev|api|noc)/

/** Addresses that are never a human. A send here is guaranteed wasted or bounced. */
const NEVER_HUMAN = /^(noreply|no-reply|donotreply|do-not-reply|postmaster|mailer-daemon|mailerdaemon|abuse|bounce|bounces|unsubscribe|root|daemon|cron|automated|notification|notifications|alerts?)([._\-+]|$)/

/** Free mailbox providers. A brand answering on one is smaller and often personal. */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'naver.com', 'qq.com',
  '163.com', '126.com', 'zoho.com',
])

// Markup that survived decoding and fused itself to the front of a local part.
//
// Storefronts inline their state as JSON inside <script>, where `>` is written `>`
// and a non-breaking space as `&nbsp;`. When a decode pass misses one, the escape
// becomes part of the address: `u003ehello@houseofcb.com`, `u003ecustomercare@gorjana.com`,
// and `nbspsupport@frankiesbikinis.com` — which OUTSCORED the clean `support@` twin
// sitting right beside it, because "nbspsupport" reads as an unrecognised mailbox while
// "support" reads as a service queue.
//
// Rejected rather than repaired. Stripping the prefix would be a guess about what the
// page meant, and in every case observed the clean address was also on the page — so
// dropping the corrupted twin promotes the real one for free.
const ENTITY_DEBRIS = /^(u00[0-9a-f]{2}|x00[0-9a-f]{2}|nbsp|#\d+|(?:amp|quot|apos|lt|gt)[a-z])/

/** Placeholder and vendor domains that are never the brand's own inbox. */
const JUNK_DOMAIN = new Set([
  'example.com', 'example.org', 'example.net', 'domain.com', 'yourdomain.com',
  'yoursite.com', 'email.com', 'sentry.io', 'wixpress.com', 'sentry.wixpress.com',
  'sentry-next.wixpress.com', 'wix.com', 'squarespace.com', 'godaddy.com',
  'domainsbyproxy.com', 'shopify.com', 'myshopify.com', 'wordpress.com', 'schema.org',
  'w3.org', 'sentry-cdn.com',
])

// Retail-location markers. meandem.com published one mailbox PER STORE — twenty of
// them, `marylebone@`, `harrods.london@`, `mercer.nyc@` — all live, all answered by a
// shop floor with no interest in a collaboration. The unrecognised-role score already
// ranks them below `press@`; this just widens the gap so a branch can never win by
// accumulating liveness bonuses.
const PLACE_TOKEN = new Set([
  'london', 'nyc', 'ny', 'la', 'sf', 'paris', 'milan', 'rome', 'madrid', 'berlin',
  'munich', 'amsterdam', 'dublin', 'edinburgh', 'glasgow', 'manchester', 'birmingham',
  'leeds', 'bristol', 'harrogate', 'brighton', 'oxford', 'cambridge', 'dubai',
  'sydney', 'melbourne', 'brisbane', 'perth', 'auckland', 'tokyo', 'osaka', 'seoul',
  'shanghai', 'beijing', 'singapore', 'bangkok', 'manila', 'jakarta', 'mumbai', 'delhi',
  'toronto', 'vancouver', 'montreal', 'chicago', 'boston', 'miami', 'dallas', 'houston',
  'austin', 'denver', 'seattle', 'portland', 'atlanta', 'phoenix', 'vegas', 'philly',
  'philadelphia', 'sandiego', 'sanfrancisco', 'paloalto', 'brooklyn', 'soho', 'chelsea',
  'mayfair', 'battersea', 'marylebone', 'shoreditch', 'buckhead', 'stanford',
])
const PLACE_SUFFIX = /(street|st|avenue|ave|road|rd|lane|square|sq|mall|plaza|centre|center|boutique|flagship|outlet|branch|shopfloor)$/

const localOf = (email: string) => email.slice(0, email.lastIndexOf('@')).toLowerCase()
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

// Anchored and strict. `EMAIL_RE` in the scraper only has to FIND a candidate in a wall
// of markup; this decides whether we are willing to put a brand's reputation behind it.
const STRICT_SHAPE =
  /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

/**
 * Would we ever send here? The gate before scoring.
 *
 * Deliberately STRICTER than the scraper's `isLikelyContactEmail`, which is an
 * extraction filter: its job is "did we pull a real address out of this HTML", and a
 * false positive there only costs a wasted row. This is the send filter — a false
 * positive costs a hard bounce, and bounces are charged against the sending domain's
 * reputation for every future pitch.
 */
export function mailableReason(email: string): string {
  const e = (email || '').trim().toLowerCase()
  if (!STRICT_SHAPE.test(e)) return 'malformed'
  if (e.length > 100) return 'too long'
  const domain = domainOf(e)
  const local = localOf(e)
  if (!hasPlausibleTld(domain)) return `unrecognised TLD (.${domain.split('.').pop()})`
  if (JUNK_DOMAIN.has(domain)) return 'placeholder or vendor domain'
  if (ENTITY_DEBRIS.test(local)) return 'markup debris fused to the address'
  if (NEVER_HUMAN.test(local)) return 'automated mailbox'
  if (/^[0-9a-f]{16,}$/.test(local)) return 'tracking hash, not an address'
  return ''
}

export const isMailable = (email: string): boolean => mailableReason(email) === ''

/**
 * The four-value `email_type` for the contacts CHECK constraint.
 *
 * Canonical: `supabase/functions/_shared/scrape.ts` re-exports this rather than keeping
 * its own copy, so the column and the ranking always agree about what a row IS.
 */
export function classifyEmail(email: string): EmailType {
  const local = localOf(email)
  if (ROLE_PRESS.test(local)) return 'press'
  if (ROLE_COLLAB.test(local) || ROLE_MARKETING.test(local) || ROLE_TRADE.test(local)) {
    return 'partnerships'
  }
  if (ROLE_FRONTDOOR.test(local) || ROLE_SERVICE.test(local) || ROLE_BACKOFFICE.test(local)) {
    return 'generic'
  }
  if (/^[a-z]+[._][a-z]+/.test(local)) return 'named'
  return 'generic'
}

/** Base score from role intent alone — the dominant term. */
function roleBase(local: string): { base: number; why: string } {
  if (ROLE_COLLAB.test(local)) return { base: 62, why: 'collaborations desk' }
  if (ROLE_MARKETING.test(local)) return { base: 54, why: 'marketing / community desk' }
  if (ROLE_PRESS.test(local)) return { base: 46, why: 'press desk' }
  if (ROLE_TRADE.test(local)) return { base: 42, why: 'trade / wholesale desk' }
  if (ROLE_FRONTDOOR.test(local)) return { base: 34, why: 'general enquiries' }
  if (/^[a-z]+[._][a-z]+/.test(local)) return { base: 24, why: 'a named individual' }
  if (ROLE_SERVICE.test(local)) return { base: 16, why: 'customer service queue' }
  if (ROLE_BACKOFFICE.test(local)) return { base: 8, why: 'back-office mailbox' }
  return { base: 18, why: 'unrecognised mailbox' }
}

function looksLikeStoreBranch(local: string): boolean {
  const parts = local.split(/[._\-+]/).filter(Boolean)
  if (parts.some((p) => PLACE_TOKEN.has(p))) return true
  if (parts.some((p) => PLACE_SUFFIX.test(p) && p.length > 6)) return true
  // `selfridgeslondon`, `westbournegrove` — one glued token containing a place name.
  const joined = squash(local)
  return [...PLACE_TOKEN].some((p) => p.length >= 6 && joined.includes(p))
}

/**
 * Score one candidate in the context of the company it was found for.
 *
 * Role intent sets the base; publication signals adjust it. Adjustments are bounded so
 * they can reorder neighbours but never promote a support queue over a partnerships
 * desk — inference about liveness should not outrank a known fact about intent.
 */
export function scoreEmail(c: EmailCandidate, website: string, brand = ''): ScoredEmail {
  const email = c.email.trim().toLowerCase()
  const local = localOf(email)
  const domain = domainOf(email)
  const site = apexHost((website || '').toLowerCase().replace(/^www\./, ''))

  const { base, why } = roleBase(local)
  const reasons: string[] = [why]
  let score = base

  if (domain === site) {
    score += 10
    reasons.push('on the brand’s own domain')
  } else if (FREE_MAIL.has(domain)) {
    score -= 16
    reasons.push('free mailbox provider')
  } else {
    // Reached here only because emailBelongsToBrand() already accepted it, so this is a
    // sibling or regional domain rather than a stranger's.
    score -= 4
    reasons.push('sibling domain')
  }

  if (c.via === 'mailto') {
    score += 12
    reasons.push('published as a mailto: link')
  } else if (c.via === 'bio') {
    score += 10
    reasons.push('published in the Instagram bio')
  } else if (c.via === 'search') {
    score += 2
    reasons.push('found via the search index')
  }

  if ((c.pageHits ?? 1) >= 2) {
    score += 8
    reasons.push(`repeated on ${c.pageHits} pages`)
  }
  if (c.onContactPage) {
    score += 6
    reasons.push('on a dedicated contact page')
  }

  if (looksLikeStoreBranch(local)) {
    score -= 22
    reasons.push('reads as a single store location')
  }
  if (/\d{2,}$/.test(local)) {
    score -= 8
    reasons.push('numeric suffix — often a superseded address')
  }
  if (local.length <= 12) score += 3

  // A local part echoing the brand is reassuring on a sibling domain and meaningless on
  // the brand's own (`gymshark@gymshark.com` is not better than `press@gymshark.com`).
  if (domain !== site && squash(local).includes(squash(domainLabel(site)))) {
    score += 6
    reasons.push('local part names the brand')
  }

  return {
    email,
    type: classifyEmail(email),
    score: Math.max(0, Math.min(100, Math.round(score))),
    sourceUrl: c.sourceUrl ?? '',
    via: c.via,
    reasons,
  }
}

/** Total, stable ordering. Ties must not depend on Map or array insertion luck. */
const VIA_RANK: Record<FoundVia, number> = { mailto: 0, bio: 1, search: 2, body: 3 }
function compare(a: ScoredEmail, b: ScoredEmail): number {
  if (b.score !== a.score) return b.score - a.score
  if (VIA_RANK[a.via] !== VIA_RANK[b.via]) return VIA_RANK[a.via] - VIA_RANK[b.via]
  const la = localOf(a.email).length
  const lb = localOf(b.email).length
  if (la !== lb) return la - lb // the shorter local part is the canonical one
  return a.email < b.email ? -1 : a.email > b.email ? 1 : 0
}

/** Alternates kept per company. Enough to recover from a bounce without bloating jsonb. */
export const MAX_ALTERNATES = 8

/**
 * Collapse every address found for one company down to the one worth writing to.
 *
 * Ownership is a HARD GATE rather than a penalty, and runs first: manhattan-denim.com's
 * contact page yielded four addresses, every one of them a font foundry from an
 * @font-face licence header. No amount of role scoring makes a type designer the right
 * recipient — the address simply is not the brand's, so it never enters the ranking.
 */
export function pickBestEmail(
  candidates: EmailCandidate[],
  website: string,
  brand = '',
): PickResult {
  const rejected: Array<{ email: string; reason: string }> = []
  const seen = new Set<string>()
  const scored: ScoredEmail[] = []

  for (const c of candidates) {
    const email = (c.email || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)

    const bad = mailableReason(email)
    if (bad) {
      rejected.push({ email, reason: bad })
      continue
    }
    if (!emailBelongsToBrand(email, website, brand)) {
      rejected.push({ email, reason: 'belongs to a third party, not this brand' })
      continue
    }
    scored.push(scoreEmail(c, website, brand))
  }

  scored.sort(compare)
  return {
    winner: scored[0] ?? null,
    alternates: scored.slice(1, 1 + MAX_ALTERNATES),
    rejected,
  }
}

/** The `contacts.alternates` jsonb shape — trimmed, since the reasons are for humans. */
export interface StoredAlternate {
  email: string
  type: EmailType
  score: number
}

export const toStoredAlternates = (alts: ScoredEmail[]): StoredAlternate[] =>
  alts.map((a) => ({ email: a.email, type: a.type, score: a.score }))
