// Client-side orchestration for the Contacts "Scrape new brands" flow.
//
// The static SPA holds no secrets and never scrapes; it only (1) inserts scrape_jobs
// rows through the authenticated admin session (RLS = is_admin()) and (2) triggers the
// Edge Functions, which do the I/O server-side with the service-role key:
//
//   insert scrape_jobs  →  scrape-static (per job)  →  enrich (Hunter)  →  qualify (AI)
//
// enrich/qualify are best-effort: without HUNTER_API_KEY / ANTHROPIC_API_KEY they
// degrade to a graceful no-op (a `note`), so a scrape still succeeds — you just get
// raw contacts without enrichment/fit scores until the keys are set. See
// docs/BACKEND_DESIGN.md §9–§10.

import { supabaseBrowser } from '@/lib/supabase/browser'
import { fnErrorMessage } from '@/lib/admin/fnError'

export interface ScrapeInput {
  brand: string
  website: string // bare hostname (e.g. "nike.com")
  country: string
}

export interface ScrapeJobResult {
  brand: string
  website: string
  found: number // brand-new contacts inserted
  status: string // 'done' | 'needs_browser' | 'error'
  error?: string
}

export interface ScrapeSummary {
  results: ScrapeJobResult[]
  totalFound: number
  enrichedAdded?: number
  enrichNote?: string
  scoredCount?: number
  scoreNote?: string
  warnings: string[] // soft failures (enrich/qualify unavailable) — never block the scrape
}

// nike.com → "Nike";  the-label.co → "The Label". Used when no brand name is given.
function brandFromHost(host: string): string {
  const label = host.replace(/^www\./, '').split('.')[0] ?? host
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

// Normalize any user input (URL, "www.x.com", bare domain) to a hostname, or '' if it
// can't possibly be a website. The Edge Function re-normalizes too, but validating here
// lets the UI reject junk lines before inserting a job.
function hostOf(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    return new URL(withScheme).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

// Parse the textarea: one brand per line, either a bare website ("we'll name it from the
// domain") or "Brand Name, website.com". Country is applied separately (one field for all)
// to avoid comma ambiguity. Returns valid inputs + the raw lines we couldn't parse.
export function parseBrandLines(text: string, country = ''): { inputs: ScrapeInput[]; invalid: string[] } {
  const inputs: ScrapeInput[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const comma = line.indexOf(',')
    const brandPart = comma >= 0 ? line.slice(0, comma).trim() : ''
    const sitePart = comma >= 0 ? line.slice(comma + 1).trim() : line

    const host = hostOf(sitePart)
    if (!host || !host.includes('.')) {
      invalid.push(line)
      continue
    }
    if (seen.has(host)) continue // de-dup within one submission
    seen.add(host)

    inputs.push({ brand: brandPart || brandFromHost(host), website: host, country: country.trim() })
  }

  return { inputs, invalid }
}

export async function scrapeBrands(inputs: ScrapeInput[]): Promise<ScrapeSummary> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')
  if (inputs.length === 0) throw new Error('Add at least one brand website.')

  // 1. Queue the jobs. RLS `is_admin()` gates this write; .select() returns the new ids.
  const { data: jobs, error } = await sb
    .from('scrape_jobs')
    .insert(inputs.map((i) => ({ brand: i.brand, website: i.website, country: i.country || '' })))
    .select('id, brand, website')
  if (error) throw new Error(error.message)

  // 2. Scrape each job. Sequential by design — the function is polite-rate-limited per
  //    domain, and one failed domain must not abort the rest.
  const results: ScrapeJobResult[] = []
  for (const job of jobs ?? []) {
    try {
      const { data, error: e } = await sb.functions.invoke('scrape-static', { body: { job_id: job.id } })
      if (e) throw e
      const r = Array.isArray(data?.results) ? data.results[0] : null
      results.push({
        brand: job.brand,
        website: job.website,
        found: typeof r?.found === 'number' ? r.found : 0,
        status: typeof r?.status === 'string' ? r.status : 'done',
        error: r?.error || undefined,
      })
    } catch (e) {
      results.push({
        brand: job.brand,
        website: job.website,
        found: 0,
        status: 'error',
        error: await fnErrorMessage(e, 'Scrape failed.'),
      })
    }
  }

  const warnings: string[] = []
  const summary: ScrapeSummary = {
    results,
    totalFound: results.reduce((a, r) => a + r.found, 0),
    warnings,
  }

  // 3. Enrich the freshly-scraped domains (Hunter). Best-effort.
  try {
    const { data, error: e } = await sb.functions.invoke('enrich', { body: {} })
    if (e) throw e
    summary.enrichedAdded = typeof data?.added === 'number' ? data.added : 0
    if (typeof data?.note === 'string') summary.enrichNote = data.note
  } catch (e) {
    warnings.push(await fnErrorMessage(e, 'Enrichment unavailable.'))
  }

  // 4. AI fit-score the new contacts. Best-effort.
  try {
    const { data, error: e } = await sb.functions.invoke('qualify', { body: {} })
    if (e) throw e
    summary.scoredCount = typeof data?.scored === 'number' ? data.scored : 0
    if (typeof data?.note === 'string') summary.scoreNote = data.note
  } catch (e) {
    warnings.push(await fnErrorMessage(e, 'Scoring unavailable.'))
  }

  return summary
}
