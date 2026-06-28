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

const JOB_BATCH = 3 // domains per invocation — stays well under the 150s wall-clock budget
const PAGE_TIMEOUT_MS = 8_000 // don't let one hung site stall the whole run
const POLITE_DELAY_MS = 1_500 // ~1 request / 1.5s per domain (etiquette, §3)
const MAX_EMAILS_PER_DOMAIN = 25 // a sane cap so a directory page can't flood us

// Fetch a page as text. Returns null on any failure / non-HTML so callers can
// just skip it — a missing /press page is normal, not an error.
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null
    return await res.text()
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  // Admin-only: the static SPA has no server, so this function runs with the
  // service-role key below — gate it on is_admin() before any scraping/DB write.
  const denied = await requireAdmin(req)
  if (denied) return denied

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

  const results: Array<{ job_id: string; brand: string; found: number; status: string; error: string }> = []

  for (const job of jobs ?? []) {
    await supabase.from('scrape_jobs').update({ status: 'scraping' }).eq('id', job.id)
    const r = { job_id: job.id, brand: job.brand, found: 0, status: 'done', error: '' }

    try {
      const domain = normalizeDomain(job.website)
      if (!domain) throw new Error(`Unparseable website: ${job.website}`)

      // robots.txt is advisory here; if we can't read it, assume nothing is disallowed.
      const robots = await fetchText(`https://${domain}/robots.txt`)
      const disallowed = robots ? parseDisallowed(robots) : []

      const emails = new Map<string, string>() // email -> first source_url it appeared on
      for (const [i, path] of CONTACT_PATHS.entries()) {
        if (!isPathAllowed(path, disallowed)) continue
        if (i > 0) await sleep(POLITE_DELAY_MS) // space out requests to the same host
        const html = await fetchText(pageUrl(domain, path))
        if (!html) continue
        for (const e of extractEmails(html)) {
          if (!emails.has(e)) emails.set(e, pageUrl(domain, path))
        }
        if (emails.size >= MAX_EMAILS_PER_DOMAIN) break
      }

      if (emails.size === 0) {
        // Static pass found nothing — likely JS-rendered. Defer to the Playwright worker.
        r.status = 'needs_browser'
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
