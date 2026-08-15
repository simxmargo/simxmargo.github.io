import type { Contact } from '@/lib/types'
import { scoreEmail } from '@/lib/outreach/pickEmail'

// One contact per company, for bulk queueing.
//
// THIS IS NOW A SAFETY NET, NOT THE MAIN EVENT. The scraper writes a single ranked row
// per company (see lib/outreach/pickEmail.ts), so a freshly scraped table has nothing
// here to collapse. What it still catches: rows scraped before that change, rows added
// by hand, and companies reachable at two different websites.
//
// It used to carry its OWN ownership test and its own type ranking — a second, subtly
// different definition of "best address" living twenty lines from the one the scraper
// used. Both now call the same scorer, so the address the table shows as best is the
// address the sender would have chosen.

/** Companies are keyed on the stored website, which discovery already normalized. */
function companyKey(c: Contact): string {
  return (c.website ?? '').toLowerCase().replace(/^www\./, '').trim() || `id:${c.id}`
}

/**
 * Score a stored row.
 *
 * Prefers the `confidence` the scraper computed with full provenance in hand — it knew
 * whether the address came from a `mailto:` href and how many pages carried it, and
 * none of that survives into the contacts row. Recomputing is the fallback for rows
 * written before scoring existed, and is necessarily blinder: `via: 'body'` is the
 * neutral assumption, so a recomputed score is a floor, never an inflation.
 */
function scoreOf(c: Contact): number {
  if (typeof c.confidence === 'number' && c.confidence > 0) return c.confidence
  return scoreEmail({ email: c.email, via: 'body' }, c.website ?? '', c.brand).score
}

export interface DedupeResult {
  /** One contact per company — what actually gets queued. */
  picked: Contact[]
  /** Rows set aside because a better address for the same company was kept. */
  skipped: Contact[]
}

/**
 * Collapse a selection to one contact per company.
 *
 * Order is preserved: `picked` follows the order the winners appeared in the input, so
 * the confirm dialog lists them the way the table did.
 */
export function oneContactPerCompany(contacts: Contact[]): DedupeResult {
  const best = new Map<string, { contact: Contact; score: number }>()
  for (const c of contacts) {
    const key = companyKey(c)
    const held = best.get(key)
    const score = scoreOf(c)
    if (!held) {
      best.set(key, { contact: c, score })
      continue
    }
    // Ties break on creation order, so repeated runs over the same table always queue
    // the same address rather than shuffling with Map iteration.
    const better =
      score > held.score ||
      (score === held.score && (c.createdAt ?? '') < (held.contact.createdAt ?? ''))
    if (better) best.set(key, { contact: c, score })
  }

  const winners = new Set([...best.values()].map((b) => b.contact.id))
  return {
    picked: contacts.filter((c) => winners.has(c.id)),
    skipped: contacts.filter((c) => !winners.has(c.id)),
  }
}
