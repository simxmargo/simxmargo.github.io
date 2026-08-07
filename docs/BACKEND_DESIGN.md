# Backend design — brand-outreach-studio

> Status: **discover → scrape → send is LIVE** (admin-gated). "Scrape new brands"
> discovers brands on Instagram, queues `scrape_jobs`, and `pg_cron` drains them into
> the live `contacts` table.
>
> **Superseded 2026-08-07:** the Hunter (`enrich`) and Anthropic (`qualify`) functions
> were deleted. Neither ever had an API key, and both were reachable only from the
> browser-driven scrape loop that the cron drain replaced. `fit_score` went with them —
> contacts sort newest first. Email discovery is now Instagram bios first, then the
> Brave search index (§5).
> **Gmail OAuth (§6b) is now BUILT** — `gmail-oauth` Edge Function + migration
> `0012_sending_account.sql` + the live Settings → Sending account card. Setup steps
> (Google Cloud app, secrets, the `--no-verify-jwt` deploy) are in
> `docs/GMAIL_SENDING_SETUP.md`.
> **Still design-only: `send-one` + `pg_cron` (§6c/§6d), suppression (§7), the optional
> Playwright worker.**
> Grounded in research done 2026-06-15 (sources at the end) — re-verify external facts.

The guiding principle: the **frontend stays dumb** (it only reads/writes Supabase
and triggers jobs), and all the I/O-heavy, secret-holding work happens server-side
in Supabase Edge Functions driven by `pg_cron`.

---

## 1. Architecture

```
  React/Vite UI ──(anon key)──▶  Supabase Postgres  ◀──(service-role)── Edge Functions
   - start a run                   - scrape_jobs                          - discover-brands
   - view contacts                 - contacts                             - scrape-static
   - draft + queue emails          - send_queue          pg_cron ───────▶ - send-one
   - watch send status             - suppression_list   (every ~1 min)    - gmail-oauth
   - edit settings                 - app_settings
                                          ▲
                                          │  (only for JS-rendered sites)
                                   optional local Playwright worker
```

**Who does what**

| Concern | Runtime | Why |
|---|---|---|
| UI / control panel | React + Vite (anon key) | No secrets, no scraping. Just inserts/RPCs + reads. |
| Discovery, static scraping, email lookup, sending | Edge Functions (Deno) | I/O-bound; fits the 2s-CPU / 256MB / 150s limits. |
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
6. If **no emails found**, ask the Brave search index for the same pages (§5) before
   giving up. Only if that is also empty does the job become `needs_browser`, for the
   optional Playwright worker. Mark `done`/`error` in a `finally`-style block.

**Etiquette (build it in, don't bolt on):** sequential requests, ~1 req / few
seconds per domain, a descriptive `User-Agent`
(`brand-outreach-studio/1.0 (+contact)`), only public pages, never logged-in
areas, **never LinkedIn**. Cache results so re-runs cost nothing.

> Legal note: scraping public, un-gated pages is supported by current US case law
> (hiQ, Van Buren, Meta v. Bright Data), but a site's ToS is a separate
> contract risk. Stay on brands' own public pages and respect robots.txt.

---

## 4. Discovery (`discover-brands` Edge Function) — Instagram via ScrapeCreators

Implemented in `supabase/functions/discover-brands/index.ts`. `POST {limit: 100}`,
admin-gated. Replaced a hand-written list of 64 domains, which had a hard floor and —
being all mega-brands — supplied most of the `needs_browser` failures.

Instagram is a better discovery surface than a web index: a profile carries the brand's
own site, its size, and often a contact address, so one credit returns ten candidates
already part-enriched.

- **`_shared/instagramSearch.ts`** — `GET /v1/instagram/search/profiles`, 1 credit per
  search (0 when cached). Query pool is 20 niches x 7 commerce framings = 140 distinct
  searches. The framings all say "shop"/"store"/"brand" deliberately: a bare topic
  ("korean skincare") returns dermatologists and beauty bloggers; the same topic plus a
  retail word returns the shops.
- **`classifyProfile()`** — the search also returns CREATORS, who are worthless to
  pitch. Scores own-site (+3), commerce category (+2), business account (+1), creator
  category (-3), no site (-2); >= 2 is a brand. Measured ~14 accepted / 6 rejected per
  three searches, with no creator misclassified as a brand.
- **`echoesBrand()`** — THE GATE. Bios link to all sorts of things, and taking the first
  link produced real mistakes: `@foursistersboutique` linked a magazine article and would
  have been pitched as "Omahamagazine"; `@tiffanyandco` linked an affiliate shim and
  became "Likeshop". A brand's own domain echoes its handle or a word of its name.
- A candidate whose bio published an address is written straight to `contacts` and never
  enters `scrape_jobs` — it costs no further request.

Cost: ~20 credits per 100 brands. Without `SCRAPECREATORS_API_KEY` it falls back to the
Wikidata dataset (~1,100 apparel companies, no key) so the button is never dead.

---

## 5. Email lookup — bios first, then the Brave index

There is no Hunter step. Addresses come from three places, cheapest first:

1. **The Instagram bio**, at discovery time (§4). Free, and it hit ~60% of profiles in
   sampling.
2. **The brand's own contact pages**, via `scrape-static` (§3).
3. **The Brave search index**, as the fallback inside `scrape-static`.

Step 3 is the one that matters. Two thirds of `scrape_jobs` came back `needs_browser`
because the site answered 403/429 or timed out — Brave has already crawled those exact
pages, so asking its index gets the address without touching the origin that refuses us.

`_shared/braveSearch.ts` → `findBrandEmail()` runs up to three phrasings and stops at the
first address that passes `belongsToBrand()`:

- **Same-domain** addresses are accepted outright.
- **Free mailboxes** (gmail etc.) only when the local part echoes the brand — otherwise a
  directory page listing ten businesses hands us whichever gmail appears first and we
  pitch a stranger.
- Junk is dropped: `noreply@`, platform noise (`sentry`, `wixpress`), and image filenames
  that regex as addresses (`logo@2x.png`).
- Role mailboxes rank first (`press@`, `partnerships@` before `info@`, `support@`).

Brave's free plan is ~1 request/second, so callers pace themselves; `scrape-static` also
stops offering the fallback past 110s so a batch of dead hosts can't blow the 150s
wall-clock budget.

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

### 6b. Gmail OAuth (once) — ✅ BUILT (2026-07-30)

Implemented as the **`gmail-oauth` Edge Function** + migration
`0012_sending_account.sql` + `components/admin/SendingAccountCard.tsx`.
Operator setup lives in **`docs/GMAIL_SENDING_SETUP.md`** — do that before connecting.

- Scope: **`https://www.googleapis.com/auth/gmail.send`** (+ non-sensitive `openid`
  `email`, so the callback can learn *which* address connected — `gmail.send` alone
  can't call `users.getProfile`). Google classifies `gmail.send` **Sensitive (not
  Restricted)**, so a *personal* OAuth app can use it **unverified**.
- **Flip the OAuth app to "In Production"** (still unverified) so the refresh
  token **doesn't expire every 7 days** — this is the #1 gotcha. The Settings
  card's **Test** button (refresh-token → access-token, sends nothing) is how you
  catch it; an `invalid_grant` sets `gmail_account.needs_reauth` and the UI says so.
- The refresh token is stored in **`gmail_account.refresh_token`**, not an Edge
  Function secret — a UI-driven connect flow has to be able to write it. Safety comes
  from RLS: that table has **RLS enabled with zero policies** (deny-all for `anon` AND
  `authenticated`), plus revoked table grants, so only the service-role key inside
  Edge Functions can read it. The browser sees status only, through the
  `SECURITY DEFINER` RPC `sending_account_status()`, which omits the token column.
- The function deploys with **`--no-verify-jwt`** (Google's browser redirect can't
  carry an `Authorization` header). Authorization moved inside: `requireAdmin()` on
  every POST action, and a single-use, 10-minute `oauth_states` nonce on the callback.

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

- **CAN-SPAM:** every email carries a truthful subject, your real identity, and a
  reply path that reaches a human.
- ⚠️ **The one-line opt-out was REMOVED from the template** (2026-07-31, owner's
  decision) because it is the single clearest "this is bulk mail" tell and the pitch
  had to read as personally written. Know the trade-off you accepted: CAN-SPAM
  §7704(a)(3) requires a functioning opt-out mechanism in *commercial* email, and a
  cold pitch to a brand is commercial. What remains in its place is a real reply-to
  that a person reads, and honoring any "stop" reply immediately and manually.
  **If volume ever grows past hand-sent, put the opt-out back** — the exposure scales
  with send count, and per-message penalties are the reason this was structural.
  A **physical postal address** field (`mailing_address`) also exists on the profile
  but is currently **empty**, so no address ships either.
- **Suppression:** an opt-out reply or a bounce adds the address to
  `suppression_list`; a DB trigger **blocks queueing** to suppressed addresses.
  With the footer gone this is now the *only* automated honor-the-removal path, which
  makes building it more important, not less.
- **GDPR:** prefer **role inboxes** (`press@`) over named EU individuals — much
  lower risk, and that's who handles pitches anyway. Keep volume low + targeting
  tight. *Not legal advice.*

---

## 8. Secrets & RLS

- Edge Function Secrets (`supabase secrets set`): `GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `SCRAPECREATORS_API_KEY` (discovery,
  §4), `BRAVE_API_KEY` (email fallback, §5), `CRON_SECRET` (the pg_cron drains).
  Read with `Deno.env.get()`. The **service-role key** lives only in functions, never
  the frontend.
- Frontend: only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- RLS: single owner; policies allow `authenticated`. See the migration.

---

## 9. UI → backend seams (what's stubbed today)

| UI element | Replaces stub with |
|---|---|
| "Scrape new brands" button (Outreach) | ✅ DONE — `buildBatch()` → `discover-brands` → `queueScrapeJobs()` → `pg_cron` drains `scrape-static` |
| Mock `contacts` in the store | a Supabase `select * from contacts` |
| "Approve & send" (Queue) | insert `send_queue` row → `pg_cron` → `send-one` |
| "Connect Gmail" (Settings) | ✅ DONE — `SendingAccountCard` → `gmail-oauth` (start/callback/test/disconnect) → `gmail_account` |
| Profile fields / daily cap | persist to `app_settings` |

---

## 10. Suggested build order

1. **Supabase project** + apply `0001_init.sql` **and `0002_enrich.sql`**; swap the
   store's mock data for a real `contacts` query (read-only first).
2. ✅ **`discover-brands` + `scrape-static`** *(Instagram discovery 2026-08-07)* → real
   contacts flow in from the "Scrape new brands" button (`buildBatch()` → discovery →
   `queueScrapeJobs()` → `pg_cron` drains `scrape-static`, which falls back to the Brave
   index when a site blocks it).
3. ~~`qualify`~~ — deleted 2026-08-07 along with `enrich`; see the status note at the top.
4. ✅ **Gmail OAuth** *(built 2026-07-30)* → connect/test/disconnect from Settings.
   Then **`send-one` + `pg_cron`** → real sending with the daily cap (still to build;
   `_shared/gmail.ts` `refreshAccessToken()` is the seam it plugs into).
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
