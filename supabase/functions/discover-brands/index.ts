// `discover-brands` Edge Function — finds brands to pitch that nobody typed in.
//
// SOURCES, in order of preference:
//   1. INSTAGRAM via ScrapeCreators — the primary path. A brand's profile carries its
//      own site, its size, and often a contact address, so one credit returns ten
//      candidates already part-enriched.
//   2. BRAVE SEARCH — used when the credit balance is spent (402, or within the
//      MIN_CREDITS reserve). Unlimited-ish supply, but no bio address and no follower
//      count, so candidates arrive bare and go through the scraper.
//   3. WIKIDATA (no key) — an open dataset of ~1,100 apparel companies. Precise but
//      finite; the last resort so the button is never dead.
//
// Nothing here is hardcoded brand data — the only fixed lists are EXCLUSIONS.
//
// A candidate whose Instagram bio published an address needs no scraping at all, so it
// is written straight to `contacts` here and reported separately from the rest.
//
// Invoke: POST { "limit": 100, "budget_ms": 60000, "prefer_free": false }
// Deploy: supabase functions deploy discover-brands --project-ref <ref> --use-api
// Secret: supabase secrets set SCRAPECREATORS_API_KEY=...
//
// TWO CALLERS: the studio button (admin JWT) and `top-up-leads` (cron secret). The
// latter presents the SERVICE-ROLE key as its bearer purely to satisfy the platform's
// `verify_jwt` at the gateway — authorization is still the cron secret checked in the
// handler, so this function does NOT need --no-verify-jwt and keeps both checks.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { isCronCaller } from '../_shared/cronAuth.ts'
import { normalizeDomain } from '../_shared/scrape.ts'
import { isNotABrandName } from '../_shared/hosts.ts'
import { pickBestEmail } from '../../../lib/outreach/pickEmail.ts'
import {
  intentFirst,
  profileNiches,
  queryPool,
  searchProfiles,
  toCandidate,
  type BrandCandidate,
} from '../_shared/instagramSearch.ts'
import { braveDiscover, braveQueryPool } from '../_shared/braveSearch.ts'

const WIKIDATA = 'https://query.wikidata.org/sparql'
// Wikidata asks bots to identify themselves with a contact route. Do NOT replace this
// with a browser UA — that is exactly what their policy forbids.
const UA = 'brand-outreach-studio/1.0 (+https://simxmargo.github.io) brand-discovery'
const MAX_LIMIT = 200
// One search costs 1 credit and yields ~5 brands after filtering, so a 100-brand batch
// costs ~20. The cap keeps a single run from ever eating a large slice of the balance.
// This is the COST ceiling; the deadline below is what bounds the wall clock.
const MAX_SEARCHES = 30

// ── THE WALL CLOCK ──────────────────────────────────────────────────────────────
//
// Supabase kills an Edge Function at 150s. On 2026-08-09 18:24 a run spent 152,327ms
// searching Instagram and the studio received a 504 whose body is NOT our `{error}`
// JSON — so the UI could only render the generic "Edge Function returned a non-2xx
// status code" under a headline of "Nothing to scrape". The credits were fine; the
// clock was not.
//
// The cause was structural: `MAX_SEARCHES` bounds how many searches we run, but
// nothing bounded how LONG they take, and a ScrapeCreators profile search measured
// 10-20s apiece. 30 x 17s = 515s. An iteration cap cannot protect a wall clock when
// the per-iteration cost is set by somebody else's API.
//
// So the run is bounded by TIME now, and always answers with whatever it has.
const WALL_CLOCK_MS = 150_000
// Room to write the ready contacts, serialize, and absorb one in-flight search that
// started just before its deadline (worst case SC_TIMEOUT, 9s).
const SAFETY_MS = 25_000
const BUDGET_MS = WALL_CLOCK_MS - SAFETY_MS
// Instagram is the best source, so it gets the bulk — but it must leave the fallbacks
// enough time to be more than decoration.
const INSTAGRAM_SHARE = 0.6

// ScrapeCreators answers a search in 10-20s and has no published rate limit. Four in
// flight turns a 75s slice into ~20 searches instead of ~4. Kept deliberately low: the
// same key powers `pull-videos` and `fetch-post`, and getting it throttled would break
// the media kit, not just this run.
const SEARCH_CONCURRENCY = 4

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
// brands — "Dhaka Fashion Week" is not someone you pitch a Reel to. The rule moved to
// lib/outreach/hosts.ts so Instagram and Brave results are held to it too; they were
// not, and a magazine reaching the send queue costs one of 20 daily sends.
const MARKETPLACE = new Set([
  'amazon.com', 'ebay.com', 'etsy.com', 'aliexpress.com', 'walmart.com', 'target.com',
  'zalando.com', 'asos.com', 'shein.com', 'temu.com',
])

// PostgREST caps a single response at 1,000 rows, so `.select('website')` on a growing
// table silently returns a PREFIX. That failure mode is invisible and expensive: the
// dedupe set comes back short, discovery re-offers domains already tried, and a run
// spends its credits re-finding dead sites. Page explicitly instead.
const PAGE = 1000

async function allWebsites(supabase: SupabaseClient, table: string): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('website')
      .range(from, from + PAGE - 1)
    if (error || !data?.length) break
    out.push(...data.map((r) => (r as { website: string | null }).website ?? ''))
    if (data.length < PAGE) break
  }
  return out
}

async function loadKnownDomains(supabase: SupabaseClient): Promise<Set<string>> {
  // scrape_jobs matters as much as contacts: a domain that yielded no address still
  // shouldn't come back next run, or we'd re-offer the same dead sites forever.
  const [contacts, jobs] = await Promise.all([
    allWebsites(supabase, 'contacts'),
    allWebsites(supabase, 'scrape_jobs'),
  ])
  const known = new Set<string>()
  for (const website of [...contacts, ...jobs]) {
    const d = normalizeDomain(website)
    if (d) known.add(d)
  }
  return known
}

// Leave headroom rather than draining to zero: the same key powers `pull-videos` and
// `fetch-post` for the media kit, and a discovery run must not break those.
const MIN_CREDITS = 25

async function viaInstagram(
  apiKey: string,
  known: Set<string>,
  limit: number,
  deadline: number,
  extraNiches: string[],
) {
  const pool = queryPool(extraNiches)
  // Start somewhere random so consecutive runs explore different niches rather than
  // grinding the same first query every time.
  const start = Math.floor(Math.random() * pool.length)
  const queries = Array.from({ length: MAX_SEARCHES }, (_, i) => pool[(start + i) % pool.length])

  const fresh = new Map<string, BrandCandidate>()
  const used: string[] = []
  let screened = 0
  let outOfCredits = false
  let creditsRemaining: number | null = null
  let cursor = 0
  let stop = false

  // Workers share one cursor, so a slow search delays only itself rather than the whole
  // run. Every exit sets `stop` — a worker that finds the balance spent must not let
  // three siblings keep spending it.
  const worker = async (): Promise<void> => {
    while (!stop) {
      if (Date.now() >= deadline || fresh.size >= limit) {
        stop = true
        return
      }
      const i = cursor++
      if (i >= queries.length) return

      const outcome = await searchProfiles(apiKey, queries[i])

      if (outcome.outOfCredits) {
        outOfCredits = true
        stop = true
        return
      }
      if (outcome.creditsRemaining !== null) {
        creditsRemaining = outcome.creditsRemaining
        if (creditsRemaining <= MIN_CREDITS) {
          outOfCredits = true // treat "nearly out" as out, so the reserve survives
          stop = true
          return
        }
      }

      used.push(queries[i])
      screened += outcome.profiles.length
      for (const p of outcome.profiles) {
        if (fresh.size >= limit) break
        const c = toCandidate(p)
        if (!c) continue // a creator, an event, or no own site to pitch
        if (known.has(c.website) || fresh.has(c.website)) continue
        fresh.set(c.website, c)
      }
    }
  }

  await Promise.all(Array.from({ length: SEARCH_CONCURRENCY }, worker))

  // Brands whose bio announces an ambassador / UGC / gifting programme go to the front.
  // They are the point of the intent queries: a brand already recruiting creators has
  // both a budget and somebody whose job is reading pitches like ours.
  const candidates = intentFirst([...fresh.values()])

  return {
    candidates,
    // Instagram has no countable pool; report the cost so the credit balance is never
    // a mystery.
    searches: used.length,
    screened,
    queries: used,
    creditsRemaining,
    outOfCredits,
    timedOut: Date.now() >= deadline,
    wantsCreators: candidates.filter((c) => c.wantsCreators).length,
    source: 'instagram' as const,
  }
}

/** Brand discovery from the web index. The fallback when Instagram credits run out. */
async function viaBrave(apiKey: string, known: Set<string>, limit: number, deadline: number) {
  const pool = braveQueryPool()
  const start = Math.floor(Math.random() * pool.length)

  const fresh = new Map<string, BrandCandidate>()
  const used: string[] = []

  // Stays SEQUENTIAL: Brave's free plan is ~1 request/second and concurrency here buys
  // a 429, not speed. The deadline is what keeps it bounded.
  for (let i = 0; i < pool.length && fresh.size < limit && used.length < MAX_SEARCHES; i++) {
    if (Date.now() >= deadline) break
    if (i > 0) await new Promise((r) => setTimeout(r, 1100))
    const query = pool[(start + i) % pool.length]
    // Page deeper as we go so repeated runs reach past the first page of results.
    const hits = await braveDiscover(apiKey, query, i % 4)
    used.push(query)
    for (const h of hits) {
      if (fresh.size >= limit) break
      if (known.has(h.website) || fresh.has(h.website)) continue
      fresh.set(h.website, h)
    }
  }

  return {
    candidates: [...fresh.values()],
    searches: used.length,
    screened: 0,
    queries: used,
    timedOut: Date.now() >= deadline,
    source: 'brave' as const,
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
    if (isNotABrandName(brand)) continue
    const website = normalizeDomain(r.w?.value ?? '')
    if (!website || !website.includes('.') || website.split('.').length > 4) continue
    if (MARKETPLACE.has(website)) continue
    if (seen.has(website)) continue // one row per country: ASICS arrives 3x
    seen.add(website)
    candidates.push({
      brand,
      website,
      country: r.cc?.value ?? '',
      handle: '',
      followers: 0,
      email: '',
      wantsCreators: false, // a dataset row carries no bio to read intent from
    })
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
  // A bio address still goes through the ranker, for the GATE rather than the ranking:
  // one address cannot be ranked against anything, but it can be malformed, automated,
  // or somebody else's entirely. Bios link agencies and PR firms often enough that
  // storing whatever matched the email regex was never safe.
  const graded = candidates
    .filter((c) => c.email)
    .map((c) => ({
      candidate: c,
      pick: pickBestEmail([{ email: c.email, via: 'bio' as const }], c.website, c.brand),
    }))

  const ready = graded.filter((g) => g.pick.winner)
  // A rejected bio address is not a rejected BRAND — the site may still publish a good
  // one, so the candidate rejoins the scrape queue rather than being dropped.
  const rest = [
    ...candidates.filter((c) => !c.email),
    ...graded.filter((g) => !g.pick.winner).map((g) => ({ ...g.candidate, email: '' })),
  ]
  if (ready.length === 0) return { saved: 0, rest }

  const rows = ready.map(({ candidate: c, pick }) => ({
    brand: c.brand,
    email: pick.winner!.email,
    email_type: pick.winner!.type,
    country: c.country ?? '',
    website: c.website,
    source_url: c.handle ? `https://instagram.com/${c.handle}` : '',
    confidence: pick.winner!.score,
    alternates: [],
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

  // TWO callers now: the studio's button (admin JWT) and `top-up-leads` (cron secret,
  // relayed from its own scheduled tick). Both spend credits, so both are gated —
  // just against different credentials.
  if (!isCronCaller(req)) {
    const denied = await requireAdmin(req)
    if (denied) return denied
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Missing Supabase env' }, 500)
  const supabase = createClient(url, serviceKey)

  let limit = 12
  let budgetMs = BUDGET_MS
  let preferFree = false
  try {
    const body = await req.json()
    if (typeof body?.limit === 'number') limit = body.limit
    // The top-up calls this on a 10-minute cron and must return well inside its OWN
    // 150s ceiling, so it asks for a smaller slice of clock than the UI does.
    if (typeof body?.budget_ms === 'number') budgetMs = body.budget_ms
    // Past the daily free-source threshold the caller stops paying for Instagram.
    if (body?.prefer_free === true) preferFree = true
  } catch {
    /* empty body → default */
  }
  limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)))
  budgetMs = Math.max(20_000, Math.min(BUDGET_MS, Math.trunc(budgetMs)))

  // Every source is bounded against ONE clock started here, so no combination of slow
  // upstreams can add up past the platform's 150s kill.
  const startedAt = Date.now()
  const deadline = startedAt + budgetMs
  const igDeadline = startedAt + Math.round(budgetMs * INSTAGRAM_SHARE)
  const timeLeft = () => deadline - Date.now()

  const known = await loadKnownDomains(supabase)

  // Discovery follows the media kit. Retuning `niche` on the profile retunes what we go
  // looking for, with no redeploy — the alternative is a hardcoded list that drifts from
  // the portfolio it is supposed to match.
  const { data: profile } = await supabase.from('public_profile').select('niche').maybeSingle()
  const extraNiches = profileNiches((profile as { niche?: string } | null)?.niche ?? '')

  const scKey = Deno.env.get('SCRAPECREATORS_API_KEY')?.trim()
  const braveKey = Deno.env.get('BRAVE_API_KEY')?.trim()

  // Reply with the candidates that still need scraping, having first written the ones
  // whose address we already have.
  const reply = async (out: Record<string, unknown> & { candidates: BrandCandidate[] }, note = '') => {
    const { saved, rest, saveError } = await saveReadyContacts(supabase, out.candidates)
    return json({
      ...out,
      candidates: rest,
      savedContacts: saved,
      saveError,
      note: note || undefined,
      elapsedMs: Date.now() - startedAt,
    })
  }

  // Running short of time is NOT a server error — it is a smaller batch. Saying so in a
  // 200 keeps the studio's note visible; a 5xx here would surface as the opaque
  // "non-2xx status code" that hid the original timeout for a day.
  const ranOutOfTime = (
    out: Record<string, unknown> & { candidates: BrandCandidate[] },
    tried: string,
  ) =>
    reply(
      out,
      `Stopped at the ${Math.round(budgetMs / 1000)}s time budget after ${tried}. ` +
        `Instagram search is slow right now, so this batch is smaller than usual — run it again for more.`,
    )

  // 1. Instagram, while there are credits and time for it. `preferFree` skips it
  //    outright — the caller has already spent its metered allowance for the day and
  //    would rather have lower-yield candidates than none.
  if (scKey && !preferFree) {
    const out = await viaInstagram(scKey, known, limit, igDeadline, extraNiches)
    if (out.candidates.length > 0 && !out.outOfCredits) {
      return out.timedOut
        ? ranOutOfTime(out, `${out.searches} Instagram search${out.searches === 1 ? '' : 'es'}`)
        : reply(out)
    }

    // 2. Out of credits (or it found nothing) → the web index, with whatever is left.
    //    A source can only overshoot its deadline by ONE in-flight request, so Brave's
    //    cut-off is pulled back by its own worst case (10s timeout + the 1.1s pace gap).
    if (braveKey && timeLeft() > 12_000) {
      const brave = await viaBrave(braveKey, known, limit, deadline - 12_000)
      const why = out.outOfCredits
        ? `ScrapeCreators credits are spent${out.creditsRemaining !== null ? ` (${out.creditsRemaining} left, reserve is ${MIN_CREDITS})` : ''} — discovered via Brave search instead.`
        : 'Instagram search returned nothing this run — discovered via Brave search instead.'
      // Anything Instagram did manage to find before stopping still counts.
      if (out.candidates.length > 0) {
        const merged = [...out.candidates]
        const have = new Set(merged.map((c) => c.website))
        for (const c of brave.candidates) if (!have.has(c.website)) merged.push(c)
        return reply({ ...brave, candidates: merged.slice(0, limit) }, why)
      }
      if (brave.candidates.length > 0) return reply(brave, why)
    }

    // 3. Neither search source produced anything → the offline dataset. Wikidata's own
    //    timeout is 20s, so don't start it without room to finish.
    if (timeLeft() > 22_000) {
      const fallback = await viaWikidata(known, limit)
      if (!('error' in fallback)) {
        return reply(fallback, 'Both search sources came up empty — used the Wikidata dataset.')
      }
      if (out.candidates.length === 0) return json({ ...fallback, candidates: [] }, 502)
    }

    // Out of time with whatever we managed to gather. Answer, don't 504.
    return ranOutOfTime(out, `${out.searches} Instagram search${out.searches === 1 ? '' : 'es'}`)
  }

  if (braveKey) {
    const brave = await viaBrave(braveKey, known, limit, deadline)
    if (brave.candidates.length > 0) {
      return reply(brave, 'Set SCRAPECREATORS_API_KEY for Instagram discovery; used Brave search.')
    }
  }

  if (timeLeft() > 22_000) {
    const out = await viaWikidata(known, limit)
    if ('error' in out) return json({ ...out, candidates: [] }, 502)
    return reply(out, 'No search key configured; using the Wikidata dataset.')
  }
  return json({ candidates: [], savedContacts: 0, searches: 0, screened: 0, note: 'Ran out of time before any source answered.' })
})
