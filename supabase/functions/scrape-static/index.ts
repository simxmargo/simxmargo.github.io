// `scrape-static` Edge Function — turns `scrape_jobs` rows into `contacts`.
//
// Static `fetch()` only (no headless browser — that can't run in Edge Functions).
// For each brand domain it respects robots.txt, pulls the likely contact pages,
// extracts + classifies public emails, and upserts them.
//
// When a site yields nothing — two thirds of them, almost always a 403/429 wall — it
// falls back to the Brave search index, which holds the same pages already crawled.
// Only when that also comes up empty is the job flagged `needs_browser`.
//
// Invoke one job (UI "Scrape" button):  POST { "job_id": "<uuid>" }
// Or drain the pending queue (pg_cron):  POST {}   (no body)
//
// Auth: two callers, two credentials — the studio presents the signed-in admin's JWT,
// the pg_cron drain presents CRON_SECRET in `x-cron-secret` (see the handler).
//
// ── DEPLOY WITH --no-verify-jwt. THIS IS LOAD-BEARING. ──────────────────────────
// `verify_jwt` is PLATFORM config, applied at the gateway BEFORE this file runs. With
// it on, a pg_cron tick — which carries no Authorization header — is rejected with
// `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` and the function never boots, so the
// cron-secret branch below is unreachable no matter what it says. That is exactly what
// happened: from 2026-08-07 to 2026-08-09 every one of the once-a-minute drain ticks
// 401'd, ~1,400 of them, and queued brands were never scraped. `drain-queue` has always
// been deployed with the flag and has always worked; this one was not.
//
// Turning verification off does NOT make the function public — it moves the check from
// the gateway into the handler, where it is strictly stronger (the gateway accepts the
// anon key, which ships in the browser bundle; the handler requires the cron secret or
// a real admin).
//
//   ./node_modules/.bin/supabase functions deploy scrape-static \
//     --project-ref zzgypushqcpchfxrjexc --use-api --no-verify-jwt
//
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Design rationale: docs/BACKEND_DESIGN.md §3.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import {
  CONTACT_PATHS,
  extractEmailHits,
  isPathAllowed,
  normalizeDomain,
  pageUrl,
  parseDisallowed,
  sleep,
  USER_AGENT,
} from '../_shared/scrape.ts'
import { findBrandEmails } from '../_shared/braveSearch.ts'
import { emailBelongsToBrand } from '../_shared/hosts.ts'
import {
  pickBestEmail,
  toStoredAlternates,
  type EmailCandidate,
} from '../../../lib/outreach/pickEmail.ts'

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

  // Brave enrichment costs ~1.1-3.3s per job — usually one query answers, and the pacing
  // delay only applies BETWEEN phrasings. Past this mark we stop offering it so a batch
  // of slow hosts can't push the invocation over the wall-clock budget; those jobs still
  // keep whatever their own site published, just unenriched.
  const startedAt = Date.now()
  const BRAVE_DEADLINE_MS = 110_000
  const braveKey = Deno.env.get('BRAVE_API_KEY')?.trim()

  for (const job of jobs ?? []) {
    const r = { job_id: job.id, brand: job.brand, found: 0, status: 'done', error: '' }

    try {
      const domain = normalizeDomain(job.website)
      if (!domain) throw new Error(`Unparseable website: ${job.website}`)

      // robots.txt is advisory here; if we can't read it, assume nothing is disallowed.
      const robots = await fetchText(`https://${domain}/robots.txt`)
      const disallowed = robots.html ? parseDisallowed(robots.html) : []

      // Every address the site publishes, with provenance. ALL of them are collected —
      // the choice of which one to write happens once, at the end, with the full set in
      // hand. Deciding page-by-page would mean committing to `hello@` off the homepage
      // before ever reading `/press`.
      const found = new Map<string, EmailCandidate>()
      const statuses: Array<number | string> = [] // per-page outcome, for diagnoseEmpty()
      for (const [i, path] of CONTACT_PATHS.entries()) {
        if (!isPathAllowed(path, disallowed)) continue
        if (i > 0) await sleep(POLITE_DELAY_MS) // space out requests to the same host
        const { html, code } = await fetchText(pageUrl(domain, path))
        statuses.push(code)
        if (!html) continue
        const isContactPage = path !== '/'
        for (const hit of extractEmailHits(html)) {
          // A brand's page carries other people's addresses: @font-face licence headers
          // (manhattan-denim.com yielded four type designers and no real contact),
          // embedded Shopify app widgets, agency credits. Shape filtering cannot tell
          // those apart from the brand's own — only ownership can.
          if (!emailBelongsToBrand(hit.email, domain, job.brand)) continue
          const prev = found.get(hit.email)
          if (!prev) {
            found.set(hit.email, {
              email: hit.email,
              via: hit.via,
              sourceUrl: pageUrl(domain, path),
              pageHits: 1,
              onContactPage: isContactPage,
            })
            continue
          }
          // Seen again on another page: that repetition is itself a liveness signal, and
          // a later `mailto:` upgrades a hit first seen in a script blob.
          prev.pageHits = (prev.pageHits ?? 1) + 1
          if (hit.via === 'mailto' && prev.via !== 'mailto') {
            prev.via = 'mailto'
            prev.sourceUrl = pageUrl(domain, path)
          }
          if (isContactPage) prev.onContactPage = true
        }
        if (found.size >= MAX_EMAILS_PER_DOMAIN) break
      }

      // ── Brave enrichment ────────────────────────────────────────────────────────
      //
      // ALWAYS, not only when the crawl came back empty. Brave is an ENHANCEMENT on top
      // of the site scrape, not a rescue for it: the index has pages our six-path crawl
      // never reaches — press releases, stockist directories, partner listings, a
      // /collaborations page linked from nowhere obvious. A brand whose homepage shows
      // `support@` used to be written off with `support@` even when `press@` was one
      // search away. Both sources feed ONE ranking below.
      //
      // It still rescues the empty case — two thirds of jobs came back `needs_browser`
      // because the origin answered 403/429, and Brave already crawled those same pages.
      // That is now a consequence of running it, not the reason for running it.
      const enrich =
        braveKey &&
        Date.now() - startedAt < BRAVE_DEADLINE_MS &&
        // The one skip: the crawl already produced a collaborations-tier address on the
        // brand's own domain (62 + 10 = 72). Nothing Brave returns can outrank that, and
        // the free plan is ~2,000 queries a month — worth not spending on a settled
        // answer. Anything less, including a press desk, still gets enriched, because
        // `partnerships@` may well be sitting in the index.
        (pickBestEmail([...found.values()], job.website, job.brand).winner?.score ?? 0) < 70

      if (enrich) {
        for (const hit of await findBrandEmails(braveKey!, job.brand, domain)) {
          const prev = found.get(hit.email)
          if (prev) {
            // The crawl already had it. Seeing it indexed elsewhere too is corroboration,
            // but must not overwrite a `mailto:` provenance with the weaker 'search'.
            prev.pageHits = (prev.pageHits ?? 1) + 1
            continue
          }
          found.set(hit.email, {
            email: hit.email,
            via: 'search',
            sourceUrl: hit.sourceUrl || `https://${domain}`,
            pageHits: 1,
          })
        }
      }

      // ONE ROW PER COMPANY. The site can publish twenty addresses — meandem.com
      // publishes one per retail store — and writing all of them meant the table filled
      // with rows that existed only to be archived by the post-send sweep. The ranker
      // picks the desk most likely to read a creator pitch and still answer; the rest
      // ride along on the winner as `alternates`, so a bounce can be recovered by
      // promoting a runner-up instead of re-crawling the site.
      const pick = pickBestEmail([...found.values()], job.website, job.brand)

      if (!pick.winner) {
        // Either the site blocked us and the index knew nothing either, it genuinely
        // publishes no address, or everything it published belonged to somebody else.
        r.status = 'needs_browser'
        r.error = pick.rejected.length
          ? `Found ${pick.rejected.length} address(es), none usable: ${pick.rejected
              .map((x) => `${x.email} (${x.reason})`)
              .join('; ')}`
          : diagnoseEmpty(statuses)
      } else {
        const w = pick.winner
        const row = {
          brand: job.brand,
          email: w.email,
          email_type: w.type,
          country: job.country ?? '',
          website: job.website,
          source_url: w.sourceUrl,
          confidence: w.score,
          alternates: toStoredAlternates(pick.alternates),
          status: 'new',
        }
        // ignoreDuplicates: never clobber a row that scoring or sending has already
        // touched. `.select()` returns only rows actually inserted, so `found` counts
        // genuinely new contacts.
        const { data: inserted, error: upErr } = await supabase
          .from('contacts')
          .upsert([row], { onConflict: 'email', ignoreDuplicates: true })
          .select('id')
        if (upErr) throw new Error(upErr.message)
        r.found = inserted?.length ?? 0
        r.status = 'done'
        // Deliberately no note on the success path: `r.error` lands in
        // `scrape_jobs.error`, which the run panel renders as a failure. What was kept
        // and what was held in reserve is on the contact row itself.
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
