import { supabaseAnon } from '@/lib/supabase/anon'
import type { CollabInquiryInput } from '@/lib/mediakit-types'

// Public "Work with me" submission → collab_inquiries, inserted DIRECTLY from the
// browser via the session-less anon client. The RLS policy "anon insert" allows it
// only when status='new' and the message is non-empty (mirrored by the client-side
// validation + honeypot in RateAndContact). This removes the need for any server
// route or Edge Function — the whole site is static.
//
// Trade-off vs the old /api/collab: no server-side IP hash. RLS + the DB CHECKs +
// the honeypot remain the protection. Returns true on success.
export async function submitCollab(input: CollabInquiryInput): Promise<boolean> {
  if (!supabaseAnon) return false
  const { error } = await supabaseAnon.from('collab_inquiries').insert({
    name: input.name,
    email: input.email,
    company: input.company ?? '',
    message: input.message,
    deliverables: input.deliverables ?? [],
    source_path: typeof window !== 'undefined' ? window.location.pathname : '/',
    status: 'new',
  })
  if (error) {
    console.error('[collab] insert failed:', error.message)
    return false
  }
  return true
}
