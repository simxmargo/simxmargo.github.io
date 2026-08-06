// `discover-brands` Edge Function — finds brands to pitch that nobody typed in.
//
// The picker was a hand-written list of 64 domains, so "Scrape new brands" had a hard
// floor: scrape them all and the button had nothing left. This replaces that with two
// sources, in order of preference:
//
//   1. BRAVE SEARCH (if BRAVE_API_KEY is set) — the live web. A cross product of
//      niches x framings gives ~108 distinct searches, each pageable, so the supply
//      only ends when the queries do. This is the "never runs out" path.
//   2. WIKIDATA (always available, no key) — an open dataset of ~1,100 apparel
//      companies that publish a website. Precise but finite.
//
// The fallback is deliberate: with no key the feature still works, exactly like
// `enrich`/`qualify` degrade without theirs. Nothing here is hardcoded brand data —
// the only fixed lists are EXCLUSIONS (marketplaces, publishers, social).
//
// Invoke: POST { "limit": 12 }   (admin-gated)
// Deploy: supabase functions deploy discover-brands --project-ref <ref> --use-api
// Secret: supabase secrets set BRAVE_API_KEY=...

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { normalizeDomain } from '../_shared/scrape.ts'
import { braveSearch, queryPool, type BrandCandidate } from '../_shared/braveSearch.ts'

const WIKIDATA = 'https://query.wikidata.org/sparql'
// Wikidata asks bots to identify themselves with a contact route. Do NOT replace this
// with a browser UA — that is exactly what their policy forbids.
const UA = 'brand-outreach-studio/1.0 (+https://simxmargo.github.io) brand-discovery'
const MAX_LIMIT = 200
// Each search yields ~12 usable brands after filtering, so this reaches a 100-brand
// batch. Still trivial against the free allowance: ~1,000 searches a month means ~80
// full runs, and in practice a run stops early because it hits the limit first.
const MAX_SEARCHES = 12

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
    candidates.push({ brand, website, country: r.cc?.value ?? '' })
  }

  const fresh = candidates.filter((c) => !known.has(c.website))
  return {
    candidates: fresh.slice(0, limit),
    pool: candidates.length,
    remaining: fresh.length,
    source: 'wikidata' as const,
  }
}

async function viaBrave(apiKey: string, known: Set<string>, limit: number) {
  const pool = queryPool()
  // Start somewhere random so consecutive runs explore different niches rather than
  // grinding the same first query and paging ever deeper into it.
  const start = Math.floor(Math.random() * pool.length)

  const fresh = new Map<string, BrandCandidate>()
  const used: string[] = []
  for (let i = 0; i < pool.length && fresh.size < limit && used.length < MAX_SEARCHES; i++) {
    const query = pool[(start + i) % pool.length]
    // Page deeper as we go: repeated runs then reach past the first page of results.
    const hits = await braveSearch(apiKey, query, i % 4)
    used.push(query)
    for (const h of hits) {
      if (fresh.size >= limit) break
      if (known.has(h.website) || fresh.has(h.website)) continue
      fresh.set(h.website, h)
    }
  }

  return {
    candidates: [...fresh.values()].slice(0, limit),
    // The live web has no countable pool; report the cost instead so the free credit
    // allowance is never a mystery.
    searches: used.length,
    queries: used,
    source: 'brave' as const,
  }
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
  const braveKey = Deno.env.get('BRAVE_API_KEY')

  if (braveKey) {
    const out = await viaBrave(braveKey, known, limit)
    // A key that returns nothing (quota spent, outage) must not leave the button dead —
    // fall through to the dataset rather than reporting failure.
    if (out.candidates.length > 0) return json(out)
    const fallback = await viaWikidata(known, limit)
    return json({ ...fallback, note: 'Brave returned nothing this run — used Wikidata instead.' })
  }

  const out = await viaWikidata(known, limit)
  if ('error' in out) return json({ ...out, candidates: [] }, 502)
  return json({ ...out, note: 'Set BRAVE_API_KEY for open-ended discovery; using the Wikidata dataset.' })
})
