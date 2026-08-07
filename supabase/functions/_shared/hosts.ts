// Host classification shared by discovery (Instagram) and email lookup (Brave).
// Decides whether a hostname could be a brand's own site, and normalizes it so the
// same company never enters the pipeline twice under two regional domains.

/** Hosts that are never a brand to pitch: platforms, marketplaces, publishers, aggregators. */
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
  // tooling / reviews / directories / B2B data brokers
  'trustpilot.com', 'yelp.com', 'glassdoor.', 'crunchbase.com', 'zoominfo.com',
  'rocketreach.co', 'apollo.io', 'hunter.io', 'signalhire.com', 'lusha.com',
  'shopify.com', 'myshopify.com', 'wixsite.com', 'squarespace.com', 'bigcartel.com',
  'google.', 'bing.com', 'duckduckgo.com', 'quora.com', 'pinterest.',
]

const BLOCKED_TLD = ['.gov', '.edu', '.mil', '.ac.uk', '.gov.uk']

/**
 * Link aggregators. A profile whose only link is one of these has no own site we can
 * scrape or address — and in practice that profile is a creator, not a brand.
 */
export const LINK_AGGREGATORS = [
  'linktr.ee', 'beacons.ai', 'linkin.bio', 'lnk.bio', 'later.com', 'milkshake.app',
  'campsite.bio', 'taplink.cc', 'komi.io', 'shorby.com', 'bio.link', 'solo.to',
  'carrd.co', 'allmylinks.com', 'flowcode.com', 'linkpop.com', 'stan.store',
  'drive.google.com', 'docs.google.com', 'forms.gle', 'wa.me', 'linktree.com',
  // affiliate / storefront shims — these front for a brand without being one
  'likeshop.me', 'liketoknow.it', 'ltk.app', 'shopmy.us', 'snipfeed.co', 'koji.to',
  'withkoji.com', 'hoo.be', 'tap.bio', 'msha.ke', 'flow.page', 'sleek.bio',
  'lnk.to', 'linkr.bio', 'pixelfy.me', 'geni.us', 'bit.ly', 'tinyurl.com',
  // app / mini-site builders that host a brand's page on their own domain
  'appbrew.link', 'page.link', 'app.link', 'onelink.me', 'smart.link',
]

export function isLinkAggregator(host: string): boolean {
  return LINK_AGGREGATORS.some((a) => host === a || host.endsWith(`.${a}`) || host.includes(a))
}

export function isPlausibleBrandHost(host: string): boolean {
  if (!host.includes('.') || host.split('.').length > 4) return false
  if (BLOCKED_HOST.some((b) => host === b.replace(/\.$/, '') || host.includes(b))) return false
  if (BLOCKED_TLD.some((t) => host.endsWith(t))) return false
  return true
}

// Regional and functional prefixes: us.lounge.com and lounge.com are one company.
const SUBDOMAIN_NOISE = new Set([
  'us', 'uk', 'eu', 'ca', 'au', 'nz', 'de', 'fr', 'it', 'es', 'nl', 'se', 'jp', 'kr',
  'en', 'intl', 'global', 'international', 'shop', 'store', 'www2', 'm', 'mobile',
])

/** `us.honeybirdette.com` → `honeybirdette.com`. Leaves real subdomains alone. */
export function apexHost(host: string): string {
  const parts = host.split('.')
  return parts.length >= 3 && SUBDOMAIN_NOISE.has(parts[0]) ? parts.slice(1).join('.') : host
}

export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Free mailbox providers: allowed only when the address itself echoes the brand. */
const FREE_MAIL = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'mail.com', 'yandex.com', 'naver.com', 'qq.com', '163.com',
]

/** Hostname from any URL-ish string, lowercased and www-stripped. '' when unparseable. */
export function hostOf(value: string): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname
      .replace(/^www\./, '')
      .toLowerCase()
  } catch {
    return ''
  }
}

/** The domain's own label: `nativeboutique.com` → `nativeboutique`. */
export function domainLabel(host: string): string {
  return apexHost(host).replace(/^www\./, '').split('.')[0]
}

// "Gymshark | Official Site — Workout Clothes" → "Gymshark".
// Search titles are marketing strings; everything past the first separator is a tagline.
export function brandFromTitle(title: string, host: string): string {
  const label = domainLabel(host)
  const fromDomain = label.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  let s = (title || '').split(/[|｜–—•·>»]|\s[-–]\s/)[0].trim()
  s = s.replace(/\b(official (web)?site|official store|official online store|home ?page|home|shop online|online shop|official)\b/gi, '').trim()
  s = s.replace(/[®™©]/g, '').trim()
  s = s.replace(/\s+(US|USA|UK|GB|EU|CA|AU|NZ|DE|FR|IT|ES|NL|SE|JP|KR)$/i, '').trim()
  s = s.replace(/[,:;\-–—]+$/, '').trim()
  if (!s || s.length > 40 || s.split(/\s+/).length > 5) return fromDomain

  // Tagline guard: a real brand name echoes its own domain. blushlingerie.com titled
  // its page "Luxury Lingerie For Women", which would have gone out in the greeting.
  const a = squash(s)
  const b = squash(label)
  if (a && b && !a.includes(b) && !b.includes(a)) return fromDomain

  return s
}

/**
 * Does this address plausibly belong to this brand?
 *
 * THE GUARD that was missing. A brand's page carries other people's addresses:
 * @font-face license headers (manhattan-denim.com yielded four type designers and
 * zero real contacts), embedded Shopify app widgets (support@starapps.studio), and
 * agency credits. Shape filtering cannot tell those apart — only ownership can.
 *
 * Deliberately looser than exact-match, because the same company legitimately answers
 * on a sibling domain: withjean.com → withjean.com.au, skin1004.com → skin1004korea.com,
 * yourparade.com → parade.ca.
 */
export function emailBelongsToBrand(email: string, website: string, brand = ''): boolean {
  const domain = (email.split('@')[1] ?? '').toLowerCase()
  const site = apexHost((website ?? '').toLowerCase().replace(/^www\./, ''))
  if (!domain || !site) return false

  if (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`)) return true

  const siteLabel = squash(domainLabel(site))
  const brandKey = squash(brand)
  const local = squash(email.split('@')[0] ?? '')

  // A local part that NAMES the brand is strong evidence wherever it is hosted:
  // denimio@lingble.com is Denimio's outsourced support, pandoracs@starluxe.co.kr is
  // Pandora's regional distributor. Only this direction — siteLabel containing `local`
  // would accept press@anyone.com for a brand that happens to be called "PressPlay".
  if (local.length >= 4) {
    if (siteLabel.length >= 4 && local.includes(siteLabel)) return true
    if (brandKey.length >= 4 && local.includes(brandKey)) return true
  }

  // A free mailbox has no domain signal left, so the echo above was its only chance.
  if (FREE_MAIL.includes(domain)) return false

  // Sibling domain: one label must contain the other, and both must be long enough
  // that the overlap means something ("apm" would match half the web).
  const mailLabel = squash(domainLabel(domain))
  if (siteLabel.length < 4 || mailLabel.length < 4) return false
  return siteLabel.includes(mailLabel) || mailLabel.includes(siteLabel)
}

