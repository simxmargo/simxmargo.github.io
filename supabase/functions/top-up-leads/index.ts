// `top-up-leads` Edge Function — keeps tomorrow morning's send window supplied.
//
// THE PROBLEM IT SOLVES
//   `discover-brands` is admin-gated and only ever fired from the studio's "Scrape new
//   brands" button. The one automated job touching the funnel, `drain-scrape-jobs`,
//   drains a queue it never fills. So the sender could only mail what a human had
//   happened to scrape recently: on 2026-08-17 that meant 9 pitches against a cap of
//   15, with the pool exhausted and the next morning heading for zero.
//
// ── WHY THIS IS A CRON TICK AND NOT A LOOP ──────────────────────────────────────
//   "Scrape until the cap is filled, then send" cannot run inside one invocation —
//   Supabase kills a function at 150s and `discover-brands` alone can spend 125s of
//   that. So the loop IS the schedule: every 10 minutes from 04:00-07:59 PH this runs
//   once, does a BOUNDED slice of work, and either exits satisfied or leaves the rest
//   for the next tick. 24 ticks before the window opens is far more than it needs.
//
// ── THE ONE GATE THAT MATTERS ───────────────────────────────────────────────────
//   Step 3 refuses to discover anything while scrape jobs are still in flight. Without
//   it every tick sees the same unfilled deficit and queues another full batch — ten
//   ticks would discover ten times the target and empty the ScrapeCreators balance in
//   a morning. A deficit is only ACTIONABLE once the pipe it feeds is empty.
//
// Auth: cron only. No admin branch — there is no UI for this, and a human wanting
// leads has the button.
//
// Deploy (no JWT verification — the cron caller has no JWT):
//   ./node_modules/.bin/supabase functions deploy top-up-leads \
//     --project-ref zzgypushqcpchfxrjexc --use-api --no-verify-jwt

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { isCronCaller } from '../_shared/cronAuth.ts'
import { effectiveDailyCap, loadSendSettings } from '../_shared/sendPitch.ts'

// Brands to discover per qualified lead we actually need. Measured on the 14-15 Aug
// cohort: 15 discovered → 13 scraped clean → 6 cleared confidence 55. That is 2.5;
// the all-time rate is worse (107 of 195 jobs died), so plan at 3 and let the
// satisfied-check stop early rather than under-order and miss a morning.
const YIELD_FACTOR = 3

// Ceiling on one tick's discovery. Bounds both the credit spend and the time
// `discover-brands` can take, and the next tick is only 10 minutes away.
const DISCOVER_PER_TICK = 40

// The slice of clock handed to discovery. Its own worst case is one in-flight search
// (~9s) past the deadline, so 60s + overhead sits comfortably inside our 150s.
const DISCOVERY_BUDGET_MS = 60_000

const PH_OFFSET_MS = 8 * 60 * 60 * 1000

/** UTC instant of midnight, PH time — the anchor for "queued today". */
function phDayStartIso(): string {
  const ph = new Date(Date.now() + PH_OFFSET_MS)
  return new Date(
    Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate()) - PH_OFFSET_MS,
  ).toISOString()
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

interface TopUpSettings {
  topupEnabled: boolean
  leadTargetBuffer: number
  discoveryDailyBudget: number
  discoveryPreferFreeAfter: number
}

// Read with `select *` and defaulted field by field, so the function keeps working
// against a database that has not applied 0018 yet — same contract as loadSendSettings.
async function loadTopUpSettings(svc: SupabaseClient): Promise<TopUpSettings> {
  const { data } = await svc.from('app_settings').select('*').eq('id', 1).maybeSingle()
  const s = (data ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d
  return {
    topupEnabled: typeof s.topup_enabled === 'boolean' ? s.topup_enabled : true,
    leadTargetBuffer: num(s.lead_target_buffer, 1.3),
    discoveryDailyBudget: num(s.discovery_daily_budget, 80),
    discoveryPreferFreeAfter: num(s.discovery_prefer_free_after, 40),
  }
}

interface Candidate {
  brand?: string
  website?: string
  country?: string
}

// Call `discover-brands` over HTTP rather than importing it: it is a separate
// deployment with its own wall clock, and a crash in a slow upstream should cost this
// tick a fetch, not the whole invocation.
//
// The service-role key rides along as the bearer ONLY to satisfy the platform's
// verify_jwt at the gateway — `discover-brands` authorizes on the cron secret.
async function callDiscovery(
  limit: number,
  preferFree: boolean,
): Promise<{ candidates: Candidate[]; savedContacts: number; note?: string; error?: string }> {
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const res = await fetch(`${base}/functions/v1/discover-brands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
      'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '',
    },
    body: JSON.stringify({ limit, budget_ms: DISCOVERY_BUDGET_MS, prefer_free: preferFree }),
    // Discovery answers by its own budget; this only guards against a hung socket.
    signal: AbortSignal.timeout(DISCOVERY_BUDGET_MS + 25_000),
  })

  const text = await res.text()
  if (!res.ok) return { candidates: [], savedContacts: 0, error: `discover-brands ${res.status}: ${text.slice(0, 200)}` }
  try {
    const body = JSON.parse(text)
    return {
      candidates: Array.isArray(body?.candidates) ? body.candidates : [],
      savedContacts: typeof body?.savedContacts === 'number' ? body.savedContacts : 0,
      note: typeof body?.note === 'string' ? body.note : undefined,
    }
  } catch {
    return { candidates: [], savedContacts: 0, error: 'discover-brands returned unparseable JSON.' }
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!isCronCaller(req)) return json({ error: 'Not authorized.' }, 401)

  const svc = serviceClient()
  const [sendSettings, topUp] = await Promise.all([loadSendSettings(svc), loadTopUpSettings(svc)])

  if (!topUp.topupEnabled) return json({ ok: true, skipped: 'disabled' })

  // Stocking the shelves of a shop that is closed spends credits for nothing. When the
  // kill switch is on, something is wrong with the account — fix that first.
  if (sendSettings.sendingPaused) {
    return json({ ok: true, skipped: 'sending_paused', reason: sendSettings.pausedReason })
  }

  // 1. How many qualified leads should be waiting when the window opens?
  //    The buffer covers the attrition BETWEEN counting and sending: an MX check that
  //    fails, an address that turns out to share a company with someone already mailed.
  const cap = await effectiveDailyCap(svc, sendSettings)
  const target = Math.ceil(cap * topUp.leadTargetBuffer)

  const { count: poolCount } = await svc
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new')
    .gte('confidence', sendSettings.autoQueueMinConfidence)

  const pool = poolCount ?? 0
  const deficit = target - pool
  if (deficit <= 0) return json({ ok: true, skipped: 'satisfied', pool, target })

  // 2. Rescue anything a dead worker stranded, so the in-flight count below is honest
  //    rather than inflated by rows nobody is actually working on.
  await svc.rpc('requeue_stuck_scrapes')

  // 3. THE GATE. Never order more while the kitchen is still cooking.
  const { count: inflight } = await svc
    .from('scrape_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'scraping', 'retry'])

  if ((inflight ?? 0) > 0) {
    return json({ ok: true, skipped: 'draining', inflight, pool, target })
  }

  // 4. The daily cost ceiling. Counted as jobs QUEUED today rather than a separate
  //    ledger — the row already exists, and a counter that can drift from the thing it
  //    counts is a bug waiting to happen.
  const { count: queuedToday } = await svc
    .from('scrape_jobs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', phDayStartIso())

  const spent = queuedToday ?? 0
  const remaining = topUp.discoveryDailyBudget - spent
  if (remaining <= 0) {
    return json({ ok: true, skipped: 'budget_spent', spent, budget: topUp.discoveryDailyBudget, pool, target })
  }

  // 5. Discover a bounded slice.
  const want = Math.max(1, Math.min(deficit * YIELD_FACTOR, DISCOVER_PER_TICK, remaining))
  const preferFree = spent >= topUp.discoveryPreferFreeAfter
  const found = await callDiscovery(want, preferFree)
  if (found.error) return json({ ok: false, stage: 'discovery', error: found.error, pool, target }, 502)

  // Candidates whose address was already in the Instagram bio are written to `contacts`
  // by discovery itself; only the rest need crawling. Duplicate websites are dropped
  // here because `discover-brands` de-dupes against KNOWN domains, not within a batch.
  const seen = new Set<string>()
  const rows = found.candidates
    .filter((c): c is Required<Pick<Candidate, 'brand' | 'website'>> & Candidate =>
      Boolean(c?.brand && c?.website))
    .filter((c) => {
      const key = c.website.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, remaining)
    .map((c) => ({ brand: c.brand, website: c.website, country: c.country ?? '' }))

  let queued = 0
  if (rows.length > 0) {
    const { data, error } = await svc.from('scrape_jobs').insert(rows).select('id')
    if (error) return json({ ok: false, stage: 'queue', error: error.message, pool, target }, 500)
    queued = data?.length ?? 0
  }

  return json({
    ok: true,
    pool,
    target,
    deficit,
    requested: want,
    queued,
    savedContacts: found.savedContacts,
    preferFree,
    spentToday: spent + queued,
    note: found.note,
  })
})
