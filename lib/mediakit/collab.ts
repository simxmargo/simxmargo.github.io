import { supabaseAnon } from '@/lib/supabase/anon'
import type { CollabInquiryInput } from '@/lib/mediakit-types'

// Public "Work with me" submission → the `collab` Edge Function, which inserts
// into collab_inquiries (anon key, RLS-bound). Routed through the function —
// rather than a direct browser insert — so server-side validation and IP hashing
// live in ONE place a direct PostgREST caller can't skip.
//
// `notify: false` suppresses the function's own notification email: the visitor
// now sends the brief from their OWN client (see lib/mediakit/compose), so a
// server-sent copy would be a duplicate — and a self-addressed one at that, which
// Gmail files outside the Inbox. The function still forces the email through if
// this insert fails, so a lead is never lost to a silent DB error.
//
// Returns true when the record landed. Callers treat this as best-effort: the
// composed email is the channel that matters.
export async function submitCollab(input: CollabInquiryInput): Promise<boolean> {
  if (!supabaseAnon) return false
  try {
    const { data, error } = await supabaseAnon.functions.invoke('collab', {
      body: {
        name: input.name,
        email: input.email,
        company: input.company ?? '',
        message: input.message,
        deliverables: input.deliverables ?? [],
        sourcePath: typeof window !== 'undefined' ? window.location.pathname : '/',
        notify: false,
      },
    })
    if (error) {
      console.error('[collab] submit failed:', error.message)
      return false
    }
    return (data as { ok?: boolean } | null)?.ok === true
  } catch (err) {
    // Network failure / paused project. Logged, not thrown — this runs
    // fire-and-forget, so an unhandled rejection would be the only symptom.
    console.error('[collab] submit threw:', err instanceof Error ? err.message : err)
    return false
  }
}
