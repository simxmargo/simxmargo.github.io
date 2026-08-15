// Bounce detection: read the mailer-daemon's verdicts and act on them.
//
// A Gmail hard bounce is not an API error — users.messages.send returns 200 and the
// failure arrives MINUTES LATER as an ordinary inbox message from
// mailer-daemon@googlemail.com. Send-only scope cannot see it, which is why the
// account must be (re)connected with gmail.readonly before this module does anything.
// The caller (drain-queue) gates on the granted scope string and runs this once per
// day, inside the send window.
//
// WHY IT MATTERS THIS MUCH: bounce rate is the strongest signal Gmail uses to
// classify a sender as a spammer. One bounce is noise; a morning where 3 pitches
// bounce means the address book is bad, and continuing to send is how accounts get
// suspended. Detection feeds three places: the contact row (status='bounced', which
// unique(email) then makes un-re-addable), the suppression_list (blocks re-queueing
// at the DB trigger), and the kill switch evaluated by the caller.
//
// FALSE-POSITIVE GUARD: an address only counts as bounced if it belongs to a contact
// WE actually emailed (last_emailed_at is set). DSNs quote all sorts of addresses —
// the sender's own, postmaster@, the relay's — and suppressing one of those would be
// wrong forever.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { getMessage, listMessageIds } from './gmail.ts'

const DSN_QUERY = 'from:(mailer-daemon OR postmaster) newer_than:3d'
const MAX_DSNS_PER_SWEEP = 20

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/gi

// The DSN's machine-readable field, present in RFC 3464 reports:
//   Final-Recipient: rfc822; press@deadbrand.com
const FINAL_RECIPIENT_RE = /final-recipient:\s*rfc822;\s*<?([^\s>;]+@[^\s>;]+)/gi

function candidateAddresses(headers: Record<string, string>, text: string): Set<string> {
  const found = new Set<string>()
  // 1. Gmail's own header on its bounce messages — the most reliable source.
  for (const m of (headers['x-failed-recipients'] ?? '').matchAll(EMAIL_RE)) {
    found.add(m[0].toLowerCase())
  }
  // 2. The structured delivery-status field.
  for (const m of text.matchAll(FINAL_RECIPIENT_RE)) found.add(m[1].toLowerCase())
  // 3. Any address mentioned in the report body — safe because of the
  //    contacts-we-emailed intersection below.
  for (const m of text.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase())
  return found
}

export interface BounceSweepResult {
  scanned: number
  /** Addresses newly confirmed bounced this sweep (already-bounced rows excluded). */
  bounced: string[]
}

export async function sweepBounces(
  svc: SupabaseClient,
  accessToken: string,
  ownAddress: string,
): Promise<BounceSweepResult> {
  const ids = await listMessageIds(accessToken, DSN_QUERY, MAX_DSNS_PER_SWEEP)
  if (ids.length === 0) return { scanned: 0, bounced: [] }

  const candidates = new Set<string>()
  for (const id of ids) {
    try {
      const msg = await getMessage(accessToken, id)
      for (const a of candidateAddresses(msg.headers, msg.text)) candidates.add(a)
    } catch {
      // One unreadable DSN must not abort the sweep — the rest still count.
    }
  }
  candidates.delete(ownAddress.toLowerCase())
  if (candidates.size === 0) return { scanned: ids.length, bounced: [] }

  // Only contacts we genuinely wrote to, and only ones not already marked — so the
  // caller's kill-switch math counts each dead address exactly once.
  const { data: hit } = await svc
    .from('contacts')
    .select('id, email, status')
    .in('email', [...candidates])
    .not('last_emailed_at', 'is', null)

  const fresh = (hit ?? []).filter((c) => c.status !== 'bounced')
  if (fresh.length === 0) return { scanned: ids.length, bounced: [] }

  const now = new Date().toISOString()
  const emails = fresh.map((c) => c.email)
  const contactIds = fresh.map((c) => c.id)

  await svc.from('contacts').update({ status: 'bounced' }).in('id', contactIds)

  // on-conflict-ignore: re-suppressing is a no-op, never an error.
  await svc
    .from('suppression_list')
    .upsert(
      emails.map((email) => ({ email, reason: 'bounce' })),
      { onConflict: 'email', ignoreDuplicates: true },
    )

  // A bounced contact can still have a live queue row (e.g. a requeue) — cancel it;
  // the trigger only guards INSERTs, not rows that predate the suppression.
  await svc
    .from('send_queue')
    .update({ status: 'canceled', error: 'Recipient bounced — suppressed.', updated_at: now })
    .in('contact_id', contactIds)
    .in('status', ['queued', 'sending'])

  return { scanned: ids.length, bounced: emails }
}
