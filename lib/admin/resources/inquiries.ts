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
