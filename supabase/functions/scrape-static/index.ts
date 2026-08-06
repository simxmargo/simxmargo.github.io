// `scrape-static` Edge Function — turns `scrape_jobs` rows into `contacts`.
//
// Static `fetch()` only (no headless browser — that can't run in Edge Functions).
// For each brand domain it respects robots.txt, pulls the likely contact pages,
// extracts + classifies public emails, and upserts them. Sites that yield nothing
// statically are flagged `needs_browser` for the optional local Playwright worker.
//
// Invoke one job (UI "Scrape" button):  POST { "job_id": "<uuid>" }
// Or drain the pending queue (pg_cron):  POST {}   (no body)
//
// Auth: admin-only (is_admin() gate). The UI path carries the signed-in admin's JWT.
// A future pg_cron drain must present admin credentials (or add a CRON_SECRET branch
// here) — an unauthenticated cron tick will now 401, by design.
//
// Deploy:  supabase functions deploy scrape-static
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Design rationale: docs/BACKEND_DESIGN.md §3.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import {
  CONTACT_PATHS,
  classifyEmail,
  extractEmails,
  isPathAllowed,
  normalizeDomain,
  pageUrl,
  parseDisallowed,
  sleep,
  USER_AGENT,
} from '../_shared/scrape.ts'

// Domains per invocation. Measured at ~18s per site (1.5s politeness delay across 6
// contact pages, plus timeouts), so 5 is ~90s — comfortably inside the 150s wall-clock
// budget while draining a 100-site queue in ~20 minutes rather than 33.
const JOB_BATCH = 5
const PAGE_TIMEOUT_MS = 8_000 // don't let one hung site stall the whole run
const POLITE_DELAY_MS = 1_500 // ~1 request / 1.5s per domain (etiquette, §3)
const MAX_EMAILS_PER_DOMAIN = 25 // a sane cap so a directory page can't flood us

// Fetch a page as text. Returns the HTML *and* the outcome code, so callers can
// tell "this page had no emails" apart from "the site refused us". A missing
// /press page is normal, not an error — but a 403/429 wall is neither, and
// silently folding both into `null` is what made every miss look identical.
async function fetchText(url: string): Promise<{ html: string | null; code: number | string }> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
    if (!res.ok) return { html: null, code: res.status }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return { html: null, code: 'non-html' }
    return { html: await res.text(), code: res.status }
  } catch (err) {
    return { html: null, code: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unreachable' }
  }
}

// Explain WHY a domain yielded nothing, so `needs_browser` stops being a catch-all.
// A wall of 403/429 means the site refused THIS user agent at the CDN edge — no
// headless browser fixes that, so pointing the Playwright worker at it is wasted
// work. Only "pages read fine but carried no address" is a real browser candidate.
// Length-independent comparison. A plain `===` on a secret leaks its prefix through
// timing; this is cheap enough that there is no reason to accept that.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function diagnoseEmpty(statuses: Array<number | string>): string {
  const blocked = statuses.filter((s) => s === 403 || s === 429).length
  const readable = statuses.filter((s) => s === 200).length
  if (readable === 0 && blocked > 0) {
    return `Blocked by the site (${blocked}× 403/429) — it refused our user agent, so a headless browser is unlikely to help.`
  }
  if (readable === 0) return `No contact page could be read (${statuses.join(', ')}).`
  return '' // pages loaded fine, they just publish no address → genuine browser candidate
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  // TWO callers, two credentials. The studio presents the signed-in admin's JWT; the
  // pg_cron drain has no session to present, so it carries the same shared secret
  // drain-queue uses, compared in constant time. Without this branch an unauthenticated
  // cron tick 401s — which is what kept scraping tied to an open browser tab.
  const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
  const presented = req.headers.get('x-cron-secret') ?? ''
  const isCron = cronSecret.length > 0 && safeEqual(presented, cronSecret)
  if (!isCron) {
    const denied = await requireAdmin(req)
    if (denied) return denied
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Missing Supabase env' }, 500)

  // Service-role client bypasses RLS — Edge Functions only, never the browser.
  const supabase = createClient(url, serviceKey)

  // One specific job, or drain the oldest pending jobs.
  let jobId: string | undefined
  try {
    jobId = (await req.json())?.job_id
  } catch {
    /* empty body — drain mode */
  }

  const base = supabase.from('scrape_jobs').select('*')
  const { data: jobs, error } = jobId
    ? await base.eq('id', jobId)
    : await base.eq('status', 'pending').order('created_at', { ascending: true }).limit(JOB_BATCH)
  if (error) return json({ error: error.message }, 500)

  // CLAIM THE WHOLE BATCH UP FRONT, in one statement.
  //
  // A run takes ~90s but the cron ticks every minute, so two invocations overlap by
  // design. Marking each job 'scraping' as its turn came round left the later ones
  // still 'pending' when the next tick selected — so two workers would crawl the same
  // brand's site simultaneously. Claiming immediately makes the overlap useful instead
  // of harmful: the second tick simply picks up the next five.
  const claimed = (jobs ?? []).map((j) => j.id)
  if (claimed.length > 0) {
    await supabase.from('scrape_jobs').update({ status: 'scraping' }).in('id', claimed)
  }

  const results: Array<{ job_id: string; brand: string; found: number; status: string; error: string }> = []

  for (const job of jobs ?? []) {
    const r = { job_id: job.id, brand: job.brand, found: 0, status: 'done', error: '' }

    try {
      const domain = normalizeDomain(job.website)
      if (!domain) throw new Error(`Unparseable website: ${job.website}`)

      // robots.txt is advisory here; if we can't read it, assume nothing is disallowed.
      const robots = await fetchText(`https://${domain}/robots.txt`)
      const disallowed = robots.html ? parseDisallowed(robots.html) : []

      const emails = new Map<string, string>() // email -> first source_url it appeared on
      const statuses: Array<number | string> = [] // per-page outcome, for diagnoseEmpty()
      for (const [i, path] of CONTACT_PATHS.entries()) {
        if (!isPathAllowed(path, disallowed)) continue
        if (i > 0) await sleep(POLITE_DELAY_MS) // space out requests to the same host
        const { html, code } = await fetchText(pageUrl(domain, path))
        statuses.push(code)
        if (!html) continue
        for (const e of extractEmails(html)) {
          if (!emails.has(e)) emails.set(e, pageUrl(domain, path))
        }
        if (emails.size >= MAX_EMAILS_PER_DOMAIN) break
      }

      if (emails.size === 0) {
        // Nothing found. Either the site blocked us outright or it genuinely
        // publishes no address statically — diagnoseEmpty() records which.
        r.status = 'needs_browser'
        r.error = diagnoseEmpty(statuses)
      } else {
        const rows = [...emails].slice(0, MAX_EMAILS_PER_DOMAIN).map(([email, src]) => ({
          brand: job.brand,
          email,
          email_type: classifyEmail(email),
          country: job.country ?? '',
          website: job.website,
          source_url: src,
          status: 'new',
        }))
        // ignoreDuplicates: never clobber a row that enrichment/scoring/sending
        // has already touched. `.select()` returns only the rows actually inserted,
        // so `found` counts genuinely new contacts.
        const { data: inserted, error: upErr } = await supabase
          .from('contacts')
          .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
          .select('id')
        if (upErr) throw new Error(upErr.message)
        r.found = inserted?.length ?? 0
        r.status = 'done'
      }
    } catch (err) {
      r.status = 'error'
      r.error = err instanceof Error ? err.message : String(err)
    } finally {
      // Always close the job out — a failure must never leave it stuck on 'scraping'.
      await supabase
        .from('scrape_jobs')
        .update({ status: r.status, error: r.error || null, scraped_at: new Date().toISOString() })
        .eq('id', job.id)
    }

    results.push(r)
  }

  return json({ processed: results.length, results })
})
