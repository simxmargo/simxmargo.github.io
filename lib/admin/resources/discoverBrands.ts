import { supabaseBrowser } from '@/lib/supabase/browser'
import { fnErrorMessage } from '@/lib/admin/fnError'
import type { ScrapeInput } from '@/lib/admin/scrapeBrands'

// Client half of `discover-brands`. The function does the Wikidata query and the
// de-duplication against contacts + scrape_jobs; this only asks and unwraps.

export interface DiscoverResult {
  inputs: ScrapeInput[]
  /** Everything Wikidata knows about after cleaning — the ceiling. */
  pool: number
  /** How many of those we have never scraped. */
  remaining: number
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
      pool: typeof data?.pool === 'number' ? data.pool : 0,
      remaining: typeof data?.remaining === 'number' ? data.remaining : 0,
    }
  } catch (e) {
    throw new Error(await fnErrorMessage(e, 'Could not reach the brand directory.'))
  }
}
