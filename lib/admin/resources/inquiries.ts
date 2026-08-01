import { supabaseBrowser } from '@/lib/supabase/browser'

// Browser-only data layer for inbound brand collab inquiries (collab_inquiries).
// This replicates the old app/api/admin/inquiries route handlers, but talks to
// Supabase directly through the authenticated admin session (supabaseBrowser).
//
// The route used the SERVICE-ROLE client because anon can't read this table. The
// authenticated admin reads through the table's `is_admin()` RLS SELECT policy, so
// a normal supabaseBrowser select works here — no service-role key in the browser.

// Mirrors the table's CHECK constraint. Used to whitelist status writes.
export const INQUIRY_STATUSES = ['new', 'read', 'replied', 'archived', 'spam'] as const
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]

// The camelCase shape InquiriesInbox reads. The component reads created_at by that
// name, so we emit both createdAt and created_at. Mirrors the route's mapInquiry.
export interface InquiryRow {
  id: string
  name: string
  email: string
  company: string
  budget: string
  message: string
  deliverables: string[]
  status: InquiryStatus
  createdAt: string
  created_at: string
}

// Map a snake_case collab_inquiries row → camelCase. Mirrors the route exactly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInquiry(r: any): InquiryRow {
  return {
    id: r.id,
    name: r.name ?? '',
    email: r.email ?? '',
    company: r.company ?? '',
    budget: r.budget ?? '',
    message: r.message ?? '',
    deliverables: Array.isArray(r.deliverables) ? r.deliverables : [],
    status: r.status as InquiryStatus,
    createdAt: r.created_at ?? '',
    created_at: r.created_at ?? '',
  }
}

// Replicates GET /api/admin/inquiries: list every row, newest first, mapped
// snake_case → camelCase. Reads via the admin's `is_admin()` RLS SELECT policy.
export async function readInquiries(): Promise<InquiryRow[]> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb
    .from('collab_inquiries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapInquiry)
}

// Replicates PATCH /api/admin/inquiries: only `status` is ever writable, and it's
// validated against the CHECK constraint before the write. Throws on error (RLS
// `is_admin()` gates the write).
export async function updateInquiry(id: string, patch: { status: InquiryStatus }): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  if (typeof id !== 'string' || id.length === 0) throw new Error('id is required')
  if (!INQUIRY_STATUSES.includes(patch.status)) {
    throw new Error(`status must be one of: ${INQUIRY_STATUSES.join(', ')}`)
  }

  const { error } = await sb
    .from('collab_inquiries')
    .update({ status: patch.status })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// Spam is NOT a plain status write — it also blocks the sender and sweeps every
// message they've already sent. That has to be one transaction: blocking someone but
// leaving their existing mail in the inbox is a half-done job the UI can't recover
// from. `set_inquiry_spam` (migration 0015) does all of it server-side and returns how
// many messages moved, so the toast can be specific.
//
// Passing false is the exact inverse: unblock the sender and restore what was swept.
export async function setInquirySpam(id: string, spam: boolean): Promise<number> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb.rpc('set_inquiry_spam', { p_id: id, p_spam: spam })
  if (error) throw new Error(error.message)
  return typeof data === 'number' ? data : 0
}

// Batch sibling of updateInquiry, for "Mark all read". One `in (...)` round trip
// instead of N sequential PATCHes — the inbox can hold dozens of unread rows, and
// firing dozens of requests would both crawl and make partial-failure rollback a
// mess. Same status whitelist; a no-op on an empty id list.
export async function updateInquiries(ids: string[], patch: { status: InquiryStatus }): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const clean = ids.filter((id) => typeof id === 'string' && id.length > 0)
  if (clean.length === 0) return

  if (!INQUIRY_STATUSES.includes(patch.status)) {
    throw new Error(`status must be one of: ${INQUIRY_STATUSES.join(', ')}`)
  }

  const { error } = await sb
    .from('collab_inquiries')
    .update({ status: patch.status })
    .in('id', clean)

  if (error) throw new Error(error.message)
}
