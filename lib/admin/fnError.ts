// Read the JSON `{ error }` body off a failed `supabase.functions.invoke(...)`.
//
// supabase-js surfaces a non-2xx Edge Function response as a FunctionsHttpError whose
// `.context` is the raw Response. Our functions answer with `{ error: "..." }` (see
// _shared/http.ts `json()`), so we clone + parse that to show the real reason instead
// of the generic "Edge Function returned a non-2xx status code".
export async function fnErrorMessage(error: unknown, fallback = 'Request failed.'): Promise<string> {
  const ctx = (error as { context?: unknown })?.context
  if (ctx instanceof Response) {
    try {
      const j = await ctx.clone().json()
      if (j && typeof j.error === 'string') return j.error
    } catch {
      /* not a JSON body — fall through to the status-based message below */
    }

    // NOT our body ⇒ the PLATFORM answered, not the function: a gateway timeout, a
    // worker killed at the wall clock, or a JWT rejected before the function booted.
    // Without this branch all three collapse into supabase-js's "Edge Function returned
    // a non-2xx status code", which is exactly how a 152s timeout in discover-brands
    // read on screen as "Nothing to scrape" for a day. Say which failure it was.
    if (ctx.status === 504 || ctx.status === 546) {
      return `${fallback} The function hit the 150s execution limit (HTTP ${ctx.status}) — try again, or reduce the batch size.`
    }
    if (ctx.status === 401 || ctx.status === 403) {
      return `${fallback} Not authorized (HTTP ${ctx.status}) — sign out and back in.`
    }
    return `${fallback} (HTTP ${ctx.status})`
  }
  return error instanceof Error ? error.message : fallback
}
