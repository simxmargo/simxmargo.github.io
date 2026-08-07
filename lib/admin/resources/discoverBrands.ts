import { supabaseBrowser } from '@/lib/supabase/browser'
import { fnErrorMessage } from '@/lib/admin/fnError'
import type { ScrapeInput } from '@/lib/admin/scrapeBrands'

// Client half of `discover-brands`. The function searches Instagram, separates brands
// from creators, and de-duplicates against contacts + scrape_jobs; this only asks and
// unwraps.

export interface DiscoverResult {
  /** Brands that still need an address found for them. */
  inputs: ScrapeInput[]
  /** Contacts written straight from an Instagram bio — these skipped the queue entirely. */
  savedContacts: number
  /** Profiles screened to produce this batch. */
  screened: number
  /** Searches run — one ScrapeCreators credit each. */
  searches: number
  /** Set when discovery fell back to the Wikidata dataset. */
  note: string
}

export async function discoverBrands(limit: number): Promise<DiscoverResult> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  try {
    const { data, error } = await sb.functions.invoke('discover-brands', { body: { limit } })
    if (error) throw error
    const raw = Array.isArray(data?.candidates) ? data.candidates : []
    return {
      inputs: raw
        .filter((c: { brand?: string; website?: string }) => c?.brand && c?.website)
        .map((c: { brand: string; website: string; country?: string }) => ({
          brand: c.brand,
          website: c.website,
          country: c.country ?? '',
        })),
      savedContacts: typeof data?.savedContacts === 'number' ? data.savedContacts : 0,
      screened: typeof data?.screened === 'number' ? data.screened : 0,
      searches: typeof data?.searches === 'number' ? data.searches : 0,
      note: typeof data?.note === 'string' ? data.note : '',
    }
  } catch (e) {
    throw new Error(await fnErrorMessage(e, 'Could not reach brand discovery.'))
  }
}
