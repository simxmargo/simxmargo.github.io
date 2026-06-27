import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin, getAdminReadClient } from '@/lib/supabase/admin'

// Admin API for outreach `contacts`. The Outreach store used the anon client, but
// contacts has NO anon RLS policy (authenticated-only), so those reads/writes were
// silently blocked — this service-role route is the real path.
//
//  GET   → list all contacts (ranked by fit), camelCase.
//  PATCH → update status and/or notes for one contact by id.
//
// requireAdmin gates every method.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['new', 'queued', 'sent', 'replied', 'bounced', 'skip']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapContact(r: any) {
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

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  // Reads prefer service-role; if the key is unset, the anon fallback can't see
  // contacts (RLS) and returns [], so the UI shows an honest empty list.
  const sb = getAdminReadClient()
  const { data, error } = await sb
    .from('contacts')
    .select('*')
    .order('fit_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json((data ?? []).map(mapContact))
}

export async function PATCH(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  let b: Record<string, unknown>
  try {
    b = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const id = b.id
  if (typeof id !== 'string' || id.trim() === '') {
    return Response.json({ error: 'id (string) is required.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if ('status' in b) {
    if (typeof b.status !== 'string' || !STATUSES.includes(b.status)) {
      return Response.json({ error: `status must be one of ${STATUSES.join(', ')}.` }, { status: 400 })
    }
    updates.status = b.status
  }
  if ('notes' in b) {
    if (b.notes !== null && typeof b.notes !== 'string') {
      return Response.json({ error: 'notes must be a string or null.' }, { status: 400 })
    }
    updates.notes = b.notes ?? ''
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No updatable fields provided (status, notes).' }, { status: 400 })
  }

  const { data, error } = await sb.from('contacts').update(updates).eq('id', id).select('*').maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: data ? mapContact(data) : null })
}
