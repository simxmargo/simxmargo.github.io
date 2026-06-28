# Backend design — brand-outreach-studio

> Status: **scrape → enrich → qualify is LIVE** (deployed 2026-06-28, admin-gated).
> The Contacts "Scrape new brands" button now queues `scrape_jobs` and runs the three
> Edge Functions; new leads flow into the live `contacts` table. Enrichment + AI
> scoring degrade gracefully until `HUNTER_API_KEY` / `ANTHROPIC_API_KEY` are set.
> **Still design-only: sending (§6), suppression (§7), the optional Playwright worker.**
> Grounded in research done 2026-06-15 (sources at the end) — re-verify external facts.

The guiding principle: the **frontend stays dumb** (it only reads/writes Supabase
and triggers jobs), and all the I/O-heavy, secret-holding work happens server-side
in Supabase Edge Functions driven by `pg_cron`.

---

## 1. Architecture

```
  React/Vite UI ──(anon key)──▶  Supabase Postgres  ◀──(service-role)── Edge Functions
   - add brand URLs                - scrape_jobs                          - scrape-static
   - view contacts                 - contacts                            - enrich
   - draft + queue emails          - send_queue          pg_cron ───────▶ - qualify (AI)
   - watch send status             - suppression_list   (every ~1 min)    - send-one
   - edit settings                 - app_settings                         - gmail-oauth
                                          ▲
                                          │  (only for JS-rendered sites)
                                   optional local Playwright worker
```

**Who does what**

| Concern | Runtime | Why |
|---|---|---|
| UI / control panel | React + Vite (anon key) | No secrets, no scraping. Just inserts/RPCs + reads. |
| Static scraping, enrichment, AI scoring, sending | Edge Functions (Deno) | I/O-bound; fits the 2s-CPU / 256MB / 150s limits. |
| Scheduling + daily cap | `pg_cron` + `pg_net` | Reliable, server-side, survives the browser being closed. |
| JS-rendered / anti-bot sites | **Optional** local Playwright script | Headless browsers can't run in Edge Functions. Add lazily. |

---

## 2. Data model

See `supabase/migrations/0001_init.sql` (+ `0002_enrich.sql`, which adds
`scrape_jobs.enriched_at`). Tables: `scrape_jobs`, `contacts`
(dedup via `unique(email)`), `send_queue`, `suppression_list`, `app_settings`.
RLS is single-owner; the service-role key (Edge Functions only) bypasses it.

---

## 3. The scraper (`scrape-static` Edge Function) — ✅ deployed + wired

Implemented in `supabase/functions/scrape-static/index.ts` with pure helpers in
`supabase/functions/_shared/scrape.ts` (unit-checked by `_shared/scrape.test.mjs`).
**Deployed + admin-gated** (`_shared/auth.ts` `requireAdmin()` → `is_admin()`, before
any fetch). Invoke one job with `POST {job_id}` (the UI "Scrape" button, via
`lib/admin/scrapeBrands.ts`) or drain the pending queue with `POST {}` — note a cron
drain must now present admin auth (or add a CRON_SECRET branch), see the file header.

Input: a `scrape_jobs` row (brand + website). Output: rows in `contacts`.

1. Fetch `https://{domain}/robots.txt`; **skip disallowed paths** (cheap good-faith insurance).
2. Fetch the likely contact pages: `/`, `/contact`, `/contact-us`, `/press`,
   `/about`, `/pages/contact`. Static `fetch()` only.
3. Extract emails two ways: (a) `mailto:` links, (b) an email regex over the HTML.
   Parse with `deno-dom-wasm` if you need DOM context; a regex pass is usually enough.
4. Classify each: `press@`/`pr@` → `press`; `partner*`/`collab*` → `partnerships`;
   `info@`/`hello@`/`contact@` → `generic`; a `first.last@` → `named`.
5. Upsert into `contacts` (the `unique(email)` constraint dedups).
6. If **no emails found**, set the job to `needs_browser` so the optional Playwright
   worker can pick it up later. Mark `done`/`error` in a `finally`-style block.

**Etiquette (build it in, don't bolt on):** sequential requests, ~1 req / few
seconds per domain, a descriptive `User-Agent`
(`brand-outreach-studio/1.0 (+contact)`), only public pages, never logged-in
areas, **never LinkedIn**. Cache results so re-runs cost nothing.

> Legal note: scraping public, un-gated pages is supported by current US case law
> (hiQ, Van Buren, Meta v. Bright Data), but a site's ToS is a separate
> contract risk. Stay on brands' own public pages and respect robots.txt.

---

## 4. Enrichment (`enrich` Edge Function) — Hunter.io free-first — ✅ deployed

Implemented in `supabase/functions/enrich/index.ts`. Invoke for specific brands
with `POST {domains:[...]}` or auto-pick scraped-but-unenriched jobs with `POST {}`.
Adds the `scrape_jobs.enriched_at` marker (migration `0002_enrich.sql`) so a re-run
never re-spends a Hunter credit on a domain it already searched. **Deployed +
admin-gated.** Runs automatically after a scrape (the chain in `scrapeBrands.ts`).
Without `HUNTER_API_KEY` it returns `{enriched:0, note}` — a no-op, never an error.

Hunter's **free plan includes API access** (~50 credits/month ≈ 25 searches + 50
verifications; no card; Domain Search capped at **10 emails/domain** on free).
Spend it carefully:

1. At startup, read `GET /v2/account?api_key=…` (free, no quota) to know remaining
   credits. **Stop enriching when low.**
2. For a brand domain: `GET /v2/domain-search?domain={domain}&api_key=…`. Harvest
   the up-to-10 emails with their `type` (generic/personal), `confidence`,
   `first_name`, `last_name`, `position`. Write to `contacts`.
3. **Prefer generic role inboxes** (`press@`, `partnerships@`) as the default
   outreach target — they need no verification credit and are almost always valid.
4. For a specific named person not returned: generate likely patterns
   (`first.last@`, `flast@`) for free, then spend **one** `GET /v2/email-verifier`
   (0.5 credit) before trusting it. Never cold-email an unverified guess.
5. **Cache everything** in `contacts` so re-runs cost zero credits.
6. When Hunter's quota is gone, degrade gracefully behind the same interface:
   Snov.io free (50 credits) / Apollo.io free (~100/mo) / pure pattern + verify.

Auth: `api_key` query param, or header `X-API-KEY`. Use `test-api-key` for
integration tests (returns dummy data, no quota).

---

## 5. AI scoring (`qualify` Edge Function) — ✅ already ported

Implemented (ported from the retired `brand-outreach` Python CLI's `qualify.py`):

- **`supabase/functions/_shared/qualify.ts`** — `scoreBrandFit()`: a forced
  tool-use call to Claude (`claude-haiku-4-5-20251001`) returning
  `{fit_score 1-10, reason}`, enum-constrained + score-clamped. Dependency-free
  `fetch` to the Anthropic Messages API (no SDK bundle).
- **`supabase/functions/qualify/index.ts`** — reads the creator profile from
  `app_settings`, finds up to 10 contacts with a null `fit_score`, scores each,
  and writes `fit_score` + `fit_reason` back.

Cost ~fractions of a cent per lead. **Deployed + admin-gated**, and standardized on
`_shared/http.ts` (CORS/preflight) so the browser can invoke it. Runs after enrich in
the scrape chain. Without `ANTHROPIC_API_KEY` it returns `{scored:0, note}` — a no-op,
not a 500 — so the chain never hard-fails. Set the key to switch scoring on:
`supabase secrets set ANTHROPIC_API_KEY=…`.

---

## 6. Sending (`send-one` Edge Function + `pg_cron`) — the careful part

### 6a. ⚠️ Choose your sending identity (this is the real decision)

Research verdict: **a free secondary Gmail is the high-risk, low-deliverability
option.** Two honest paths:

| | Free secondary Gmail | Domain + Google Workspace *(recommended)* |
|---|---|---|
| Cost | $0 | ~$10/yr domain + Workspace 14-day free trial, then ~$7/mo |
| Daily ceiling | Flags at **15–25/day** (behavioral, not the nominal 500) | ~2,000/day |
| DKIM/DMARC | Google DKIM only, **no DMARC alignment** → ~10–15% to spam | Custom-domain DKIM + real DMARC alignment |
| Account risk | Throwaway; can be suspended | Stable; protects your main domain |
| Token | Testing-mode refresh tokens **expire every 7 days** | Same OAuth, but no reason to stay in Testing |

You chose the **free secondary Gmail** to start — totally fine for ≤~15–20/day
while testing. The tool is built to switch to Workspace later with zero code
change (just a different connected account). If replies matter, the Workspace
path is worth the ~$7.

### 6b. Gmail OAuth (once)

- Scope: **`https://www.googleapis.com/auth/gmail.send`** — Google classifies it
  **Sensitive (not Restricted)**, so a *personal* OAuth app can use it
  **unverified** (click through the warning) with you as the test user.
- **Flip the OAuth app to "In Production"** (still unverified) so the refresh
  token **doesn't expire every 7 days** — this is the #1 gotcha.
- Do the consent flow once (a small `gmail-oauth` function or a local script),
  capture the **refresh token**, and store it as a Supabase **Edge Function
  Secret** (`supabase secrets set GMAIL_REFRESH_TOKEN=…`), read via
  `Deno.env.get()`. Never in the browser bundle.

### 6c. `send-one`

1. `pg_cron` (every ~1 min) checks sends in the last 24h vs `app_settings.daily_cap`.
   If under cap, it `net.http_post`s the `send-one` function (via `pg_net`).
2. `send-one` pops the next due `send_queue` row (`status='queued'`,
   `scheduled_for <= now()`), re-checks the suppression list, exchanges the
   refresh token for a short-lived access token, builds a **raw MIME message**
   (this is how you set a **`Reply-To:` your real email** so brand replies come to
   *you*), and calls `users.messages.send`.
3. Mark the row `sent`/`failed` (+ `contacts.status`, `last_emailed_at`) in a
   `finally`-style block so a failure never loops forever. On `invalid_grant`
   (revoked token), set a "re-auth needed" flag the UI surfaces.

### 6d. Warmup + caps (deliverability)

Drive these from `app_settings`: start `daily_cap` at **~5/day**, ramp over ~14
days (5→10→20→30), keep bodies varied (the template already personalizes per
brand), minimize links, no attachments. The send queue + cron naturally spread
sends out to respect Gmail's ~60/min ceiling.

---

## 7. Compliance (structural, not optional)

- **CAN-SPAM:** every email carries a truthful subject, your identity, a **physical
  postal address** (now a profile field, baked into the template), and a working
  **opt-out**. Honor removals immediately.
- **Suppression:** an opt-out reply or a bounce adds the address to
  `suppression_list`; a DB trigger **blocks queueing** to suppressed addresses.
- **GDPR:** prefer **role inboxes** (`press@`) over named EU individuals — much
  lower risk, and that's who handles pitches anyway. Keep volume low + targeting
  tight. *Not legal advice.*

---

## 8. Secrets & RLS

- Edge Function Secrets (`supabase secrets set`): `GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `HUNTER_API_KEY`,
  `ANTHROPIC_API_KEY`. Read with `Deno.env.get()`. The **service-role key** lives
  only in functions, never the frontend.
- Frontend: only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- RLS: single owner; policies allow `authenticated`. See the migration.

---

## 9. UI → backend seams (what's stubbed today)

| UI element | Replaces stub with |
|---|---|
| "Scrape new brands" button (Contacts) | ✅ DONE — `ScrapeBrandsModal` → `scrapeBrands()` → insert `scrape_jobs` → `scrape-static` + `enrich` + `qualify` |
| Mock `contacts` in the store | a Supabase `select * from contacts` |
| "Approve & send" (Queue) | insert `send_queue` row → `pg_cron` → `send-one` |
| "Connect Gmail" (Settings) | the `gmail-oauth` consent flow |
| Profile fields / daily cap | persist to `app_settings` |

---

## 10. Suggested build order

1. **Supabase project** + apply `0001_init.sql` **and `0002_enrich.sql`**; swap the
   store's mock data for a real `contacts` query (read-only first).
2. ✅ **`scrape-static` + `enrich`** *(deployed + wired 2026-06-28)* → real contacts
   flow in from the UI "Scrape new brands" button (`ScrapeBrandsModal` →
   `scrapeBrands()` inserts a `scrape_jobs` row → `scrape-static` → `enrich` → `qualify`).
3. ✅ **`qualify`** *(deployed)* → fit scores populate once `ANTHROPIC_API_KEY` is set.
4. **Gmail OAuth + `send-one` + `pg_cron`** → real sending with the daily cap.
5. **Reply/bounce handling** → suppression + flip `contacts.status` to `replied`.
6. *(optional)* Playwright worker for `needs_browser` sites.

---

## Sources (2026-06-15)

- Gmail scopes / OAuth: developers.google.com/workspace/gmail/api/auth/scopes ·
  support.google.com/cloud/answer/13464325 (testing vs production tokens)
- Gmail limits / warmup / DKIM-DMARC: aerosend.io, mailreach.co, instantly.ai,
  smartlead.ai, gmass.co (Reply-To)
- Hunter.io free plan + API: help.hunter.io/en/articles/11060999 ·
  hunter.io/api-documentation/v2
- Supabase Edge Functions limits / secrets / cron: supabase.com/docs/guides/functions/limits ·
  /functions/secrets · supabase.com/blog/processing-large-jobs-with-edge-functions ·
  /functions/schedule-functions · deno.land/x/deno_dom
- Scraping legality + CAN-SPAM/GDPR: hiQ v. LinkedIn, Van Buren, Meta v. Bright
  Data; ftc.gov CAN-SPAM compliance guide; gdprlocal.com cold-email
