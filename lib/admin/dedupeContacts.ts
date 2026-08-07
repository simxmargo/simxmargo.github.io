import type { Contact } from '@/lib/types'

// One contact per company, for bulk queueing.
//
// A brand's contact page routinely yields several addresses — meandem.com produced 21,
// one per store location — and queueing all of them means pitching the same company
// twenty-one times. sendPitch already refuses the second send, but only after the rows
// are queued, so the admin sees "Queue 10" and gets a pile of 409s. This picks the one
// address worth writing to and reports the rest as skipped.

const TYPE_RANK: Record<string, number> = {
  partnerships: 0,
  press: 1,
  generic: 2,
  named: 3,
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Does the address look like it belongs to the site, rather than to a third party
 * whose address happened to be on the page (a font licence, an embedded app widget)?
 *
 * This ranks ONLY — the authoritative guard runs server-side in `_shared/hosts.ts`
 * before a contact is ever written. Kept deliberately small so the two cannot drift
 * in a way that matters: the worst case here is picking a slightly worse address.
 */
export function looksOwned(contact: Contact): boolean {
  const domain = (contact.email.split('@')[1] ?? '').toLowerCase()
  const site = (contact.website ?? '').toLowerCase().replace(/^www\./, '')
  if (!domain || !site) return false
  if (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`)) return true

  const siteLabel = squash(site.split('.')[0])
  const mailLabel = squash(domain.split('.')[0])
  const local = squash(contact.email.split('@')[0] ?? '')
  if (siteLabel.length < 4) return false
  if (local.length >= 4 && local.includes(siteLabel)) return true
  return mailLabel.length >= 4 && (siteLabel.includes(mailLabel) || mailLabel.includes(siteLabel))
}

/** Companies are keyed on the stored website, which discovery already normalized. */
function companyKey(c: Contact): string {
  return (c.website ?? '').toLowerCase().replace(/^www\./, '').trim() || `id:${c.id}`
}

/**
 * Lower sorts first. Ownership OUTRANKS the partnerships label deliberately: without
 * that, rankandstyle.com would pick `partnerships@dear-francis.com` — a stranger's
 * address that merely happens to say "partnerships".
 */
function rank(c: Contact): [number, number, string] {
  return [looksOwned(c) ? 0 : 1, TYPE_RANK[c.emailType] ?? 9, c.createdAt ?? '']
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
  const best = new Map<string, Contact>()
  for (const c of contacts) {
    const key = companyKey(c)
    const held = best.get(key)
    if (!held) {
      best.set(key, c)
      continue
    }
    const [a1, a2, a3] = rank(c)
    const [b1, b2, b3] = rank(held)
    if (a1 < b1 || (a1 === b1 && (a2 < b2 || (a2 === b2 && a3 < b3)))) best.set(key, c)
  }

  const winners = new Set([...best.values()].map((c) => c.id))
  return {
    picked: contacts.filter((c) => winners.has(c.id)),
    skipped: contacts.filter((c) => !winners.has(c.id)),
  }
}
