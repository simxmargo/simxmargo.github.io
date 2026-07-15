import { supabaseAnon } from '@/lib/supabase/anon'
import type { CollabInquiryInput } from '@/lib/mediakit-types'

// Public "Work with me" submission → the `collab` Edge Function, which inserts into
// collab_inquiries (anon key, RLS-bound) AND emails the influencer via Resend.
// Routed through the function — rather than the previous direct browser insert — so
// the notification email, server-side validation and IP hashing all live in ONE
// place that a direct PostgREST caller can't skip. Returns true on success.
export async function submitCollab(input: CollabInquiryInput): Promise<boolean> {
  if (!supabaseAnon) return false
  const { data, error } = await supabaseAnon.functions.invoke('collab', {
    body: {
      name: input.name,
      email: input.email,
      company: input.company ?? '',
      message: input.message,
      deliverables: input.deliverables ?? [],
      sourcePath: typeof window !== 'undefined' ? window.location.pathname : '/',
    },
  })
  if (error) {
    console.error('[collab] submit failed:', error.message)
    return false
  }
  return (data as { ok?: boolean } | null)?.ok === true
}
