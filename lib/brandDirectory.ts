// A curated starting list of overseas fashion, apparel and beauty brands.
//
// WHY THIS EXISTS: "Scrape new brands" used to open on an empty textarea, which quietly
// made the hardest part of outreach — deciding WHO to pitch — the user's problem, and
// the tool's easiest-looking screen. Picking from a list is a two-click job; recalling
// forty brand domains from memory is not.
//
// SCOPE, on purpose:
//   • fashion / clothing / accessories / beauty only — the niches this creator works in
//   • overseas only (no PH-local brands), which is where the collab budgets are
//   • brands with a real public contact or press page, so the static scraper has a
//     chance; the scraper's ~40% yield is normal and expected
//
// This is a convenience list, NOT a guarantee: some of these will block the scraper
// (403/429) or publish no address. The modal reports per-brand outcomes either way.
//
// To extend: add a row. Nothing else needs changing — categories are derived.

export interface DirectoryBrand {
  name: string
  domain: string
  /** ISO-ish country used to prefill the contact's country column. */
  country: string
  category: string
}

export const BRAND_DIRECTORY: DirectoryBrand[] = [
  // ── Jewellery & fine accessories ─────────────────────────────────────────
  { name: 'Mejuri', domain: 'mejuri.com', country: 'CA', category: 'Jewellery' },
  { name: 'Missoma', domain: 'missoma.com', country: 'UK', category: 'Jewellery' },
  { name: 'Astrid & Miyu', domain: 'astridandmiyu.com', country: 'UK', category: 'Jewellery' },
  { name: 'Ana Luisa', domain: 'analuisa.com', country: 'US', category: 'Jewellery' },
  { name: 'Monica Vinader', domain: 'monicavinader.com', country: 'UK', category: 'Jewellery' },
  { name: 'Daniel Wellington', domain: 'danielwellington.com', country: 'SE', category: 'Jewellery' },
  { name: 'Pandora', domain: 'pandora.net', country: 'DK', category: 'Jewellery' },
  { name: 'Gorjana', domain: 'gorjana.com', country: 'US', category: 'Jewellery' },

  // ── Womenswear ───────────────────────────────────────────────────────────
  { name: 'Reformation', domain: 'thereformation.com', country: 'US', category: 'Womenswear' },
  { name: 'Princess Polly', domain: 'princesspolly.com', country: 'AU', category: 'Womenswear' },
  { name: 'Sézane', domain: 'sezane.com', country: 'FR', category: 'Womenswear' },
  { name: 'Aritzia', domain: 'aritzia.com', country: 'CA', category: 'Womenswear' },
  { name: 'Ganni', domain: 'ganni.com', country: 'DK', category: 'Womenswear' },
  { name: 'Realisation Par', domain: 'realisationpar.com', country: 'US', category: 'Womenswear' },
  { name: 'With Jean', domain: 'withjean.com', country: 'AU', category: 'Womenswear' },
  { name: 'Meshki', domain: 'meshki.com', country: 'AU', category: 'Womenswear' },
  { name: 'Selfie Leslie', domain: 'selfieleslie.com', country: 'US', category: 'Womenswear' },
  { name: 'Cider', domain: 'shopcider.com', country: 'SG', category: 'Womenswear' },
  { name: 'House of CB', domain: 'houseofcb.com', country: 'UK', category: 'Womenswear' },
  { name: 'Oh Polly', domain: 'ohpolly.com', country: 'UK', category: 'Womenswear' },

  // ── Activewear & athleisure ──────────────────────────────────────────────
  { name: 'Alo Yoga', domain: 'aloyoga.com', country: 'US', category: 'Activewear' },
  { name: 'Gymshark', domain: 'gymshark.com', country: 'UK', category: 'Activewear' },
  { name: 'Vuori', domain: 'vuoriclothing.com', country: 'US', category: 'Activewear' },
  { name: 'Set Active', domain: 'setactive.co', country: 'US', category: 'Activewear' },
  { name: 'Outdoor Voices', domain: 'outdoorvoices.com', country: 'US', category: 'Activewear' },
  { name: 'Girlfriend Collective', domain: 'girlfriend.com', country: 'US', category: 'Activewear' },
  { name: 'Halara', domain: 'thehalara.com', country: 'US', category: 'Activewear' },
  { name: 'Oner Active', domain: 'oneractive.com', country: 'UK', category: 'Activewear' },

  // ── Sustainable & slow fashion ───────────────────────────────────────────
  { name: 'Everlane', domain: 'everlane.com', country: 'US', category: 'Sustainable' },
  { name: 'Pangaia', domain: 'thepangaia.com', country: 'UK', category: 'Sustainable' },
  { name: 'Kotn', domain: 'kotn.com', country: 'CA', category: 'Sustainable' },
  { name: 'Organic Basics', domain: 'organicbasics.com', country: 'DK', category: 'Sustainable' },
  { name: 'Nudie Jeans', domain: 'nudiejeans.com', country: 'SE', category: 'Sustainable' },
  { name: 'Vitamin A', domain: 'vitaminaswim.com', country: 'US', category: 'Sustainable' },

  // ── Beauty & skincare ────────────────────────────────────────────────────
  { name: 'Glossier', domain: 'glossier.com', country: 'US', category: 'Beauty' },
  { name: 'The Inkey List', domain: 'theinkeylist.com', country: 'UK', category: 'Beauty' },
  { name: 'Youth To The People', domain: 'youthtothepeople.com', country: 'US', category: 'Beauty' },
  { name: 'Frank Body', domain: 'frankbody.com', country: 'AU', category: 'Beauty' },
  { name: 'Rare Beauty', domain: 'rarebeauty.com', country: 'US', category: 'Beauty' },
  { name: 'Tower 28', domain: 'tower28beauty.com', country: 'US', category: 'Beauty' },
  { name: 'Kosas', domain: 'kosas.com', country: 'US', category: 'Beauty' },
  { name: 'Typology', domain: 'typology.com', country: 'FR', category: 'Beauty' },
  { name: 'Beauty of Joseon', domain: 'beautyofjoseon.com', country: 'KR', category: 'Beauty' },
  { name: 'Laneige', domain: 'laneige.com', country: 'KR', category: 'Beauty' },
  { name: 'Anua', domain: 'anua.co.kr', country: 'KR', category: 'Beauty' },
  { name: 'Skin1004', domain: 'skin1004.com', country: 'KR', category: 'Beauty' },

  // ── Footwear ─────────────────────────────────────────────────────────────
  { name: 'Vagabond', domain: 'vagabond.com', country: 'SE', category: 'Footwear' },
  { name: 'Dr. Martens', domain: 'drmartens.com', country: 'UK', category: 'Footwear' },
  { name: 'Veja', domain: 'veja-store.com', country: 'FR', category: 'Footwear' },
  { name: 'Birkenstock', domain: 'birkenstock.com', country: 'DE', category: 'Footwear' },
  { name: 'Allbirds', domain: 'allbirds.com', country: 'US', category: 'Footwear' },
  { name: 'Steve Madden', domain: 'stevemadden.com', country: 'US', category: 'Footwear' },

  // ── Bags & accessories ───────────────────────────────────────────────────
  { name: 'Cuyana', domain: 'cuyana.com', country: 'US', category: 'Accessories' },
  { name: 'Baggu', domain: 'baggu.com', country: 'US', category: 'Accessories' },
  { name: 'Polène', domain: 'polene-paris.com', country: 'FR', category: 'Accessories' },
  { name: 'JW Pei', domain: 'jwpei.com', country: 'US', category: 'Accessories' },
  { name: 'Quay Australia', domain: 'quayaustralia.com', country: 'AU', category: 'Accessories' },
  { name: 'Vera Bradley', domain: 'verabradley.com', country: 'US', category: 'Accessories' },

  // ── Swim & intimates ─────────────────────────────────────────────────────
  { name: 'Frankies Bikinis', domain: 'frankiesbikinis.com', country: 'US', category: 'Swim & intimates' },
  { name: 'Peppermayo', domain: 'peppermayo.com', country: 'AU', category: 'Swim & intimates' },
  { name: 'Skims', domain: 'skims.com', country: 'US', category: 'Swim & intimates' },
  { name: 'Parade', domain: 'yourparade.com', country: 'US', category: 'Swim & intimates' },
  { name: 'Lounge Underwear', domain: 'loungeunderwear.com', country: 'UK', category: 'Swim & intimates' },
  { name: 'Cupshe', domain: 'cupshe.com', country: 'US', category: 'Swim & intimates' },
]

/** Categories in directory order, deduped — drives the filter chips. */
export const BRAND_CATEGORIES: string[] = Array.from(
  new Set(BRAND_DIRECTORY.map((b) => b.category)),
)

/** `example.com` from any host form, so "already added" matches a stored website. */
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}
