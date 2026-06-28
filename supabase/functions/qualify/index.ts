// `qualify` Edge Function — scores brand contacts that don't yet have a fit score.
//
// Reads the creator profile from app_settings, finds contacts with a null
// fit_score, scores each with the ported Anthropic logic, and writes the result
// back. Driven on-demand (from the UI "Scrape new brands" flow) or a slow pg_cron
// tick.
//
// Auth: admin-only (is_admin() gate) — it spends Anthropic credits + writes with the
// service-role key. The UI path carries the signed-in admin's JWT.
//
// Invoke:  POST {}   (scores the next batch of unscored contacts)
//
// Deploy:  supabase functions deploy qualify
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (absent → graceful no-op, so the post-scrape chain never hard-fails)
//
// Reuses the scoring logic ported from the brand-outreach Python CLI.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { scoreBrandFit, type ProfileInput } from '../_shared/qualify.ts'

const BATCH = 10 // score up to N per invocation (keeps within Edge limits + cost)

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const denied = await requireAdmin(req)
  if (denied) return denied

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceKey) return json({ error: 'Missing Supabase env' }, 500)
  // Scoring is optional — a missing key shouldn't fail the post-scrape chain. Degrade
  // gracefully (same shape as enrich), so the UI just shows "scoring unavailable".
  if (!apiKey) return json({ scored: 0, note: 'ANTHROPIC_API_KEY not set — skipping scoring' })

  // Service-role client bypasses RLS — Edge Functions only, never the browser.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

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

  if (error) return json({ error: error.message }, 500)

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

  return json({ scored, remaining_in_batch: (contacts?.length ?? 0) - scored, failures })
})
