// Can this DOMAIN receive mail at all? The last dead-address gate before a send.
//
// `mailableReason()` (pickEmail.ts) answers "is this string a plausible address" from
// its shape alone — no network. This module answers the other half: does the domain
// actually publish mail infrastructure. A pitch to a syntactically perfect address on
// a domain with no MX is a guaranteed hard bounce, and hard bounces are the metric
// Gmail weighs most heavily when deciding whether a sender is a spammer.
//
// DNS-over-HTTPS rather than a resolver API because this runs everywhere the ranker
// runs: Deno Edge Functions, the Next bundle, and Node scripts. `fetch` +
// `AbortSignal.timeout` are the entire dependency surface. Results are cached by the
// caller in `domain_checks` (migration 0017) — every mailbox at a domain shares its
// MX records, so one lookup covers the company.
//
// THREE-VALUED on purpose: true (has MX / implicit-MX A record), false (domain
// definitely cannot receive mail), null (lookup failed — unknown). Only a definite
// FALSE should block a send; treating "my DNS query timed out" as "their mailbox is
// dead" would silently discard good leads on a flaky network.

interface DohAnswer {
  type: number
  data?: string
}

interface DohResponse {
  Status: number
  Answer?: DohAnswer[]
}

const DOH_TIMEOUT_MS = 4_000

// RCODE 3 = NXDOMAIN: the domain does not exist, which is as dead as it gets.
const NXDOMAIN = 3

const PROVIDERS = [
  (name: string, type: string) =>
    new Request(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`),
  (name: string, type: string) =>
    new Request(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
    }),
]

async function dohQuery(name: string, type: 'MX' | 'A'): Promise<DohResponse | null> {
  for (const build of PROVIDERS) {
    try {
      const res = await fetch(build(name, type), { signal: AbortSignal.timeout(DOH_TIMEOUT_MS) })
      if (!res.ok) continue
      const body = (await res.json()) as DohResponse
      if (typeof body?.Status === 'number') return body
    } catch {
      // Timeout / network / JSON — fall through to the next provider.
    }
  }
  return null
}

// The RR types we accept as proof of a mail path. 15 = MX; 1 = A (RFC 5321 §5.1:
// a domain with no MX but an address record is still deliverable — the "implicit
// MX" rule small brands on bare hosting rely on without knowing it).
const hasAnswerOfType = (r: DohResponse, rrType: number): boolean =>
  (r.Answer ?? []).some((a) => a.type === rrType)

// "Null MX" (RFC 7505): a single MX of "0 ." is the domain explicitly declaring it
// accepts NO mail. It counts as an answer, so it must be recognised or such domains
// would pass the check they specifically asked to fail.
const isNullMx = (r: DohResponse): boolean => {
  const mx = (r.Answer ?? []).filter((a) => a.type === 15)
  return mx.length === 1 && /^0 \.?$/.test((mx[0].data ?? '').trim())
}

export interface DeliverableResult {
  /** true = mail path exists · false = definitely dead · null = could not determine */
  deliverable: boolean | null
  detail: string
}

/**
 * Look up whether `domain` can receive mail. Network I/O — cache the result.
 */
export async function checkDomainDeliverable(domain: string): Promise<DeliverableResult> {
  const name = domain.trim().toLowerCase().replace(/\.$/, '')
  // DoH endpoints want ASCII (punycode) names. Non-ASCII brand domains are rare
  // enough that "unknown" beats shipping an IDNA encoder for them.
  if (!name || !/^[a-z0-9.-]+$/.test(name)) return { deliverable: null, detail: 'unresolvable name' }

  const mx = await dohQuery(name, 'MX')
  if (!mx) return { deliverable: null, detail: 'DNS lookup failed' }

  if (mx.Status === NXDOMAIN) return { deliverable: false, detail: 'domain does not exist' }
  if (isNullMx(mx)) return { deliverable: false, detail: 'domain declares it accepts no mail (null MX)' }
  if (hasAnswerOfType(mx, 15)) return { deliverable: true, detail: 'MX records present' }

  // No MX — fall back to the implicit-MX rule before declaring it dead.
  const a = await dohQuery(name, 'A')
  if (!a) return { deliverable: null, detail: 'DNS lookup failed' }
  if (a.Status === NXDOMAIN) return { deliverable: false, detail: 'domain does not exist' }
  if (hasAnswerOfType(a, 1)) return { deliverable: true, detail: 'no MX, but an A record (implicit MX)' }

  return { deliverable: false, detail: 'no MX and no address records' }
}

export const emailDomain = (email: string): string =>
  email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase()
