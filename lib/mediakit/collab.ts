import { supabaseAnon } from '@/lib/supabase/anon'
import type { CollabInquiryInput } from '@/lib/mediakit-types'

// Public "Work with me" submission → the `collab` Edge Function, which records it in
// collab_inquiries and FILES it into the influencer's Gmail Inbox (users.messages.import
// — not a self-send, which Gmail files under All Mail where nobody sees it). Routed
// through the function so validation and IP hashing live in one place.
//
// `notify: true` asks for the Gmail filing; the page before this one sent `false`,
// which the function still honours so an old cached page never double-delivers.
//
// `filed` is what the form branches on: only a brief that reached the Inbox counts as
// delivered. Anything less (network, paused Supabase, account not reconnected yet)
// sends the brand to the mail-app composer instead, so no lead rests on the studio alone.

export interface CollabResult {
  /** The function answered ok — the inquiry is recorded somewhere server-side. */
  saved: boolean
  /** It landed in the influencer's Gmail Inbox. */
  filed: boolean
}

// Must stay above the server's FILE_DEADLINE_MS (10s, supabase/functions/collab) plus a
// cold start, or a brief the server did file shows the fallback and gets sent twice.
// Short enough that a hung request still reaches the composer while the brand waits.
const SUBMIT_TIMEOUT_MS = 20_000

export async function submitCollab(input: CollabInquiryInput): Promise<CollabResult> {
  const failed: CollabResult = { saved: false, filed: false }
  if (!supabaseAnon) return failed
  try {
    const { data, error } = await supabaseAnon.functions.invoke('collab', {
      body: {
        name: input.name,
        email: input.email,
        company: input.company ?? '',
        message: input.message,
        deliverables: input.deliverables ?? [],
        sourcePath: typeof window !== 'undefined' ? window.location.pathname : '/',
        notify: true,
      },
      timeout: SUBMIT_TIMEOUT_MS,
    })
    if (error) {
      console.error('[collab] submit failed:', error.message)
      return failed
    }
    const body = data as { ok?: boolean; filed?: boolean } | null
    const saved = body?.ok === true
    // A missing `filed` (an older deployed function) means "not delivered", never "yes".
    return { saved, filed: saved && body?.filed === true }
  } catch (err) {
    console.error('[collab] submit threw:', err instanceof Error ? err.message : err)
    return failed
  }
}
