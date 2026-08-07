// `discover-brands` Edge Function — finds brands to pitch that nobody typed in.
//
// SOURCES, in order of preference:
//   1. INSTAGRAM via ScrapeCreators (if SCRAPECREATORS_API_KEY is set) — the primary
//      path. A brand's profile carries its own site, its size, and often a contact
//      address, so one credit returns ten candidates already part-enriched.
//   2. WIKIDATA (always available, no key) — an open dataset of ~1,100 apparel
//      companies. Precise but finite; it exists so the button still works with no key
//      or no credits, matching how the rest of the pipeline degrades.
//
// Nothing here is hardcoded brand data — the only fixed lists are EXCLUSIONS.
//
// A candidate whose Instagram bio published an address needs no scraping at all, so it
// is written straight to `contacts` here and reported separately from the rest.
//
// Invoke: POST { "limit": 100 }   (admin-gated)
// Deploy: supabase functions deploy discover-brands --project-ref <ref> --use-api
// Secret: supabase secrets set SCRAPECREATORS_API_KEY=...

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { classifyEmail, normalizeDomain } from '../_shared/scrape.ts'
import {
  queryPool,
  searchProfiles,
  toCandidate,
  type BrandCandidate,
} from '../_shared/instagramSearch.ts'

const WIKIDATA = 'https://query.wikidata.org/sparql'
// Wikidata asks bots to identify themselves with a contact route. Do NOT replace this
// with a browser UA — that is exactly what their policy forbids.
const UA = 'brand-outreach-studio/1.0 (+https://simxmargo.github.io) brand-discovery'
const MAX_LIMIT = 200
// One search costs 1 credit and yields ~5 brands after filtering, so a 100-brand batch
// costs ~20. The cap keeps a single run from ever eating a large slice of the balance.
const MAX_SEARCHES = 30

// Deliberately the CHEAP shape. Adding `?item wdt:P31/wdt:P279* wd:Q4830453` to keep
// only businesses is more correct in theory and took 42 SECONDS in practice — close to
// Wikidata's 60s cutoff. The equivalent cleanup runs in TypeScript below in ~0ms.
const SPARQL = `
SELECT DISTINCT ?itemLabel ?w ?cc WHERE {
  { ?item wdt:P452 wd:Q12684 } UNION { ?item wdt:P452 wd:Q1049129 }
  UNION { ?item wdt:P1056 wd:Q11460 }
  UNION { ?item wdt:P31/wdt:P279* wd:Q19862406 }
  ?item wdt:P856 ?w .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  OPTIONAL { ?item wdt:P17 ?c . ?c wdt:P297 ?cc . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 1500`

// Events, fairs, museums and trade bodies share the same Wikidata industry classes as
// brands — "Dhaka Fashion Week" is not someone you pitch a Reel to.
const NOT_A_BRAND =
  /(fashion week|fashion fair|trade fair|expo|exhibition|museum|award|festival|magazine|association|university|school|college|council|foundation|federation|institute)/i
const MARKETPLACE = new Set([
  'amazon.com', 'ebay.com', 'etsy.com', 'aliexpress.com', 'walmart.com', 'target.com',
  'zalando.com', 'asos.com', 'shein.com', 'temu.com',
])

async function loadKnownDomains(supabase: SupabaseClient): Promise<Set<string>> {
  // scrape_jobs matters as much as contacts: a domain that yielded no address still
  // shouldn't come back next run, or we'd re-offer the same dead sites forever.
  const [{ data: contacts }, { data: jobs }] = await Promise.all([
    supabase.from('contacts').select('website'),
    supabase.from('scrape_jobs').select('website'),
  ])
  const known = new Set<string>()
  for (const r of [...(contacts ?? []), ...(jobs ?? [])]) {
    const d = normalizeDomain((r as { website: string | null }).website ?? '')
    if (d) known.add(d)
  }
  return known
}

async function viaInstagram(apiKey: string, known: Set<string>, limit: number) {
  const pool = queryPool()
  // Start somewhere random so consecutive runs explore different niches rather than
  // grinding the same first query every time.
  const start = Math.floor(Math.random() * pool.length)

  const fresh = new Map<string, BrandCandidate>()
  const used: string[] = []
  let screened = 0

  for (let i = 0; i < pool.length && fresh.size < limit && used.length < MAX_SEARCHES; i++) {
    const query = pool[(start + i) % pool.length]
    const profiles = await searchProfiles(apiKey, query)
    used.push(query)
    screened += profiles.length

    for (const p of profiles) {
      if (fresh.size >= limit) break
      const c = toCandidate(p)
      if (!c) continue // a creator, or no own site to pitch
      if (known.has(c.website) || fresh.has(c.website)) continue
      fresh.set(c.website, c)
    }
  }

  return {
    candidates: [...fresh.values()],
    // Instagram has no countable pool; report the cost so the credit balance is never
    // a mystery.
    searches: used.length,
    screened,
    queries: used,
    source: 'instagram' as const,
  }
}

async function viaWikidata(known: Set<string>, limit: number) {
  let rows: Array<Record<string, { value: string }>>
  try {
    const res = await fetch(`${WIKIDATA}?format=json&query=${encodeURIComponent(SPARQL)}`, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': UA },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { error: `Wikidata returned ${res.status}.` }
    rows = (await res.json())?.results?.bindings ?? []
  } catch (e) {
    return { error: e instanceof Error && e.name === 'TimeoutError' ? 'Wikidata timed out.' : 'Could not reach Wikidata.' }
  }

  const seen = new Set<string>()
  const candidates: BrandCandidate[] = []
  for (const r of rows) {
    const brand = r.itemLabel?.value ?? ''
    if (!brand || /^Q\d+$/.test(brand)) continue // no English label → a raw Q-id
    if (NOT_A_BRAND.test(brand)) continue
    const website = normalizeDomain(r.w?.value ?? '')
    if (!website || !website.includes('.') || website.split('.').length > 4) continue
    if (MARKETPLACE.has(website)) continue
    if (seen.has(website)) continue // one row per country: ASICS arrives 3x
    seen.add(website)
    candidates.push({ brand, website, country: r.cc?.value ?? '', handle: '', followers: 0, email: '' })
  }

  const fresh = candidates.filter((c) => !known.has(c.website))
  return {
    candidates: fresh.slice(0, limit),
    pool: candidates.length,
    remaining: fresh.length,
    source: 'wikidata' as const,
  }
}

/**
 * Write the candidates that already carry an address, and return the ones that still
 * need scraping. A bio address costs no extra request, so these skip the queue entirely.
 */
async function saveReadyContacts(supabase: SupabaseClient, candidates: BrandCandidate[]) {
  const ready = candidates.filter((c) => c.email)
  const rest = candidates.filter((c) => !c.email)
  if (ready.length === 0) return { saved: 0, rest }

  const rows = ready.map((c) => ({
    brand: c.brand,
    email: c.email,
    email_type: classifyEmail(c.email),
    country: c.country ?? '',
    website: c.website,
    source_url: c.handle ? `https://instagram.com/${c.handle}` : '',
    status: 'new',
  }))
  // ignoreDuplicates so a re-run never clobbers a row that sending has already touched.
  const { data, error } = await supabase
    .from('contacts')
    .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
    .select('id')
  if (error) return { saved: 0, rest, saveError: error.message }
  return { saved: data?.length ?? 0, rest }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const denied = await requireAdmin(req)
  if (denied) return denied

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Missing Supabase env' }, 500)
  const supabase = createClient(url, serviceKey)

  let limit = 12
  try {
    const body = await req.json()
    if (typeof body?.limit === 'number') limit = body.limit
  } catch {
    /* empty body → default */
  }
  limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)))

  const known = await loadKnownDomains(supabase)
  const scKey = Deno.env.get('SCRAPECREATORS_API_KEY')?.trim()

  if (scKey) {
    const out = await viaInstagram(scKey, known, limit)
    if (out.candidates.length > 0) {
      const { saved, rest, saveError } = await saveReadyContacts(supabase, out.candidates)
      return json({ ...out, candidates: rest, savedContacts: saved, saveError })
    }
    // A key that returns nothing (credits spent, outage) must not leave the button
    // dead — fall through to the dataset rather than reporting failure.
    const fallback = await viaWikidata(known, limit)
    return json({ ...fallback, note: 'Instagram search returned nothing this run — used Wikidata instead.' })
  }

  const out = await viaWikidata(known, limit)
  if ('error' in out) return json({ ...out, candidates: [] }, 502)
  return json({ ...out, note: 'Set SCRAPECREATORS_API_KEY for open-ended discovery; using the Wikidata dataset.' })
})
