'use client'

import { create } from 'zustand'
import { BRAND_DIRECTORY, normalizeDomain } from '@/lib/brandDirectory'
import { parseBrandLines, scrapeBrands, type ScrapeInput } from '@/lib/admin/scrapeBrands'
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

export const SCRAPE_BATCH = 12

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

  useScrapeRun.setState({
    items: inputs.map((i) => ({ brand: i.brand, website: i.website, status: 'waiting', found: 0 })),
    phase: 'scraping',
  })

  const patch = (index: number, next: Partial<ScrapeRunItem>) =>
    useScrapeRun.setState((s) => ({
      items: s.items.map((it, i) => (i === index ? { ...it, ...next } : it)),
    }))

  try {
    const summary = await scrapeBrands(inputs, (e) => {
      if (e.type === 'job-start') patch(e.index, { status: 'scraping' })
      else if (e.type === 'job-done')
        patch(e.index, {
          status: (e.result.status as ScrapeItemStatus) ?? 'done',
          found: e.result.found,
          error: e.result.error,
        })
      else if (e.type === 'phase') useScrapeRun.setState({ phase: 'finishing' })
    })

    const notes = [...summary.warnings]
    if (summary.enrichNote) notes.push(`Enrichment: ${summary.enrichNote}`)
    if (summary.scoreNote) notes.push(`Scoring: ${summary.scoreNote}`)
    useScrapeRun.setState({ phase: 'done', totalFound: summary.totalFound, notes })
  } catch (err) {
    useScrapeRun.setState((s) => ({
      phase: 'done',
      notes: [...s.notes, err instanceof Error ? err.message : 'Scrape failed.'],
    }))
  } finally {
    onFinished()
  }
}
