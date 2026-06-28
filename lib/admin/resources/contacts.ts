import { supabaseBrowser } from '@/lib/supabase/browser'
import type { Contact, ContactStatus } from '@/lib/types'

// Browser-only data layer for the outreach `contacts` table. Replicates
// app/api/admin/contacts 1:1, but talks to Supabase directly through the authenticated
// admin session (supabaseBrowser). The route used the SERVICE-ROLE client because
// contacts has NO anon RLS policy; the signed-in admin reads/writes through the table's
// `is_admin()` RLS policies, so a normal supabaseBrowser call works here — no
// service-role key, no x-admin-secret.
//
//   readContacts   → list all contacts (ranked by fit), camelCase.
//   updateContact  → update status and/or notes for one contact by id.

// The camelCase shape readContacts returns — identical to the route's mapContact
// output, which is structurally the shared Contact type the store/UI already consume.
export type ContactRow = Contact

// Mirrors the route's STATUSES whitelist (the contacts.status CHECK values).
const STATUSES = ['new', 'queued', 'sent', 'replied', 'bounced', 'skip'] as const

// Map a snake_case contacts row → camelCase. Mirrors the route's mapContact exactly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapContact(r: any): ContactRow {
  return {
    id: r.id,
    brand: r.brand,
    email: r.email,
    emailType: r.email_type,
    country: r.country ?? '',
    website: r.website ?? '',
    fitScore: r.fit_score ?? null,
    fitReason: r.fit_reason ?? '',
    status: r.status,
    notes: r.notes ?? '',
    lastEmailedAt: r.last_emailed_at ?? null,
    createdAt: r.created_at,
  }
}

// Replicates GET /api/admin/contacts: list every contact ranked by fit_score (nulls
// last), then newest first, mapped snake_case → camelCase. Throws on error (RLS gates).
export async function readContacts(): Promise<ContactRow[]> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb
    .from('contacts')
    .select('*')
    .order('fit_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapContact)
}

// Replicates PATCH /api/admin/contacts: only `status` (validated against the CHECK
// whitelist) and/or `notes` are writable. Throws on a bad id, an invalid value, an
// empty patch, or a write error (RLS `is_admin()` gates the write).
export async function updateContact(
  id: string,
  patch: { status?: ContactStatus; notes?: string | null },
): Promise<void> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('id (string) is required.')
  }

  const updates: Record<string, unknown> = {}
  if ('status' in patch) {
    const status = patch.status
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
      throw new Error(`status must be one of ${STATUSES.join(', ')}.`)
    }
    updates.status = status
  }
  if ('notes' in patch) {
    const notes = patch.notes
    if (notes !== null && typeof notes !== 'string') {
      throw new Error('notes must be a string or null.')
    }
    updates.notes = notes ?? ''
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No updatable fields provided (status, notes).')
  }

  const { error } = await sb.from('contacts').update(updates).eq('id', id)
  if (error) throw new Error(error.message)
}
