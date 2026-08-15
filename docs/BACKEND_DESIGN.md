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
> **Sending is BUILT + SCHEDULED (2026-08-15):** the design's `send-one` became two
> functions — **`send-email`** (admin immediate send/preview) and **`drain-queue`**
> (the pg_cron worker) — both through one `_shared/sendPitch.ts`. The daily sender
> now enforces a PH-morning send window, a warm-up ramp, one-send-per-tick jitter
> pacing, auto-queue with MX validation, scope-gated bounce detection feeding
> `suppression_list`, and a kill switch (§6c–§6e, migration `0017_daily_sender.sql`).
> **Still design-only: the optional Playwright worker.**
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
   - draft + queue emails          - send_queue          pg_cron ───────▶ - drain-queue
   - watch send status             - suppression_list   (send window)     - send-email
   - edit safety knobs             - domain_checks                        - gmail-oauth
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
`lib/admin/scrapeBrands.ts`) or drain the pending queue with `POST {}`.

> **Deploy this function with `--no-verify-jwt`.** Two callers, two credentials: the
> studio presents the admin JWT, the pg_cron drain presents `CRON_SECRET` in
> `x-cron-secret`. `verify_jwt` is applied at the GATEWAY, before the function boots, and
> a cron tick carries no `Authorization` header — so with it on, the cron-secret branch is
> unreachable and every tick 401s. It shipped that way on 2026-08-07 and ~1,400
> once-a-minute ticks were rejected until 2026-08-10; queued brands were never crawled and
> the Outreach board sat at NEW = 0. Turning gateway verification off is not a weakening:
> the gateway accepts the anon key (which ships in the browser bundle), while the handler
> requires the cron secret or a real admin.
>
>     ./node_modules/.bin/supabase functions deploy scrape-static \
>       --project-ref zzgypushqcpchfxrjexc --use-api --no-verify-jwt

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
  search (0 when cached). Query pool is 20 niches x 13 framings = **260** distinct
  searches, in two families:
  - **COMMERCE** (7 framings) — "brand online store", "boutique shop", … The volume
    engine. They say "shop"/"store"/"brand" deliberately: a bare topic ("korean
    skincare") returns dermatologists and beauty bloggers; the same topic plus a retail
    word returns the shops.
  - **INTENT** (6 framings, added 2026-08-09) — "ambassador program", "brand ambassador",
    "influencer collab", "ugc creators", "creator program", "pr packages". A brand
    already recruiting creators has a budget line and somebody whose job is reading
    pitches; a brand that merely exists has neither.

  - **APPS** (14 niches x 6 partner framings, added 2026-08-10) — "photo editing app",
    "camera app", "lightroom presets", "canva templates"… Drawn from `portfolio_brands`:
    Filmora, BeautyPlus, VivaVideo, Hypic, OldRoll, ProCCD, Kapi Cam and Reelsapp are
    nearly half the creator's paid work and previously had *zero* query coverage — every
    search was a clothing search. Retail framings don't fit a company with no storefront,
    so this family carries its own ("creator partnerships", "affiliate program").
  - **PARTNERS** (8 niches) — agencies and labels. They buy creator work on retainer, so
    one yes outweighs a dozen gifting deals. Warner Music, Flighthouse and Field Office
    all arrived this way.

  `queryPool(extra)` also folds in `public_profile.niche`, so retuning the media kit
  retunes discovery with no redeploy (`profileNiches()` drops terms too generic to be
  useful — a bare "fashion" query returns the same mega-brands every run).

  The pool is **interleaved across families**, not concatenated, and ORDER IS THE
  PRIORITY: a run now stops on a wall-clock deadline (below) and may only ever reach the
  first ten or fifteen queries. Concatenating would mean a short run never issues a single
  app or agency query. Round-robin guarantees every family gets a share of whatever budget
  the run turns out to have.

  **The wall clock (added 2026-08-10).** `MAX_SEARCHES` is a COST cap, not a time cap, and
  on 2026-08-09 that distinction cost a day of scraping: a ScrapeCreators profile search
  measured 10-20s, 30 of them sequentially came to 515s, and Supabase killed the function
  at 150s. The studio received a 504 whose body is not our `{error}` JSON, so the UI could
  only render "Nothing to scrape / Edge Function returned a non-2xx status code" — the
  credits were fine the whole time. Now: one deadline for the whole request
  (`BUDGET_MS` 125s), a 60% slice for Instagram, `SEARCH_CONCURRENCY` 4 so the slice buys
  ~20 searches instead of ~4, and `SC_TIMEOUT` cut 20s → 9s because with 400+ queries in
  the pool a slow one is never worth waiting on. Running short of time returns **200 with
  a note**, never a 5xx — a smaller batch is not a server error.
- **`wantsCreators()` + `intentFirst()`** — the load-bearing intent signal is the BIO,
  not the query. Instagram's profile search matches mostly on username and display name,
  so an "ambassador program" query returns brands whose *name* contains it, which is a
  handful. The bio — which every search result carries anyway — is where a brand
  actually announces it is recruiting, so the intent queries widen the net and the bio
  scan reads it. Matching is phrase-led rather than keyword-led on purpose: bare
  "collab" matches creators advertising *themselves* for collabs, which is the exact
  population this pipeline exists to filter out. Intent-positive candidates sort first,
  and `discover-brands` reports the count as `wantsCreators`.
- **`classifyProfile()`** — the search also returns CREATORS, who are worthless to
  pitch. Scores own-site (+3), commerce category (+2), business account (+1), creator
  category (-3), no site (-2); >= 2 is a brand. Measured ~14 accepted / 6 rejected per
  three searches, with no creator misclassified as a brand.
- **`echoesBrand()`** — THE GATE. Bios link to all sorts of things, and taking the first
  link produced real mistakes: `@foursistersboutique` linked a magazine article and would
  have been pitched as "Omahamagazine"; `@tiffanyandco` linked an affiliate shim and
  became "Likeshop". A brand's own domain echoes its handle or a word of its name.
- A candidate whose bio published an address is written straight to `contacts` and never
  enters `scrape_jobs` — it costs no further request. The address still goes through
  `pickBestEmail()` (§5a) for the GATE rather than the ranking: one address cannot be
  ranked against anything, but it can be malformed, automated, or an agency's. A bio
  address that fails the gate does **not** disqualify the brand — the candidate rejoins
  the scrape queue, because its own site may still publish a good one.

Cost: ~20 credits per 100 brands. Without `SCRAPECREATORS_API_KEY` it falls back to the
Wikidata dataset (~1,100 apparel companies, no key) so the button is never dead.

---

## 5. Email lookup — bio, then site **and** index together

There is no Hunter step. Addresses come from three places:

1. **The Instagram bio**, at discovery time (§4). Free, and it hit ~60% of profiles in
   sampling. A brand that publishes one here skips the queue entirely.
2. **The brand's own contact pages**, via `scrape-static` (§3).
3. **The Brave search index**, *also* inside `scrape-static`.

**2 and 3 both run, and their results are merged into one ranking (§5a).**

Brave used to be a FALLBACK — it ran only when the crawl came back empty. That was the
wrong shape: a brand whose homepage published `support@` was written off with `support@`,
even though `press@` was one search away in the index. Brave sees pages our six-path
crawl never reaches: press releases, stockist directories, partner listings, a
`/collaborations` page linked from nowhere obvious. So it is an **enhancement on top of**
the crawl, not a rescue for it.

It still rescues the empty case — two thirds of `scrape_jobs` came back `needs_browser`
because the origin answered 403/429, and Brave already crawled those same pages. That is
now a consequence of running it, not the reason.

**Quota:** the free plan is ~2,000 queries/month at ~1 req/sec. Three controls keep a run
inside it. `findBrandEmails()` stops at the first of three phrasings that yields anything
(usually the first). Enrichment is skipped when the crawl already produced a
**collaborations-tier address on the brand's own domain** (score ≥ 70) — nothing the index
returns can outrank that. And a 110s per-invocation deadline stops a batch of slow hosts
blowing the 150s wall-clock budget. A 100-brand run costs roughly 100-150 queries.

`_shared/braveSearch.ts` → `findBrandEmails()` returns **every** address that passes
`belongsToBrand()`, unranked — the ranker orders the union. (It used to return one
"best", chosen by a local `ROLE_RANK` list that was a third copy of the ranking and had
already drifted, putting `press` above `collabs`. That list is gone.) The filters it
still applies:

- **Same-domain** addresses are accepted outright.
- **Free mailboxes** (gmail etc.) only when the local part echoes the brand — otherwise a
  directory page listing ten businesses hands us whichever gmail appears first and we
  pitch a stranger.
- Junk is dropped: `noreply@`, platform noise (`sentry`, `wixpress`), and image filenames
  that regex as addresses (`logo@2x.png`).

Ordering is no longer its job — see §5a.

### 5a. Which address gets written — `lib/outreach/pickEmail.ts` (2026-08-09)

A brand's site rarely publishes one address. meandem.com publishes **21** — one per
retail store. goodhousekeeping.com published 8. The scraper used to write all of them,
so 93 of 166 contacts (**56% of the table**) were redundant rows for a company already
represented, and 96 sat at `skip` because the post-send sweep archived them after the
fact. The choice now happens **at ingest**: one ranked row per company.

**Ownership is a hard gate, applied first.** manhattan-denim.com's contact page yielded
four addresses and every one was a type foundry from an `@font-face` licence header; no
amount of role scoring makes a type designer the right recipient, so those never enter
the ranking at all. Same for `info@afterpay.com` on Vuori's site and
`legal@intercom.io` on Gymshark's.

**Role intent is the dominant term** — it answers *who reads this*:

| Tier | Score | Examples |
|---|---|---|
| Collaborations desk | 62 | `partnerships@` `collabs@` `influencer@` `ambassador@` `ugc@` |
| Marketing / community | 54 | `marketing@` `community@` `brand@` `social@` |
| Press | 46 | `press@` `pr@` `media@` |
| Trade / wholesale | 42 | `wholesale@` `affiliates@` `stockists@` |
| General enquiries | 34 | `hello@` `info@` `contact@` |
| A named individual | 24 | `jane.doe@` |
| Customer service | 16 | `support@` `returns@` `orders@` |
| Back office | 8 | `legal@` `careers@` `billing@` |

`email_type` still stores the four values its CHECK constraint allows — the tier is what
decides *which* partnerships address wins when a brand has several.

**Publication signals adjust it** — they answer *is it still alive*, with no verification
API involved. `+12` published as a `mailto:` href (a human wrote it on purpose, and a
visitor clicking it reaches somebody). `+10` on the brand's own apex domain. `+8`
repeated across pages. `+6` on a dedicated contact page. `−16` a free mailbox. `−22`
reads as a single store location. Adjustments are bounded so they reorder neighbours but
never promote a support queue over a partnerships desk: an inference about liveness
should not outrank a known fact about intent.

The winner's score lands in `contacts.confidence` (which had been dead since Hunter was
dropped) and the runners-up in `contacts.alternates` jsonb (migration 0016). **The
alternates are the point of not simply discarding them:** when the chosen address
bounces, promoting a runner-up is one UPDATE, while re-crawling costs a queue slot, a
politeness delay per page, and — for the 59% of sites that answer our user agent with
403 — probably yields nothing.

**Two shape bugs this closed.** Text on a page runs together, so `…@goodhousekeeping.com
if you…` was stored as `feedback@goodhousekeeping.comif`, and `hearst.comif` and
`girlfriend.comeurope` arrived the same way. Those are *syntactically valid* addresses,
so every shape filter passed them and they sat waiting to hard-bounce. `hasPlausibleTld()`
checks the final label against a real suffix allowlist — the only test that separates
them, since "known TLD with letters glued on" also rejects `.network` and `.boutique`.
Separately, undecoded markup fused itself to local parts (`u003ehello@`, `nbspsupport@`),
and `nbspsupport@frankiesbikinis.com` *outranked* the clean `support@` twin beside it.
Both are rejected rather than repaired — in every observed case the clean address was
also on the page, so dropping the corrupted twin promotes the real one for free.

**One module, four runtimes.** `lib/outreach/pickEmail.ts` and `lib/outreach/hosts.ts`
live in `lib/` and are imported by the Deno Edge Functions (upward, as `sendPitch.ts`
already does for `lib/emailBody.ts`), the Next bundle, and `scripts/dedupe-contacts.mjs`
via Node's type-stripping. `tsconfig.json` sets `allowImportingTsExtensions` so the one
`.ts` spelling satisfies all of them. This replaced three separate definitions of "best
address" — `_shared/scrape.ts`'s `classifyEmail`, `braveSearch.ts`'s `rank()`, and
`dedupeContacts.ts`'s own `TYPE_RANK` + `looksOwned` — which had already drifted: the
scraper's press pattern was unanchored `^(press|pr|…)`, so `privacy@`, `promo@` and
`pricing@` all classified as PRESS and were therefore *promoted*.

**Cleaning up rows written before this:** `npm run dedupe:contacts` is READ-ONLY. It
ranks the live table through the same module and writes `supabase/cleanup/dedupe_contacts.sql`
for review — it never executes. Rows at `sent`, `replied`, `inbound` or `bounced` are
never touched; `bounced` in particular is load-bearing, because the row is what stops a
future scrape re-adding a known-dead address. The output directory is gitignored: it
contains real contact addresses and this repo is public.

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

> **Not SMTP — the API.** Outreach sends via `gmail.googleapis.com/gmail/v1/users/me/messages/send`
> with an OAuth refresh token (`_shared/gmail.ts` → `_shared/sendPitch.ts`). SMTP with a
> Google App Password exists in exactly one place, the **`collab`** function, which
> notifies the inbox about a Work-with-me inquiry — a different job with a different
> credential. Worth stating because "the Gmail SMTP setup" is a natural shorthand for
> both, and they fail for different reasons: OAuth dies with `invalid_grant` (flip the
> consent app to Production), SMTP dies with a rejected app password.

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

### 6c. Sending — BUILT as `send-email` + `drain-queue` (one `sendPitch()`)

The design's `send-one` split into two functions so the admin path and the cron
path could authenticate differently without diverging in behavior:

- **`send-email`** (admin-gated `requireAdmin`): `{action:'preview'}` for the real
  signature, `{action:'send'}` for a test or an immediate send.
- **`drain-queue`** (cron-gated `x-cron-secret`, deployed `--no-verify-jwt`): the
  scheduled worker — see §6e for everything it enforces per tick.
- Both call **`_shared/sendPitch.ts`**: cap + warm-up check, pause check,
  company-duplicate refusal, raw-MIME build with **`Reply-To:` your real email**,
  `users.messages.send`, then bookkeeping (`contacts.status`, `last_emailed_at`,
  cancel same-company queue rows). On `invalid_grant` it sets
  `gmail_account.needs_reauth` for the Settings card.
- Claiming is `claim_due_sends()` (SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`) so
  overlapping ticks cannot double-send; `requeue_stuck_sends()` rescues rows a dead
  worker abandoned.

### 6d. Warm-up + caps — ENFORCED (2026-08-15)

`effectiveDailyCap()` in `sendPitch.ts`: today's cap =
`min(daily_cap, warmup_start × (1 + full weeks since the FIRST real send))` —
5 → 10 → 15 → 20 on the defaults. The ramp anchors on `min(send_queue.sent_at)`,
so it only ever moves forward. The Settings → Sending safety card shows the same
number (display mirror in `SendingSafetyCard.tsx` — keep the formulas identical).
Keep bodies varied (the template personalizes per brand), minimize links, no
attachments.

### 6e. The daily send window & safety rails (migration `0017_daily_sender.sql`)

`drain-queue` runs on cron `* 0-9 * * *` UTC (an envelope; the REAL window comes
from `app_settings` so the admin can move it without a migration). Each tick, in
order:

1. **Kill switch** — `app_settings.sending_paused` stops everything, including
   manual sends (enforced in `sendPitch`, message names the reason). Set manually
   in Settings, or automatically by the bounce sweep (below).
2. **Window** — Asia/Manila wall clock (UTC+8, no DST — plain arithmetic), default
   **8–11 AM weekdays** (`send_window_start/end`, `send_weekdays_only`). Everything
   queued outside it — including the UI's "Send now" — waits here.
3. **Bounce sweep** (once per PH day, only when `gmail_account.scope` contains
   `gmail.readonly`): `_shared/bounces.ts` reads mailer-daemon DSNs, intersects the
   addresses with contacts we actually emailed (false-positive guard), marks them
   `bounced`, inserts `suppression_list (reason='bounce')`, cancels their queue
   rows, and **auto-pauses** at ≥3 bounces in 7 days or an 8% bounce rate.
   `gmail.readonly` is a RESTRICTED scope — reconnecting shows Google's unverified-
   app warning once; sending works without it, detection just stays off.
4. **Budget** — `effectiveDailyCap − sent in last 24h`; nothing claims past it.
5. **Auto-queue** (`auto_queue`, default on) — tops the queue up to the day's
   budget from `status='new'` contacts with `confidence ≥ auto_queue_min_confidence`
   (default 55), each address re-validated by `mailableReason()` and an **MX check**
   (`lib/outreach/validateEmail.ts`, DoH via Google→Cloudflare, three-valued: only a
   definite "no mail path" blocks; cached 30 days in `domain_checks`). Drafts are
   composed with the same `buildDraft()` + saved template the Compose drawer uses.
6. **Jitter** — a tick that could send flips a 55% coin; then `claim_due_sends(1)`.
   One send per tick, human-shaped gaps, no bursts. `{force:true}` (with the cron
   secret) bypasses window+jitter for operator tests — never pause, cap, or
   validation.

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
  **Bounces now feed it automatically** (§6e bounce sweep, 2026-08-15); opt-out
  replies remain a manual add — reading replies is deliberately out of scope, so
  honoring a "stop" still means a human acting on it same-day.
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
