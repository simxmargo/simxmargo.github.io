// Tiny HTTP helpers shared by the Edge Functions.
//
// The studio UI triggers these functions via `supabase.functions.invoke(...)`
// from the browser, which fires a CORS preflight — so we answer OPTIONS and tag
// every response with permissive CORS headers. `json()` is just a typed wrapper
// over `Response.json` that always carries those headers.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Answer the browser's CORS preflight. Returns a ready Response for OPTIONS,
// otherwise null so the caller continues with real work.
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}
