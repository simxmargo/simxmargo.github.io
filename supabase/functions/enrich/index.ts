// `enrich` Edge Function — Hunter.io free-first contact discovery.
//
// Hunter's free plan includes API access (~25 domain searches/month, no card),
// capped at 10 emails/domain. We spend it carefully: a free credit check first,
// then one Domain Search per brand, harvesting role inboxes + named contacts with
// confidence scores. Everything is cached in `contacts` so re-runs cost zero.
//
// Invoke for specific domains:  POST { "domains": ["brand.com", ...] }
// Or auto-pick scraped brands:  POST {}   (done jobs not yet enriched)
//
// Deploy:  supabase functions deploy enrich
// Secret:  supabase secrets set HUNTER_API_KEY=...   (use "test-api-key" for dry runs)
//
// Design rationale: docs/BACKEND_DESIGN.md §4.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { classifyEmail, normalizeDomain, sleep } from '../_shared/scrape.ts'

const HUNTER = 'https://api.hunter.io/v2'
const DOMAIN_BATCH = 5 // domains per invocation
const MIN_SEARCHES_LEFT = 1 // stop before we hit zero credits

interface HunterEmail {
  value: string
  type?: 'generic' | 'personal'
  confidence?: number
  first_name?: string | null
  last_name?: string | null
  position?: string | null
}

interface Target {
  domain: string
  brand: string
  country: string
  website: string // original scrape_jobs.website, for stamping enriched_at
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const hunterKey = Deno.env.get('HUNTER_API_KEY')
  if (!url || !serviceKey) return json({ error: 'Missing Supabase env' }, 500)
  // Enrichment is optional — a missing key shouldn't error a cron tick. Degrade gracefully.
  if (!hunterKey) return json({ enriched: 0, note: 'HUNTER_API_KEY not set — skipping enrichment' })

  const supabase = createClient(url, serviceKey)

  // 1. Credit check is free (no quota cost). Bail early if we're low.
  let searchesLeft = Number.POSITIVE_INFINITY
  try {
    const acc = await fetch(`${HUNTER}/account?api_key=${hunterKey}`)
    if (acc.ok) {
      const a = await acc.json()
      const s = a?.data?.requests?.searches
      if (s && typeof s.available === 'number' && typeof s.used === 'number') {
        searchesLeft = s.available - s.used
      }
    }
  } catch {
    /* unknown credits — proceed cautiously, the per-domain loop still guards */
  }
  if (searchesLeft < MIN_SEARCHES_LEFT) {
    return json({ enriched: 0, note: `Hunter searches exhausted (${searchesLeft} left)` })
  }

  // 2. Decide which domains to search: an explicit list, else done-but-unenriched jobs.
  let bodyDomains: unknown
  try {
    bodyDomains = (await req.json())?.domains
  } catch {
    /* no body */
  }

  let targets: Target[]
  if (Array.isArray(bodyDomains) && bodyDomains.length) {
    targets = bodyDomains
      .map((d) => String(d))
      .map((d) => ({ domain: normalizeDomain(d), brand: d, country: '', website: d }))
      .filter((t) => t.domain)
  } else {
    const { data: jobs } = await supabase
      .from('scrape_jobs')
      .select('brand, website, country')
      .eq('status', 'done')
      .is('enriched_at', null)
      .limit(DOMAIN_BATCH)
    targets = (jobs ?? [])
      .map((j) => ({ domain: normalizeDomain(j.website), brand: j.brand, country: j.country ?? '', website: j.website }))
      .filter((t) => t.domain)
  }

  let added = 0
  let filled = 0
  let searched = 0
  const perDomain: Array<Record<string, unknown>> = []

  for (const { domain, brand, country, website } of targets.slice(0, DOMAIN_BATCH)) {
    if (searchesLeft < MIN_SEARCHES_LEFT) break
    try {
      const res = await fetch(`${HUNTER}/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${hunterKey}`)
      searched++
      searchesLeft--
      if (!res.ok) {
        perDomain.push({ domain, error: `HTTP ${res.status}` })
        continue
      }
      const body = await res.json()
      const emails: HunterEmail[] = body?.data?.emails ?? []

      const rows = emails
        .filter((e) => e?.value)
        .map((e) => {
          const email = e.value.toLowerCase()
          // Hunter knows person-vs-role better than a regex does; trust it for 'named'.
          const named = e.type === 'personal' && (e.first_name || e.last_name)
          return {
            brand,
            email,
            email_type: named ? 'named' : classifyEmail(email),
            country,
            website: `https://${domain}`,
            confidence: typeof e.confidence === 'number' ? e.confidence : null,
            source_url: `hunter:${domain}`,
            notes: e.position ? `Hunter: ${e.position}` : '',
            status: 'new',
          }
        })

      if (rows.length) {
        // Insert brand-new contacts without clobbering existing scored/contacted rows.
        const { data: inserted } = await supabase
          .from('contacts')
          .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
          .select('id')
        added += inserted?.length ?? 0

        // Enrich rows the scraper found earlier but couldn't score: fill confidence
        // only where it's still null, leaving status/notes/fit untouched.
        for (const row of rows) {
          if (row.confidence == null) continue
          const { data: updated } = await supabase
            .from('contacts')
            .update({ confidence: row.confidence })
            .eq('email', row.email)
            .is('confidence', null)
            .select('id')
          filled += updated?.length ?? 0
        }
      }
      perDomain.push({ domain, emails: rows.length })
    } catch (err) {
      perDomain.push({ domain, error: err instanceof Error ? err.message : String(err) })
    } finally {
      // Stamp the job so we never re-spend a credit on this domain (best-effort:
      // ad-hoc body domains may have no matching job, which is fine).
      await supabase.from('scrape_jobs').update({ enriched_at: new Date().toISOString() }).eq('website', website)
    }
    await sleep(300) // light courtesy spacing between API calls
  }

  return json({ searched, added, filled, credits_remaining: searchesLeft, per_domain: perDomain })
})
