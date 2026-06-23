// `qualify` Edge Function — scores brand contacts that don't yet have a fit score.
//
// Reads the creator profile from app_settings, finds contacts with a null
// fit_score, scores each with the ported Anthropic logic, and writes the result
// back. Driven on-demand (from the UI) or on a slow pg_cron tick. Not deployed
// yet — this is the real implementation, ready for when the backend is wired.
//
// Deploy:  supabase functions deploy qualify
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Reuses the scoring logic ported from the brand-outreach Python CLI.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { scoreBrandFit, type ProfileInput } from '../_shared/qualify.ts'

const BATCH = 10 // score up to N per invocation (keeps within Edge limits + cost)

Deno.serve(async () => {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!apiKey || !supabaseUrl || !serviceKey) {
    return Response.json({ error: 'Missing ANTHROPIC_API_KEY / Supabase env' }, { status: 500 })
  }

  // Service-role client bypasses RLS — Edge Functions only, never the browser.
  const supabase = createClient(supabaseUrl, serviceKey)

  // Creator profile drives the score.
  const { data: settings } = await supabase
    .from('app_settings')
    .select('profile')
    .eq('id', 1)
    .single()
  const profile = (settings?.profile ?? {}) as ProfileInput

  // Contacts that still need scoring.
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, brand, website, country, email_type')
    .is('fit_score', null)
    .limit(BATCH)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  let scored = 0
  const failures: { id: string; error: string }[] = []

  for (const c of contacts ?? []) {
    try {
      const { fitScore, reason } = await scoreBrandFit(
        { brand: c.brand, website: c.website, country: c.country, emailType: c.email_type },
        profile,
        apiKey,
      )
      await supabase.from('contacts').update({ fit_score: fitScore, fit_reason: reason }).eq('id', c.id)
      scored++
    } catch (err) {
      // Leave the row unscored so it's retried next tick.
      failures.push({ id: c.id, error: String(err) })
    }
  }

  return Response.json({ scored, remaining_in_batch: (contacts?.length ?? 0) - scored, failures })
})
