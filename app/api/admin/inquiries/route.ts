import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

// Admin inbox for inbound brand collab inquiries (collab_inquiries).
// anon CANNOT read this table, so BOTH methods use the service-role client
// directly (no anon fallback). GET degrades gracefully to an empty+note state
// when the service-role key is missing so the inbox renders instead of erroring.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mirrors the table's CHECK constraint. Used to whitelist PATCH input.
const ALLOWED_STATUS = ['new', 'read', 'replied', 'archived', 'spam'] as const
type InquiryStatus = (typeof ALLOWED_STATUS)[number]

// Map a snake_case collab_inquiries row → camelCase. InquiriesInbox keeps the
// { data: [...] } envelope but reads camelCase fields (and created_at by that
// name), so we emit both createdAt and created_at to satisfy the editor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInquiry(r: any) {
  return {
    id: r.id,
    name: r.name ?? '',
    email: r.email ?? '',
    company: r.company ?? '',
    budget: r.budget ?? '',
    message: r.message ?? '',
    deliverables: Array.isArray(r.deliverables) ? r.deliverables : [],
    status: r.status,
    createdAt: r.created_at ?? '',
    created_at: r.created_at ?? '',
  }
}

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  // anon can't read collab_inquiries — so unlike most reads we do NOT use the
  // anon fallback. If the service-role key is unset, return an empty inbox with
  // a note (200) rather than a 503/500, so the UI shows an empty+note state.
  let sb
  try {
    sb = getSupabaseAdmin()
  } catch {
    return Response.json({ data: [], note: 'service-role key required' })
  }

  const { data, error } = await sb
    .from('collab_inquiries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  // InquiriesInbox expects the { data: [...] } envelope, with camelCase rows.
  return Response.json({ data: (data ?? []).map(mapInquiry) })
}

export async function PATCH(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  // Writes always require the real service-role client (no anon fallback).
  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id, status } = (body ?? {}) as { id?: unknown; status?: unknown }

  if (typeof id !== 'string' || id.length === 0) {
    return Response.json({ error: 'id is required' }, { status: 400 })
  }
  if (typeof status !== 'string' || !ALLOWED_STATUS.includes(status as InquiryStatus)) {
    return Response.json(
      { error: `status must be one of: ${ALLOWED_STATUS.join(', ')}` },
      { status: 400 },
    )
  }

  // Explicit field mapping — only `status` is ever writable here.
  const { data, error } = await sb
    .from('collab_inquiries')
    .update({ status })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Inquiry not found' }, { status: 404 })
  return Response.json({ data })
}
