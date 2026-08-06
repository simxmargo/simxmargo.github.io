'use client'

import { create } from 'zustand'
import { BRAND_DIRECTORY, normalizeDomain } from '@/lib/brandDirectory'
import {
  countFoundByWebsite,
  parseBrandLines,
  queueScrapeJobs,
  readJobStates,
  type ScrapeInput,
} from '@/lib/admin/scrapeBrands'
import { discoverBrands } from '@/lib/admin/resources/discoverBrands'

// The state and the driver for a "Scrape new brands" run.
//
// This lives in a STORE rather than in OutreachPage, and the driver is a plain module
// function rather than a component handler, because the run has to outlive the view.
// Held in component state, switching to Settings mid-run unmounted the owner: the
// promises kept going but their results landed nowhere, so coming back showed an idle
// button and the work appeared to have vanished.
//
// HONEST LIMIT: "background" here means "keeps running while you use the rest of the
// studio". It does NOT survive closing the tab — the loop is driven from the browser,
// one Edge Function call per site. The scrape_jobs rows are already inserted though,
// so a future pg_cron drain (scrape-static accepts POST {} for exactly this) could
// finish an abandoned run without any change to this file.

// 100, not 12. The old cap existed because the browser drove the crawl one site at a
// time — 12 sites measured at ~218 seconds, so 100 would have been a half-hour loop
// that died with the tab. Now pg_cron drains the queue at 5 sites/minute, so the batch
// size costs nothing up front and the whole run survives being walked away from.
// Discovery is nowhere near the limit either: 100 brands takes ~8 Brave searches out
// of ~1,000 free per month.
export const SCRAPE_BATCH = 100

const POLL_MS = 5_000
// Watch for up to 90 minutes; 100 sites at 5/min is ~20. Past that the panel stops
// following, but the crawl keeps running server-side regardless.
const MAX_WATCH_MS = 90 * 60 * 1000
const TERMINAL = new Set(['done', 'needs_browser', 'error'])

export type ScrapeItemStatus = 'waiting' | 'scraping' | 'done' | 'needs_browser' | 'error'

export interface ScrapeRunItem {
  brand: string
  website: string
  status: ScrapeItemStatus
  found: number
  error?: string
}

interface ScrapeRunState {
  items: ScrapeRunItem[]
  phase: 'idle' | 'discovering' | 'scraping' | 'finishing' | 'done'
  notes: string[]
  totalFound: number
  startedAt: number | null
  dismiss: () => void
}

export const useScrapeRun = create<ScrapeRunState>((set) => ({
  items: [],
  phase: 'idle',
  notes: [],
  totalFound: 0,
  startedAt: null,
  dismiss: () => set({ items: [], phase: 'idle', notes: [], totalFound: 0, startedAt: null }),
}))

/** The next N directory brands that aren't already in contacts. */
export function nextBatch(existingDomains: Set<string>, size = SCRAPE_BATCH): ScrapeInput[] {
  return BRAND_DIRECTORY.filter((b) => !existingDomains.has(normalizeDomain(b.domain)))
    .slice(0, size)
    .flatMap((b) => parseBrandLines(`${b.name}, ${b.domain}`, b.country).inputs)
}

/** How many directory brands remain unscraped — drives the button's empty state. */
export function remainingInDirectory(existingDomains: Set<string>): number {
  return BRAND_DIRECTORY.filter((b) => !existingDomains.has(normalizeDomain(b.domain))).length
}

export function isRunning(): boolean {
  const p = useScrapeRun.getState().phase
  return p === 'discovering' || p === 'scraping' || p === 'finishing'
}

/**
 * The next batch to scrape: the curated directory FIRST, topped up from Wikidata.
 *
 * Curated-first is deliberate — those 64 were chosen because they fit this creator,
 * whereas discovery casts a much wider net and takes what it can get. Only once the
 * good list is exhausted do we reach for the long tail, which is exactly the point at
 * which the button used to go dead.
 */
export async function buildBatch(existingDomains: Set<string>): Promise<ScrapeInput[]> {
  const curated = nextBatch(existingDomains)
  if (curated.length >= SCRAPE_BATCH) return curated

  const { inputs } = await discoverBrands(SCRAPE_BATCH - curated.length)
  const have = new Set(curated.map((c) => c.website))
  return [...curated, ...inputs.filter((i) => !have.has(i.website))]
}

/**
 * Drive a run. Returns immediately-ish; progress arrives through the store.
 * `resolveInputs` runs INSIDE the run so "finding brands" is a visible phase rather
 * than a button that sits dead for a second and a half.
 * `onFinished` re-hydrates the contacts list once, at the end.
 */
export async function startScrapeRun(
  resolveInputs: () => Promise<ScrapeInput[]>,
  onFinished: () => void,
): Promise<void> {
  if (isRunning()) return

  useScrapeRun.setState({
    items: [],
    phase: 'discovering',
    notes: [],
    totalFound: 0,
    startedAt: Date.now(),
  })

  let inputs: ScrapeInput[]
  try {
    inputs = await resolveInputs()
  } catch (err) {
    useScrapeRun.setState({
      phase: 'done',
      notes: [err instanceof Error ? err.message : 'Could not find brands to scrape.'],
    })
    return
  }

  if (inputs.length === 0) {
    useScrapeRun.setState({
      phase: 'done',
      notes: ['No new brands to scrape — every candidate we know about has already been tried.'],
    })
    return
  }

  // Queue everything at once (~2s), then WATCH. The crawl itself is done by pg_cron
  // calling scrape-static, so closing this tab slows nothing down — it only stops the
  // progress readout. That is what makes a 100-site run fire-and-forget instead of a
  // half-hour babysitting job.
  let jobs
  try {
    jobs = await queueScrapeJobs(inputs)
  } catch (err) {
    useScrapeRun.setState({
      phase: 'done',
      notes: [err instanceof Error ? err.message : 'Could not queue the scrape.'],
    })
    return
  }

  useScrapeRun.setState({
    items: jobs.map((j) => ({ brand: j.brand, website: j.website, status: 'waiting', found: 0 })),
    phase: 'scraping',
  })
  onFinished()

  const ids = jobs.map((j) => j.id)
  const sites = jobs.map((j) => j.website)
  const startedAt = Date.now()
  let lastTotal = 0

  while (Date.now() - startedAt < MAX_WATCH_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS))

    let states, counts
    try {
      ;[states, counts] = await Promise.all([readJobStates(ids), countFoundByWebsite(sites)])
    } catch {
      continue // a dropped poll is not a failed run; the crawl carries on server-side
    }

    const byId = new Map(states.map((s) => [s.id, s]))
    useScrapeRun.setState((s) => ({
      items: s.items.map((it, i) => {
        const st = byId.get(ids[i])
        if (!st) return it
        return {
          ...it,
          // scrape_jobs calls it 'pending'; the panel calls it 'waiting'.
          status: (st.status === 'pending' ? 'waiting' : st.status) as ScrapeItemStatus,
          found: counts.get(it.website) ?? 0,
          error: st.error ?? undefined,
        }
      }),
    }))

    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    useScrapeRun.setState({ totalFound: total })
    // Re-hydrate only when something new actually landed, rather than every 5s.
    if (total !== lastTotal) {
      lastTotal = total
      onFinished()
    }

    const settled = states.filter((s) => TERMINAL.has(s.status)).length
    if (states.length > 0 && settled === states.length) break
  }

  const stillGoing = useScrapeRun.getState().items.some((i) => i.status === 'waiting' || i.status === 'scraping')
  useScrapeRun.setState((s) => ({
    phase: 'done',
    notes: stillGoing
      ? [...s.notes, 'Still scraping in the background — new contacts will keep appearing.']
      : s.notes,
  }))
  onFinished()
}
