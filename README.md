# Brand Outreach Studio

A small web app to **find fashion-brand contacts, review them in a nice UI, and
email them from a template** — so brands reply and reach you directly. Built for
a solo beauty/fashion/lifestyle creator doing outbound to brands (not agencies).

```
scrape brand sites ─▶ enrich (Hunter free) ─▶ AI score ─▶ YOU review in UI ─▶ send (capped) ─▶ replies → you
```

---

## Status at a glance

| Area | State |
|---|---|
| UI shell (Contacts / Compose / Queue / Settings) | ✅ Built, runs on mock data |
| Frontend ↔ Supabase wiring | ✅ Wired (reads live `contacts` + `app_settings`, **falls back to mock** if the DB is unreachable) |
| Database schema (`supabase/migrations/`) | ✅ **Applied + verified** (9 tables live; `npm run db:apply`) |
| Edge Functions: `scrape-static`, `enrich`, `qualify` | ✅ Code-complete — ⏳ **undeployed** |
| Sending pipeline (`gmail-oauth`, `send-one`, `pg_cron`) | ⛔ Designed, not built (see `docs/BACKEND_DESIGN.md`) |
| Supabase MCP (read-only, per-repo) | ✅ Configured + PAT set (loads via the `simone` launcher) |
| **Next.js 16 migration** (Phase 0) | ✅ **Done** — Next 16 + React 19 |
| **Public media kit at `/`** (Phase 1) | ✅ **Built + adversarially reviewed** — dark editorial; reads live Supabase; verified |
| **Admin studio at `/admin`** (Phase 2) | ✅ **Built** — passphrase gate + media-kit editors + the outreach studio; reads live |
| Mediakit data + collab form (Phases 3–4) | ✅ **Wired + verified** — anon reads (ISR `revalidate=60`) + `/api/collab` insert |
| Admin writes (Phase 5) | ⏳ Add `SUPABASE_SERVICE_ROLE_KEY` to `.env` → editors save (reads already work) |

> **`simxmargo` unified app** (one domain): the public **media kit** lives at `/` and the
> private outreach + media-kit **studio** at `/admin`, behind a single server-checked
> passphrase (no login system). Full architecture + phase plan:
> **[`docs/MEDIAKIT_PLAN.md`](docs/MEDIAKIT_PLAN.md)**.

---

## Quick start

```bash
npm install
npm run dev          # Next dev → http://localhost:5174
```

- **`/`** — public media kit. Reads live Supabase (falls back to mock if unconfigured/unpublished).
- **`/admin`** — private studio. Enter the `ADMIN_SECRET` passphrase (set in `.env`) to unlock.

`npm run build` and `npm run typecheck` pass clean.

### Env vars (`.env`, gitignored — see `.env.example`)

| Var | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | browser + server reads | safe to ship; RLS-protected |
| `SUPABASE_ACCESS_TOKEN` | CLI (`scripts/sb.mjs`) + MCP | account PAT; per-repo isolation |
| `ADMIN_SECRET` | `/admin` gate (server) | single passphrase; **not** `NEXT_PUBLIC_` |
| `SUPABASE_SERVICE_ROLE_KEY` | admin **writes** | **⏳ not set yet** — add to enable saving in `/admin` |

### Database
```bash
npm run db:apply   # apply migrations (Management API, IPv4-safe)
npm run db:seed    # seed dev content (publishes the profile, 12 brands, social stats)
```

---

## Architecture

```
  React/Vite UI ──(anon key)──▶  Supabase Postgres  ◀──(service-role)── Edge Functions
   - add brand URLs                - scrape_jobs                          - scrape-static
   - view contacts                 - contacts                             - enrich
   - draft + queue emails          - send_queue          pg_cron ───────▶ - qualify (AI)
   - watch send status             - suppression_list   (every ~1 min)    - send-one (TODO)
   - edit settings                 - app_settings                         - gmail-oauth (TODO)
```

| Layer | Tech | Role |
|---|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v3 + Zustand | Public media kit (Server Components, SEO/ISR) + admin studio (client). Anon key only; writes go through gated server routes. |
| Database | Supabase Postgres + RLS | Source of truth. Schema in `supabase/migrations/`. |
| Server logic | Supabase Edge Functions (Deno) | I/O-heavy, secret-holding work: scrape, enrich, AI score, send. |
| Scheduling | `pg_cron` + `pg_net` | Drains the send queue under a daily cap (survives the browser being closed). |

The guiding principle: the **frontend stays dumb** (reads/writes Supabase + triggers
jobs); all secret-holding I/O happens server-side. Full blueprint: `docs/BACKEND_DESIGN.md`.

---

## Supabase setup

This repo is configured **exactly like the `momma` and `h365` repos**: a per-repo
read-only MCP server, a per-repo CLI token, and a `simone` launcher — so you can
work multiple Supabase projects at once without them ever crossing.

### Project

| | |
|---|---|
| Project URL | `https://zzgypushqcpchfxrjexc.supabase.co` |
| Project ref | `zzgypushqcpchfxrjexc` |
| Anon / publishable key | `sb_publishable_…` — ships in the browser bundle (RLS protects data) |

### Per-repo isolation — how multiple projects coexist

You work several Supabase projects (HABITS, Momma Mia, this one). `supabase login`
stores **one** global token, so switching would normally mean re-logging-in. We
avoid that with **three independent pins**, so the wrong project is structurally
unreachable:

1. **Account** — `SUPABASE_ACCESS_TOKEN` in this repo's gitignored `.env`. The CLI
   reads the env var **over** the global login (`scripts/sb.mjs` injects it), so this
   repo always talks to the brand-outreach account while HABITS/Momma stay logged in.
2. **Project** — `supabase/config.toml` pins `project_id`, and every CLI script passes
   `--project-ref=zzgypushqcpchfxrjexc`. You can't `db push` to the wrong project.
3. **MCP** — `.mcp.json` defines one read-only server pinned by `--project-ref`, so
   Claude's MCP can only ever see this project's database.

### One-time: paste your Personal Access Token

The anon key and DB password are **not** enough for the CLI/MCP — those need an
account-level **PAT** (`sbp_…`).

1. Create one (on the brand-outreach account): **https://supabase.com/dashboard/account/tokens**
2. Paste the same token in **two** gitignored places:
   - `.env` → `SUPABASE_ACCESS_TOKEN=sbp_…`
   - `.mcp.json` → `env.SUPABASE_ACCESS_TOKEN`

> 🔒 **Secrets model.** `.env` and `.mcp.json` are gitignored. The committed
> `.mcp.json.example` is redacted. The PAT and DB password never enter the browser
> bundle (only `VITE_`-prefixed vars do). Edge Function secrets (`GMAIL_*`,
> `HUNTER_API_KEY`, `ANTHROPIC_API_KEY`, service-role) live server-side via
> `supabase secrets set` — never in this repo.

### The `simone` launcher

A project `.mcp.json` only loads when Claude Code **starts in that folder**. A
PowerShell function (added to your profile) handles the `cd`:

```powershell
simone            # cd into this repo + launch Claude, so this repo's MCP loads
```

Memory is shared across all your repos via a directory junction (this repo's
`~/.claude` namespace → the umbrella memory), so notes follow you between projects.

---

## Processes & commands

All `db:*` scripts route through `scripts/sb.mjs`, which loads `.env` and injects
your PAT — so they always hit the right project.

### Run the app
```bash
npm run dev          # Vite dev server on :5174
npm run build        # production build
npm run typecheck    # tsc --noEmit
```

### Apply the database schema
```bash
npm run db:apply     # PRIMARY: applies supabase/migrations/*.sql via the Management
                     # API (HTTPS, IPv4-safe). Idempotent — safe to re-run.
```
The direct Postgres host (`db.<ref>.supabase.co:5432`) is **IPv6-only** and the
IPv4 pooler uses a private-CA cert, so raw `pg`/`db push` can fail on IPv4-only
networks. `db:apply` sidesteps both by going through `api.supabase.com`.

*Alternatives:* `npm run db:push` (proper migration-history tracking; needs an
IPv6-capable network + the DB password) — or paste `supabase/apply_all.sql` into
the Supabase **SQL Editor** and run it.

### Inspect / generate
```bash
npm run db:list                          # list migrations + applied status
npm run gen:types > src/types/db.ts      # regenerate TypeScript types from the live schema
npm run sb -- projects list              # raw CLI passthrough (uses THIS repo's token)
```

### Deploy the Edge Functions
```bash
npm run sb -- functions deploy scrape-static enrich qualify
npm run sb -- secrets set HUNTER_API_KEY=… ANTHROPIC_API_KEY=…
# Tip: HUNTER_API_KEY=test-api-key returns dummy data with no quota cost.
```

### Using the MCP (read-only)
Once your PAT is in `.mcp.json` and you've launched via `simone`, Claude can
introspect the schema, run `SELECT`s, and check advisors through the
`supabase-brandoutreach` MCP server. **All writes go through migrations**, never
the MCP (it's read-only by design — keeps the schema reproducible from version control).

---

## Data model

`supabase/migrations/0001_init.sql` + `0002_enrich.sql` (combined: `apply_all.sql`).

| Table | Purpose |
|---|---|
| `scrape_jobs` | Brand sites to pull contacts from — the scraper's input queue. (`+ enriched_at` so enrichment never re-spends a Hunter credit.) |
| `contacts` | Discovered + enriched + AI-scored leads. `unique(email)` dedups across runs. |
| `send_queue` | Outbound emails, drained by `pg_cron` under a daily cap. |
| `suppression_list` | Opt-outs + hard bounces. A **DB trigger refuses to queue** to these (CAN-SPAM enforced in the DB, not just the UI). |
| `app_settings` | Single-row config: outbound email profile (jsonb) + `daily_cap` + warmup. |
| `public_profile` | **(mediakit)** Single-row public identity: name, bio, rate card, SEO, `is_published` gate. |
| `portfolio_brands` | **(mediakit)** One row per partnership in the public grid (logo, metrics, media, `sort_order`). |
| `social_stats` | **(mediakit)** Per-platform followers + growth history (seeded TikTok 2.7M / IG 1.3M / FB 394k). |
| `collab_inquiries` | **(mediakit)** Public "Work with me" submissions. Anon **INSERT-only** — no anon read. |

**RLS boundary (the security crux):** outreach tables (`contacts`, `send_queue`, …)
are owner-only — no anon access. Public mediakit tables allow **anon `SELECT`** on
published/visible rows only; `collab_inquiries` allows **anon `INSERT`** but never
`SELECT`. The anon key ships in the browser, so all *writes* go through the
service-role key inside passphrase-gated server routes — never from the client.
Full rationale + the admin-gate design: [`docs/MEDIAKIT_PLAN.md`](docs/MEDIAKIT_PLAN.md).

---

## Edge Functions (`supabase/functions/`)

| Function | What it does | State |
|---|---|---|
| `scrape-static` | robots-aware static fetch of contact pages → extract + classify emails → dedup-safe upsert. No emails found → flags `needs_browser`. | ✅ code-complete |
| `enrich` | Hunter.io free-first: credit check → domain-search → insert new + backfill `confidence` (non-destructive, idempotent). | ✅ code-complete |
| `qualify` | AI fit-scoring (1–10 + reason) via Claude `claude-haiku-4-5` forced tool-use. | ✅ code-complete |
| `_shared/` | `scrape.ts` (pure parse helpers), `qualify.ts` (scoring), `http.ts` (CORS). | ✅ |
| `send-one`, `gmail-oauth` | Gmail-API sending under cap + warmup, OAuth consent. | ⛔ designed only |

---

## Build order / roadmap

1. ✅ Supabase project + frontend wiring (mock fallback).
2. ⏳ **Apply schema** (`npm run db:apply`) → live data flows.
3. ⏳ **Deploy `scrape-static` + `enrich`** → real contacts; wire the disabled
   "Scrape new brands" button (insert `scrape_jobs` → invoke the chain).
4. ⏳ **Deploy `qualify`** → fit scores populated.
5. ⛔ Gmail OAuth + `send-one` + `pg_cron` → real sending with the daily cap.
6. ⛔ Reply/bounce handling → suppression + flip `contacts.status` to `replied`.

---

## Compliance (built in, not optional)

Every email identifies you, includes a **physical postal address** (CAN-SPAM) and a
**one-line opt-out**; opt-outs/bounces go to the `suppression_list` that the database
**refuses to email**. Prefer brand role inboxes (`press@`, `partnerships@`) over named
individuals (lower GDPR risk). *Not legal advice.*

### ⚠️ Honest note on sending (read before the sending pipeline)
A *free* secondary Gmail works for very low volume (~15–20/day) but Google flags
cold-sending fast and it can't have DMARC alignment (more mail lands in spam). The
solid setup is a **cheap domain + Google Workspace** (~$7/mo) for real deliverability.
The app is built to switch with no code change. Full reasoning in `docs/BACKEND_DESIGN.md`.

---

## Project structure

```
brand-outreach-studio/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # RootLayout (server) — metadata, globals.css
│   ├── page.tsx                # "/" studio shell ('use client') — page switch + hydrate
│   ├── globals.css             # Tailwind + fonts (was src/index.css)
│   └── icon.svg                # favicon
├── components/                 # Sidebar, StatsBar, FilterBar, ContactsTable, ComposeDrawer, StatusBadge
│   └── pages/                  # ContactsPage, QueuePage, SettingsPage ('use client')
├── lib/                        # supabase.ts (anon client), store.ts (Zustand + live/mock), emailTemplate.ts, types.ts, mock/
├── supabase/
│   ├── config.toml             # project_id pin (per-repo isolation)
│   ├── migrations/             # 0001_init.sql, 0002_enrich.sql
│   ├── apply_all.sql           # the two migrations concatenated (for the SQL Editor)
│   └── functions/              # scrape-static, enrich, qualify, _shared/
├── scripts/
│   ├── sb.mjs                  # per-repo Supabase CLI wrapper (injects PAT from .env)
│   └── db-apply.mjs            # IPv4-safe schema apply via the Management API
├── docs/BACKEND_DESIGN.md      # the full backend blueprint
├── .mcp.json(.example)         # read-only Supabase MCP, pinned to this project
└── .env                        # gitignored secrets (anon key, PAT, DB password)
```

## Tech

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v3, Zustand for state,
Supabase (Postgres + auth + Edge Functions) as the backend. Editorial light theme
(Fraunces + Inter). Dev server on `:5174` (`npm run dev`).
