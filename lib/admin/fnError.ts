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
      /* not a JSON body */
    }
  }
  return error instanceof Error ? error.message : fallback
}
