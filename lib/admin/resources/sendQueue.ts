import { supabaseBrowser } from '@/lib/supabase/browser'

// Browser-only data layer for the DURABLE send queue (send_queue, migration 0013).
//
// The queue used to be Zustand state that vanished on reload and could only "send"
// while the tab was open. It is now rows in Postgres, drained by pg_cron every minute
// — so queuing something and closing the laptop still sends it.
//
// The browser never triggers a send. It writes intent (a row, with a time) and reads
// outcomes. Only `drain-queue`, holding the service-role key, actually talks to Gmail.

/** Mirrors the CHECK constraint from 0001_init.sql. Note 'queued', not 'pending'. */
export type SendStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'canceled'

/** The grace period between queuing and sending — also the cancel window. */
export const SEND_DELAY_MINUTES = 5

export interface SendQueueRow {
  id: string
  contactId: string
  brand: string
  email: string
  subject: string
  body: string
  status: SendStatus
  scheduledFor: string
  sentAt: string | null
  attempts: number
  error: string
}

interface RawRow {
  id: string
  contact_id: string
  subject: string
  body: string
  status: SendStatus
  scheduled_for: string
  sent_at: string | null
  attempts: number
  error: string | null
  contacts: { brand: string | null; email: string | null } | null
}

function mapRow(r: RawRow): SendQueueRow {
  return {
    id: r.id,
    contactId: r.contact_id,
    brand: r.contacts?.brand ?? '—',
    email: r.contacts?.email ?? '',
    subject: r.subject,
    body: r.body,
    status: r.status,
    scheduledFor: r.scheduled_for,
    sentAt: r.sent_at,
    attempts: r.attempts ?? 0,
    error: r.error ?? '',
  }
}

const SELECT = 'id, contact_id, subject, body, status, scheduled_for, sent_at, attempts, error, contacts(brand, email)'

// Everything still live, plus recent history so "already sent" stays visible in the
// workspace instead of the row silently disappearing the moment it succeeds.
export async function readSendQueue(): Promise<SendQueueRow[]> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await sb
    .from('send_queue')
    .select(SELECT)
    .or(`status.in.(queued,sending,failed),created_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as RawRow[]).map(mapRow)
}

// When did this account send its FIRST real pitch? Anchor for the warm-up ramp
// display in Settings — mirrors effectiveDailyCap() in _shared/sendPitch.ts, which
// is the enforcing copy. Null before any send.
export async function readFirstSendAt(): Promise<string | null> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb
    .from('send_queue')
    .select('sent_at')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data?.sent_at ?? null
}

export interface QueueInput {
  contactId: string
  subject: string
  body: string
  /** Minutes from now. Defaults to the standard grace window. */
  delayMinutes?: number
}

// Writes the intent. The unique partial index (contact_id where status in
// queued/sending) is what actually prevents a double-queue — a disabled button is a
// hint, not a guarantee, and two tabs can both think they're first.
export async function queueForOutreach(input: QueueInput): Promise<SendQueueRow> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const delay = input.delayMinutes ?? SEND_DELAY_MINUTES
  const scheduledFor = new Date(Date.now() + delay * 60_000).toISOString()

  const { data, error } = await sb
    .from('send_queue')
    .insert({
      contact_id: input.contactId,
      subject: input.subject,
      body: input.body,
      scheduled_for: scheduledFor,
      status: 'queued',
    })
    .select(SELECT)
    .single()

  if (error) {
    // 23505 = the one-live-send-per-contact index. Say what it means, not the raw
    // constraint name. 23514 is trg_block_suppressed rejecting a suppressed address.
    if (error.code === '23505') throw new Error('That brand is already in the queue.')
    throw new Error(error.message)
  }

  // Reflect it on the contact so the Contacts list reads 'Queued' immediately.
  await sb.from('contacts').update({ status: 'queued' }).eq('id', input.contactId)

  return mapRow(data as unknown as RawRow)
}

// Cancel is only meaningful before the drain claims the row. Guarding on
// status='queued' makes this a no-op — rather than a lie — if the worker got there
// first, which is exactly the race a 5-minute window invites.
export async function cancelQueued(id: string, contactId: string): Promise<boolean> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb
    .from('send_queue')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'queued')
    .select('id')

  if (error) throw new Error(error.message)

  const canceled = (data ?? []).length > 0
  if (canceled) await sb.from('contacts').update({ status: 'new' }).eq('id', contactId)
  return canceled
}

// "Send now" — skip the remaining wait by pulling the schedule forward. The next cron
// tick picks it up, so this stays on the one code path that actually sends.
export async function sendQueuedNow(id: string): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { error } = await sb
    .from('send_queue')
    .update({ scheduled_for: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'queued')

  if (error) throw new Error(error.message)
}

// Retry a failed row, or deliberately send a brand a second time. A NEW row rather
// than resetting the old one: the history of what was sent when is worth keeping, and
// the unique index only covers live rows so this is legal once the first is terminal.
export async function requeue(row: SendQueueRow, delayMinutes = SEND_DELAY_MINUTES): Promise<SendQueueRow> {
  return await queueForOutreach({
    contactId: row.contactId,
    subject: row.subject,
    body: row.body,
    delayMinutes,
  })
}
