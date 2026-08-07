// Client-side orchestration for the Contacts "Scrape new brands" flow.
//
// The static SPA holds no secrets and never scrapes. It only inserts scrape_jobs rows
// through the authenticated admin session (RLS = is_admin()) and then watches them:
//
//   discover-brands (Instagram)  →  insert scrape_jobs  →  pg_cron drains scrape-static
//                                                          (falls back to Brave search)
//
// Everything that costs an API key runs server-side in the Edge Functions.

import { supabaseBrowser } from '@/lib/supabase/browser'

export interface ScrapeInput {
  brand: string
  website: string // bare hostname (e.g. "nike.com")
  country: string
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

export interface QueuedJob {
  id: string
  brand: string
  website: string
}

/**
 * Insert the jobs and return — pg_cron drains them server-side.
 *
 * This is the path for a BIG batch. Driving 100 sites from the browser would be a
 * ~30 minute loop that dies the moment the tab closes, which is the opposite of
 * fire-and-forget. Queuing is two seconds; the crawl then happens whether or not
 * anyone is watching.
 */
export async function queueScrapeJobs(inputs: ScrapeInput[]): Promise<QueuedJob[]> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')
  if (inputs.length === 0) return []

  const { data, error } = await sb
    .from('scrape_jobs')
    .insert(inputs.map((i) => ({ brand: i.brand, website: i.website, country: i.country || '' })))
    .select('id, brand, website')
  if (error) throw new Error(error.message)
  return (data ?? []) as QueuedJob[]
}

export interface JobState {
  id: string
  status: string
  error: string | null
}

/** Current status of queued jobs, for the progress panel to poll. */
export async function readJobStates(ids: string[]): Promise<JobState[]> {
  const sb = supabaseBrowser
  if (!sb || ids.length === 0) return []
  const { data, error } = await sb.from('scrape_jobs').select('id, status, error').in('id', ids)
  if (error) throw new Error(error.message)
  return (data ?? []) as JobState[]
}

/**
 * How many contacts each of these domains has produced.
 *
 * scrape_jobs records the OUTCOME but not a count, and discovery already excluded
 * every domain we held, so any contact on one of these websites came from this run.
 */
export async function countFoundByWebsite(websites: string[]): Promise<Map<string, number>> {
  const sb = supabaseBrowser
  const out = new Map<string, number>()
  if (!sb || websites.length === 0) return out
  const { data } = await sb.from('contacts').select('website').in('website', websites)
  for (const r of (data ?? []) as { website: string }[]) {
    out.set(r.website, (out.get(r.website) ?? 0) + 1)
  }
  return out
}

