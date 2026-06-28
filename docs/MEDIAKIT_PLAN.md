<!-- Authored by the mediakit-design-phase ultracode workflow (2026-06-23). Canonical architecture + build plan for the simxmargo unified app. -->

# simxmargo — Mediakit + Outreach Architecture & Plan

## Overview & one-domain routing map

`simxmargo` unifies two surfaces that already exist (or partly exist) as separate concerns into a single Next.js 16 App Router deployment on one domain (`https://simxmargo.com`):

1. **The public mediakit** — a dark, editorial, SEO-optimized one-pager for the `simxmargo` creator brand (4.4M total reach). Fully crawlable, server-rendered, no auth, read-only against published data. This is what cold-pitched brands land on.
2. **The private outreach studio** — the existing Vite SPA (contacts scraping/scoring, send queue, settings) ported into the same app under a passphrase-gated `/admin`, plus NEW mediakit-management screens (profile, portfolio, social stats, inquiries inbox).

The two surfaces are deliberately coupled at the **data and product** level (an inbound `collab_inquiry` can be promoted to an outreach `contact`; a closed outreach `contact` can be promoted to a public `portfolio_brand` case study) but strictly **separated at the security and theme** level (distinct visual identity, distinct trust boundary).

**Routing map (one domain, one Next app):**

| Route | Surface | Rendering | Auth | Purpose |
|---|---|---|---|---|
| `/` | Public mediakit | Server Component (ISR, `revalidate=60`) | none (anon, RLS) | Hero, social stats, portfolio grid, about, rate card, work-with-me form |
| `/opengraph-image` | Public | Static/ISR PNG (`next/og`) | none | Auto-wired OG/Twitter share card |
| `/robots.txt`, `/sitemap.xml` | Public | `app/robots.ts`, `app/sitemap.ts` | none | Discoverability |
| `/admin` | Studio shell | Client Component | passphrase gate (client UX) | Two-group nav: Media Kit + Outreach Studio |
| `/admin/*` (in-app page switch or sub-routes) | Studio | Client Components | passphrase (UX only) | Profile, Portfolio, Social, Inquiries, Contacts, Queue, Settings |
| `/api/admin/*` (Route Handlers) | Server | Node runtime | **`x-admin-secret` header — the REAL boundary** | All writes via service-role client |
| `/api/collab` (Route Handler or Edge Fn) | Server | Edge/Node | anon-INSERT + honeypot + rate-limit | Public form submission write surface |

The mental model: **public reads go straight to Supabase anon (RLS-enforced) from Server Components; every write — admin or public form — goes through a server endpoint that holds the privileged key.** The browser never holds the service-role key, and the only client-readable secret env vars are the Supabase URL and anon key.

---

## Stack

- **Next.js 16, App Router** — Server Components for the public mediakit (SEO + ISR), Client Components for the interactive studio. Replaces the current Vite 5 entry. `reactStrictMode` is on by Next default (preserves the old `React.StrictMode` wrapper for free).
- **React 18.3 / TypeScript 5.6** — carried over unchanged.
- **Supabase** (project ref `zzgypushqcpchfxrjexc`, URL `https://zzgypushqcpchfxrjexc.supabase.co`) — Postgres + RLS as the security boundary for public reads; service-role key (server-only) for admin writes; Storage for avatar/hero/logo uploads; Edge Functions (Deno) for scrape-meta, collab-submit, and the later social sync. The existing `supabase/` dir (scrape-static / enrich / qualify functions, migrations, `apply_all.sql`) and `scripts/` (`sb.mjs`, `db-apply.mjs`) stay **untouched** — they're referenced only by the `db:*` npm scripts.
- **Tailwind v3** — kept deliberately (NOT auto-migrated to v4). Retain `postcss.config.js` with `tailwindcss` + `autoprefixer`; Next auto-detects PostCSS. Two themes live in the same config: the existing plum/stone **admin** aesthetic and a new dark editorial **public** theme (Playfair Display headings + Inter body via CSS vars). Migrating to Tailwind v4 `@theme` is a separate, out-of-scope CSS job.
- **Zustand 5** — the existing single studio store (`lib/store.ts`) is a client-only module singleton (with module-level debounce timers). Carried over verbatim with a `'use client'` directive; it persists across App Router client navigations, so the session-local queue survives nav.
- **lucide-react** — icons only, no emoji, on both surfaces.

**Why this stack split is correct:** the app has **no user accounts and no Supabase Auth sessions**. That means we explicitly do NOT need the `@supabase/ssr` cookie-syncing middleware / `createServerClient` with `getAll`/`setAll` — that machinery exists only to persist and refresh auth tokens, of which we have none. We need exactly two plain clients (public anon, admin service-role) and one shared secret. Copying the full SSR middleware pattern would add real complexity for zero benefit.

---

## The public/private split & the single-passphrase admin gate

### Why the gate must be server-side

The Supabase **anon key is public by design** — it ships to the browser as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. RLS is what makes that safe: the anon role gets `SELECT` only on published/visible rows and `INSERT` only on `collab_inquiries`. RLS is the entire read-side boundary.

For writes, the admin uses the **service-role key, which BYPASSES RLS entirely.** Therefore:

- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) and the admin passphrase (`ADMIN_SECRET`) are **plain, non-`NEXT_PUBLIC_` env vars**. They are read ONLY inside Route Handlers / Edge runtime and never ship to the browser.
- **The passphrase header check on each admin Route Handler is the only thing protecting a service-role (RLS-bypassing) client.** Hiding the `/admin` UI client-side protects nothing — anyone can `curl` the API directly. The server-side check is the real gate; the client gate is pure UX.

### The pattern (single shared secret, `x-admin-secret` header)

**Server side** — a tiny reused helper validates every admin write with a **constant-time compare** (never `===`, to avoid timing leaks), rejecting early with 401:

```ts
// lib/requireAdmin.ts
import { timingSafeEqual } from 'node:crypto'
export function requireAdmin(req: Request): Response | null {
  const got = req.headers.get('x-admin-secret') ?? ''
  const want = process.env.ADMIN_SECRET ?? ''
  const a = Buffer.from(got), b = Buffer.from(want)
  const ok = a.length === b.length && timingSafeEqual(a, b)
  return ok ? null : new Response('Unauthorized', { status: 401 })
}
```

Every admin Route Handler runs `const denied = requireAdmin(req); if (denied) return denied` **before** constructing the service-role client. Optionally also enforce in `middleware.ts` for all `/api/admin/*` as defense-in-depth — but the per-handler check is the true boundary (middleware can be bypassed under some misconfigurations).

**Client side** — `/admin` is a `'use client'` shell. On load it prompts once; on submit it test-fetches `GET /api/admin/verify` with the header. On 200, store the secret in **`sessionStorage`** (cleared when the tab closes — the pragmatic middle ground between annoying re-entry on every refresh and the over-exposure of `localStorage`). Every mutation then sends `x-admin-secret` as a **header**, never a query string (query strings leak into logs, history, and Referer).

**Hardening:** rate-limit the `verify` and admin routes (e.g. Upstash) — a single static secret in front of an RLS-bypassing client is a brute-force target. HTTPS only. Keep admin handlers on the **Node runtime** (so `crypto.timingSafeEqual` works); if any handler ever goes `edge`, switch to Web Crypto.

---

## Data model

All new tables follow the existing conventions: the single-row config pattern mirrors `app_settings (id=1)`; two-policy RLS (`public read` + `owner all`) where reads are public; UUID PKs + `sort_order` + `is_visible` for managed lists; `jsonb` for flexible nested structures. **Per user policy, migrations are authored as files and the user runs them — Claude never auto-runs DB writes.**

### `public_profile` — single-row mediakit config

```sql
id              int primary key default 1 check (id = 1)   -- single-row, app_settings pattern
display_name    text not null default ''                   -- 'simxmargo'
tagline         text default ''                            -- editorial subhead
bio_md          text default ''                            -- About section, markdown
avatar_url      text default ''                            -- portrait/hero (Storage public URL)
hero_image_url  text default ''                            -- optional full-bleed cover
location        text default ''
niche           text default ''                            -- 'fashion / lifestyle'
total_followers bigint                                     -- nullable; if null, computed as SUM(social_stats.followers)
rate_card       jsonb not null default '[]'::jsonb         -- [{deliverable, price, currency, note}]
press_logos     jsonb not null default '[]'::jsonb         -- [{name, logo_url, url}] 'as seen in'
theme           jsonb not null default '{}'::jsonb         -- accent overrides for dark theme
seo             jsonb not null default '{}'::jsonb         -- {title, description, og_image_url}
is_published    boolean not null default false             -- gates the public page; draft = admin-only
updated_at      timestamptz not null default now()
```
Seed with `insert (id) values (1) on conflict do nothing`.
**RLS:** policy `"public read published"` for `anon, authenticated` `using (is_published = true)`; policy `"owner all"` for `authenticated` `using (true) with check (true)`. Anon can never `INSERT`/`UPDATE`.

### `portfolio_brands` — one row per partnership in the public grid

```sql
id             uuid primary key default gen_random_uuid()
brand          text not null
website        text default ''                             -- normalized origin; feeds auto-create-from-URL
logo_url       text default ''                             -- og:image/favicon at create time, editable
blurb          text default ''                             -- og/meta description fallback, editable
campaign_title text default ''                             -- 'Spring Capsule 2026'
metrics        jsonb not null default '{}'::jsonb          -- {reach, impressions, views, engagement_rate, deliverables}
media          jsonb not null default '[]'::jsonb          -- [{type:'image'|'video'|'embed', url, thumb_url, platform}]
category       text default ''                             -- 'fashion','beauty' for filterable grid
featured       boolean not null default false              -- pin to top
sort_order     int not null default 0                      -- manual drag-order
is_visible     boolean not null default true               -- soft-hide
contact_id     uuid references contacts(id) on delete set null  -- OPTIONAL: promoted from an outreach contact
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```
**RLS:** `"public read visible"` `using (is_visible = true)`; `"owner all"` for `authenticated`. The `contact_id` FK is exposed as a bare uuid on public rows but **anon SELECT never joins to `contacts`** (which stays owner-only), so no contact data leaks.

### `social_stats` — per-platform follower/engagement, one row per platform

```sql
id              uuid primary key default gen_random_uuid()
platform        text not null check (platform in ('tiktok','instagram','facebook','youtube','x','twitch'))
handle          text not null default ''                   -- '@simxmargo'
profile_url     text default ''
followers       bigint not null default 0                  -- 2_700_000 etc.
avg_views       bigint                                     -- per-platform reach (enhancement)
engagement_rate numeric(5,2)                               -- percent
growth_30d      numeric(6,2)                               -- 30-day % change for sparkline
history         jsonb not null default '[]'::jsonb         -- [{date, followers}] snapshots
source          text not null default 'manual' check (source in ('manual','api'))
sort_order      int not null default 0
is_visible      boolean not null default true
synced_at       timestamptz                                -- last API sync (null while manual)
updated_at      timestamptz not null default now()
unique (platform)                                          -- one row per platform
```
**RLS:** `"public read visible"` `using (is_visible = true)`; `"owner all"` for `authenticated`. API sync writes go through an Edge Function via service-role (bypasses RLS), **never from anon**.
Seeds the source of truth: TikTok 2.7M, IG 1.3M, FB 394k → 4.4M total (`SUM(followers)`).

### `collab_inquiries` — the one anon write surface (public "Work with me")

```sql
id                  uuid primary key default gen_random_uuid()
name                text not null check (char_length(name) between 1 and 120)
email               text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')  -- DB-level shape check
company             text default '' check (char_length(company) <= 160)
budget              text default ''
message             text not null check (char_length(message) between 1 and 4000)
deliverables        text[] not null default '{}'           -- which rate-card items
source_path         text default ''                        -- which section it was submitted from
status              text not null default 'new' check (status in ('new','read','replied','archived','spam'))
promoted_contact_id uuid references contacts(id) on delete set null  -- set on convert-to-contact
ip_hash             text default ''                        -- hashed by Edge Function, never raw IP
user_agent          text default ''
created_at          timestamptz not null default now()
```
**RLS:** policy `"anon insert"` for `anon` `with check (status = 'new' and char_length(message) > 0)`; policy `"owner all"` for `authenticated`. **There is NO anon SELECT** — submissions are write-only to the public; only the owner can read/triage/delete. **Never add anon SELECT to this table.** Spam/rate-limit hardening (`ip_hash`, throttle, honeypot) lives in the `collab-submit` Edge Function via service-role; the bare anon INSERT policy is the minimal fallback surface.

### How existing tables relate

- **`contacts`** (existing, owner-only RLS, unchanged) is the spine of the outreach studio. Two new bridges reference it: `portfolio_brands.contact_id` (a closed deal promoted to a public case study) and `collab_inquiries.promoted_contact_id` (an inbound inquiry promoted into the outbound pipeline). Both are `on delete set null` so deleting a contact never breaks public rows.
- **`app_settings`** (existing, `id=1`) stays the home of the outbound email merge-fields + sending caps (`CreatorProfile`, daily cap). The **mediakit's public identity lives in `public_profile`, deliberately NOT in `app_settings`**, so the email template stays decoupled from the public page.

---

## Vite→Next migration (ordered steps + file moves + risks)

This is a **lift-and-shift** of the studio SPA into Next, preserving its client-only behavior. The public mediakit is built fresh on top (next sections). Frontend-only — **leave the Supabase project + migrations as-is; the user handles all git operations (no staging by Claude).**

### Ordered steps

1. **Baseline.** Confirm the current Vite app builds (`npm run build`) and runs on 5174 before touching anything.
2. **Install Next.** Add `next@^16` (and optionally `eslint-config-next@^16`); remove `vite@^5.4.10` + `@vitejs/plugin-react@^4.3.3` from deps.
3. **Create `app/`.** Add `app/layout.tsx` (RootLayout `html`/`body`, `import './globals.css'`, `metadata`, favicon/app icon). Move `src/index.css` → `app/globals.css`.
4. **Move shared non-UI modules into `lib/` first.** `supabase.ts`, `store.ts`, `emailTemplate.ts`, `types.ts`, `mock/contacts.ts`. Set up the `@/*` path alias. Add `'use client'` to `store.ts`.
5. **Fix env access.** In `lib/supabase.ts` swap `import.meta.env.VITE_*` → `process.env.NEXT_PUBLIC_*`; rename the two vars in `.env` + `.env.example`; delete `src/vite-env.d.ts` (optionally add `env.d.ts` typing the `NEXT_PUBLIC_` vars on `NodeJS.ProcessEnv`). Keep `isSupabaseConfigured` + null fallback exactly.
6. **Move the 6 components into `components/`.** Add `'use client'` to `Sidebar`, `ComposeDrawer`, `ContactsTable`, `FilterBar`. Leave `StatsBar` + `StatusBadge` directive-free (pure presentational).
7. **Move the 3 pages into `components/pages/`** and add `'use client'`. **Defer** the optional `/contacts` `/queue` `/settings` route split.
8. **Port `App.tsx`** into a `'use client'` app shell rendered by `app/page.tsx` (keep the `useState<Page>` switch + `useEffect(hydrate)` verbatim). Delete `src/main.tsx`, `src/App.tsx`, `index.html`, `vite.config.ts`.
9. **Update `tsconfig.json`**: `jsx: 'preserve'` (Next requires preserve, NOT `react-jsx`), keep `moduleResolution: 'bundler'`, add `plugins: [{ name: 'next' }]`, `incremental: true`, `allowJs: true`, `baseUrl: '.'` + `paths { '@/*': ['./*'] }`, include `next-env.d.ts` + `.next/types/**/*.ts`, remove `allowImportingTsExtensions` and the `vite.config.ts` include. Update `tailwind.config.js` `content` to `['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}','./lib/**/*.{ts,tsx}']`; keep the `extend` block (Fraunces/Inter, plum palette) verbatim. Keep `postcss.config.js` for Tailwind v3.
10. **Update `package.json` scripts**: `dev` → `next dev -p 5174` (preserve the port), `build` → `next build`, `start` → `next start -p 5174`. Keep `typecheck` (`tsc --noEmit`) and **all `sb`/`db:*` scripts unchanged**.
11. **Verify on 5174**: contacts table renders mock data; filters/stats work; ComposeDrawer opens + adds to queue; queue badge updates; Settings edits update the store (and debounce-write when `NEXT_PUBLIC_*` is set); daily-cap meter works. Confirm BOTH the no-env mock path and the env-set live path behave as before.
12. **Leave `supabase/` and `scripts/` untouched.** Hand off to the user for git.

### Key file moves

| From | To | Note |
|---|---|---|
| `src/main.tsx` | `app/layout.tsx` + `app/page.tsx` | **DELETE.** RootLayout owns the HTML shell + `globals.css` import; StrictMode is on by Next default. |
| `src/App.tsx` | `app/page.tsx` (`'use client'`) | Keep the in-memory `useState<Page>` switch + `useEffect(hydrate)` verbatim. Route-split is an OPTIONAL follow-up, not the lift. |
| `src/lib/supabase.ts` | `lib/supabase.ts` | `import.meta.env.VITE_*` → `process.env.NEXT_PUBLIC_*`. Stays a browser/anon client (imported by the client store). |
| `src/lib/store.ts` | `lib/store.ts` (`'use client'`) | Module-level `pendingSettings`/`settingsTimer` debounce + `create()` singleton are client-only — **never import from a Server Component.** |
| `src/lib/emailTemplate.ts` | `lib/emailTemplate.ts` | Pure (`buildDraft`); move as-is. |
| `src/types.ts` | `lib/types.ts` | Pure types; update import paths to `@/*`. |
| `src/mock/contacts.ts` | `lib/mock/contacts.ts` | Pure data; update import in store. |
| `src/pages/*` | `components/pages/*` (`'use client'`) | Logic unchanged. |
| `src/components/Sidebar/ComposeDrawer/ContactsTable/FilterBar.tsx` | `components/*` (`'use client'`) | Interactive — directive required. Sidebar exports the `Page` type. |
| `src/components/StatsBar/StatusBadge.tsx` | `components/*` | Pure presentational — no directive. |
| `src/index.css` | `app/globals.css` | Move verbatim; `#root` selector is now dead (harmless / retarget to `body`). Imported once in `layout.tsx`. |
| `index.html` | `app/layout.tsx` metadata + `app/icon.svg` | **DELETE.** `<title>` → metadata; SVG data-URI favicon → `app/icon.svg`. |
| `vite.config.ts` | `next.config.ts` | **DELETE.** Only meaningful setting was port 5174 → preserved via the `-p` flag. Near-empty default config. |
| `src/vite-env.d.ts` | (deleted; `next-env.d.ts` auto-generated) | **DELETE.** |

### Migration risks

- **The whole studio is client-side by design.** If `store.ts` or `supabase.ts` is accidentally imported by a Server Component (e.g. from `layout.tsx` or a server page), you get `createContext is not a function`-style errors / hydration mismatches. **Mitigation:** keep the app shell + every store-touching page/component `'use client'`; never import the store from a server module.
- **Do NOT move the studio reads server-side in this lift.** `supabase.ts` uses the anon key and is meant to run in the browser (RLS-guarded); `hydrate()` runs in a client `useEffect`. Moving it server-side would change the mock-fallback timing and the `'use client'` boundary. Defer any server-side fetching to a later phase. (The PUBLIC mediakit reads ARE server-side — that's a separate, new code path, not the studio.)
- **Silent mock fallback.** The store inits synchronously with `mockContacts`, then `hydrate()` swaps to live data ONLY if `NEXT_PUBLIC_*` are set + reachable. If the env vars aren't renamed correctly, the app silently stays on mock data — identical symptom to today, easy to misdiagnose. Verify `isSupabaseConfigured` reflects the renamed vars. (`NEXT_PUBLIC_*` are inlined at build time → changing them needs a rebuild.)
- **`import.meta.env` is Vite-only** and throws/undefined under Next. The two reads in `lib/supabase.ts` MUST become `process.env.NEXT_PUBLIC_*`.
- **Tailwind v3 vs Next-16 scaffolding** assumes v4 (`@tailwindcss/postcss`). Keep v3 by retaining `postcss.config.js` and not letting `create-next-app` overwrite it. v4 migration is out of scope.
- **Google Fonts `@import` in globals.css** works but is render-blocking. Leaving it is lower-risk; switching to `next/font/google` (Inter + Fraunces, no-FOUT) is optional polish that also needs `tailwind` `fontFamily` rewired to CSS variables.
- **`ComposeDrawer`** renders a fixed full-screen overlay via plain DOM (no portal). Verify after adding `'use client'` that backdrop click-to-close and the `z-30` overlay still mount/behave.
- **OUT OF SCOPE, untouched:** `supabase/` (Deno functions, migrations, `apply_all.sql`) and `scripts/` (`sb.mjs`, `db-apply.mjs`). Referenced only by `db:*` scripts (which stay). Do NOT convert them to Next route handlers.

---

## Auto-create-brand-from-URL (reusing scrape helpers)

A new **`scrape-meta` Edge Function** reuses the existing `supabase/functions/_shared/scrape.ts` helpers verbatim so behavior matches the studio scraper:

1. Admin pastes a brand URL into **`AddBrandByUrl`**.
2. The function calls **`normalizeDomain(url)`** (the exact same parser the studio scraper uses) to get the canonical host, then **`fetchText(pageUrl(domain, '/'))`** with the shared **`USER_AGENT`**, the same **8s `AbortSignal.timeout`**, and the html/text content-type guard copied from `scrape-static`.
3. It parses the fetched HTML for:
   - `og:image` → `logo_url`, with `<link rel=icon>` / `apple-touch-icon` then `/favicon.ico` as fallbacks;
   - `og:description` or `meta[name=description]` → `blurb`;
   - `og:title` or `<title>` → `brand` / `campaign_title`.
   These go in **small pure regex extractors added alongside `extractEmails`/`classifyEmail` in `_shared/scrape.ts`** (e.g. `extractMeta` / `extractOgImage` / `extractFavicon`) so they're equally testable and shared.
4. It **returns a draft** `{ brand, website: domain, logo_url, blurb, campaign_title }` and **does NOT write to the DB**.
5. The admin reviews/edits in a prefilled **`BrandEditor`** (loading + error states) and saves, inserting the `portfolio_brands` row (owner-authenticated → in our model, via the `x-admin-secret`-gated `/api/admin/portfolio` Route Handler using service-role).
6. **`robots.txt` is respected** via the same `parseDisallowed`/`isPathAllowed` helpers as a courtesy.
7. **Optional loop-closing:** if the pasted URL matches an existing `contacts.website`, prefill `contact_id` to link the partnership back to its outreach origin.

New network/parse code is minimal; domain-normalization and fetch etiquette are reused verbatim.

---

## Social API integration (phased)

**Phase 1 (now): manual entry only.** `SocialStatsEditor` writes `social_stats` rows with `source='manual'`; the public page reads them via anon SELECT. Ships immediately with zero platform-API dependency and is the source of truth for TikTok 2.7M / IG 1.3M / FB 394k. Each save appends a `{date, followers}` snapshot to `history`, so the growth chart fills over time for free.

**Phase 2 (auto-sync, later): a `sync-social` Edge Function**, invoked by `pg_cron` (same drain pattern as the existing `scrape-static`), calls each platform API with **service-role** to UPSERT `social_stats` by `platform`, setting `source='api'`, stamping `synced_at`, and appending to `history`. Pre-Phase-2 requirements to flag:

- **Instagram + Facebook**: a Meta App + a Business/Creator account linked to a Facebook Page + the Instagram Graph API (`instagram_basic` / `instagram_manage_insights`), requiring **Meta App Review** for production. `follower_count` is on the IG Business Account node; `fan_count` on the Page for Facebook.
- **TikTok**: a TikTok for Developers app + Login Kit / Display API (or Research API); `follower_count` via the `user.info` scope, also requiring **app approval**.
- **All tokens** (long-lived Meta tokens, TikTok refresh tokens) stored **server-side only**, used exclusively by the Edge Function via service-role, never exposed to anon or the browser.

**Because review/approval can take weeks, the manual path stays permanently supported** — the kit is never blocked on API access. `source='manual'` rows are simply never overwritten by a sync, and the last manual value is the fallback if a sync fails.

---

## UX / component breakdown

### Public mediakit (dark editorial theme — Playfair headings + Inter body, Lucide/SVG icons, no emoji, 200–300ms GSAP/Lenis-style reveals, prefers-reduced-motion aware)

- **`MediaKitLayout`** — public route shell, totally separate from the admin app. Sets the dark theme via CSS vars, injects SEO/OG meta from `public_profile.seo`, renders one long scroll of sections with staggered reveals.
- **`HeroSection`** — `display_name` (Playfair), `tagline`, avatar/hero image, location/niche, aggregate follower count via `FollowerCounter` (4.4M total). CTAs: "Work with me", "Download media kit".
- **`FollowerCounter`** — animated count-up stat block, one per `social_stats` row plus the computed total. Platform icon (Lucide/custom SVG for TikTok), handle, formatted count (2.7M), optional `GrowthSparkline`.
- **`SocialStatsStrip`** — horizontal band of `FollowerCounter`s across platforms, each linking to the live profile; computes/displays `SUM(followers)` as the "X total reach" headline.
- **`GrowthSparkline`** — tiny pure-SVG line/area chart per platform from `social_stats.history` + a `growth_30d` badge. **Enhancement over beacons** (static counts). No chart lib.
- **`PortfolioGrid`** — masonry/editorial grid of `BrandCard`s from visible `portfolio_brands` (featured first, then `sort_order`), with **`CategoryFilter` chips** for client-side filtering + staggered scroll reveal.
- **`BrandCard`** — logo, brand, campaign title, **hover-revealed metrics** (reach/views/engagement). Click → `BrandCaseStudy`. Dark card, subtle border, hover-lift.
- **`BrandCaseStudy`** — modal/expand: full blurb, metrics grid, and `MediaShowcase` of embedded content. **Editorial enhancement beacons lacks.**
- **`MediaShowcase`** — renders `portfolio_brands.media`: images (SafeImage-style `<img>`), videos, lazy-loaded platform embeds (TikTok/IG/YT iframes). Turns a logo wall into a real portfolio.
- **`AboutSection`** — `public_profile.bio_md` (markdown) in an editorial column with the portrait + optional `press_logos` "as seen in" strip.
- **`RateCardSection`** — `public_profile.rate_card` as a clean pricing list; each row pre-selects into the `WorkWithMeForm` deliverables. **Enhancement over beacons.**
- **`WorkWithMeForm`** — posts to `collab_inquiries` via the **`collab-submit` Edge Function** (honeypot + `ip_hash` rate-limit; direct anon INSERT as fallback). Fields: name, email, company, budget, deliverables (from rate card), message. Client validation mirrors the DB CHECKs. Success/error toast.
- **`DownloadKitButton`** — downloadable PDF media kit generated from live data (client-side or Edge Function). **Enhancement over beacons.** Lucide `Download` icon.
- **`MediaKitFooter`** — social links, contact email, subtle "built by". **No admin links exposed.**

### Admin studio (existing plum/stone aesthetic, distinct from public dark theme; passphrase-gated)

- **`AdminLayout` / `AdminSidebar`** — replaces the flat 3-item Sidebar with **two nav groups**: a **Media Kit** group (Profile & Brand, Portfolio, Social Stats, Inquiries) and an **Outreach Studio** group (Contacts, Send Queue, Settings) that **NESTS the existing pages verbatim**.
- **`ProfileEditor`** — edits the single `public_profile` row: display_name, tagline, `bio_md` (markdown editor), avatar/hero upload (Storage), location/niche, SEO meta, theme accent, the **`is_published` publish/unpublish toggle** with a "View public kit" link.
- **`RateCardEditor`** — CRUD over `rate_card` + `press_logos` jsonb arrays (add/reorder/remove deliverable+price rows and logos).
- **`PortfolioManager`** — admin grid/list of `portfolio_brands` with drag-to-reorder (`sort_order`), featured/visible toggles, edit, delete. Houses `AddBrandByUrl` + `BrandEditor`. Follows the user's **shared-list convention (paginated list + filter chips)** as it grows.
- **`AddBrandByUrl`** — paste a brand URL → calls `scrape-meta` → shows a prefilled `BrandEditor` draft for review before save, with loading + error states.
- **`BrandEditor`** — one `portfolio_brands` row: brand, website, logo (auto or manual upload), blurb, campaign_title, category, metrics, and a `MediaManager` for the `media[]` showcase. Optional "link to outreach contact" selector (sets `contact_id`).
- **`SocialStatsEditor`** — table of `social_stats`: per-platform handle/url/followers/avg_views/engagement, manual entry. Shows `source`/`synced_at` + a (disabled-until-wired) "Sync from API" button per platform. Appends a `history` snapshot on save.
- **`InquiriesInbox`** — reads `collab_inquiries` (owner SELECT). Triage list with `status` (new/read/replied/archived/spam), detail view, and a **"Promote to outreach contact"** action that inserts into `contacts` (setting `promoted_contact_id`) — the inbound→outbound bridge. Paginated per convention.
- **`ContactsPage` / `QueuePage` / `SettingsPage`** (existing) — reused **as-is**, nested under the Outreach Studio group. No change to scraping/scoring, send queue, or `app_settings` email/cap settings.

### Concrete enhancements over beacons

1. Interactive brand grid with **per-campaign metrics** (hover reveal + full case study on click) vs beacons' static logos.
2. **Per-platform growth** sparkline + 30-day % badge from `history` snapshots (fills over time for free).
3. **Embedded content showcase** (real TikTok/IG/YT embeds + imagery) — an actual portfolio, not a logo wall.
4. **Rate Card** that pre-selects into the work-with-me form.
5. **Downloadable PDF media kit** from live data.
6. **Inbound→outbound loop** (inquiry→contact, contact→case study) — the two surfaces reinforce each other.
7. **Animated accessible count-up** counters with a live SUM headline (4.4M), reduced-motion aware.
8. **Filterable portfolio** by category with staggered reveals.
9. **Draft/publish workflow** — anon literally cannot read an unpublished kit (RLS-gated).
10. **SEO/OG control** so cold-pitch links render rich previews.
11. **Spam-hardened public form** (Edge Function + honeypot + `ip_hash` + DB CHECKs) instead of a raw open insert.
12. **Press / "as seen in"** logo strip for social proof.

### Public SEO / OG wiring (App Router, Next 16)

- **`app/layout.tsx`**: set `metadataBase: new URL('https://simxmargo.com')` (REQUIRED — else OG/Twitter image URLs resolve to localhost and share cards break in prod) + default `title`/`openGraph`/`twitter: { card: 'summary_large_image' }`.
- **`app/page.tsx`**: async `generateMetadata()` fetching the kit via the anon client → `title`, `description`, `openGraph`, `alternates: { canonical: '/' }`. (`params`/`searchParams` are **Promises in Next 16 — `await` them.**)
- **`app/opengraph-image.tsx`**: `size = { width:1200, height:630 }`, `contentType='image/png'`, a default `Image()` returning `new ImageResponse(<JSX/>, { ...size })` from `next/og`. Next **auto-injects** the `og:image`/`twitter:image` tags — **do NOT also hand-write `openGraph.images` at it** (duplicate tags). `ImageResponse` uses Satori: inline styles only, explicit `display:'flex'` on multi-child containers, custom fonts via `fetch` + the `fonts` option.
- **`app/robots.ts`** (allow all, point at sitemap) + **`app/sitemap.ts`** (`[{ url:'https://simxmargo.com', lastModified }]`).
- **JSON-LD** `Person`/`Organization` `<script type="application/ld+json">` in the page (server-rendered so crawlers see real HTML).
- Validate with Facebook Sharing Debugger / X Card Validator after deploy.

### Public reads + freshness gotcha

Supabase queries are **not** Next `fetch`, so they aren't auto-cached/deduped by the fetch cache. On the public page use **`export const revalidate = 60`** (ISR) or `unstable_cache`/`cacheLife` to control freshness — otherwise reads run on every request. Keep the anon client out of any write path; keep the service-role client out of any Server Component that renders to a client.

---

## Phased build order (UI-first; backend seams as TODOs)

Per the team's UI-first preference, ship visible shells first and leave clearly-marked `// TODO(simxmargo-backend)` seams; backend design is captured here and in a repo `docs/BACKEND_DESIGN.md`. **No DB auto-runs — migration files are authored and the user applies them.**

- **Phase 0 — Migration lift-and-shift.** Execute the Vite→Next steps above. Studio runs identically on Next at port 5174 against mock data. No new features. Hand off for git.
- **Phase 1 — Public mediakit UI shell (mock data).** Build `MediaKitLayout` + all public components against a local mock of `public_profile` / `social_stats` / `portfolio_brands`. Wire the dark theme, reveals, count-ups, portfolio grid, case-study modal, rate card, footer. SEO/OG file conventions in place (static OG card first). `WorkWithMeForm` renders + validates client-side but POSTs to a stubbed handler. **Seam:** `// TODO(simxmargo-backend): replace mock with anon SELECT`.
- **Phase 2 — Admin shell + passphrase gate.** Add `AdminLayout` two-group nav nesting the existing studio pages. Build the `AdminGate` (sessionStorage + `GET /api/admin/verify`) and the `requireAdmin` helper. Build the NEW admin editors (`ProfileEditor`, `RateCardEditor`, `PortfolioManager`, `SocialStatsEditor`, `InquiriesInbox`, `BrandEditor`) as UI against mock/stub fetches. **Seam:** all mutations call `/api/admin/*` stubs.
- **Phase 3 — Data model + RLS (migration files).** Author the four migration files (`public_profile`, `portfolio_brands`, `social_stats`, `collab_inquiries`) with the two-policy RLS + seeds. Deliver to the user to apply (`db:*` scripts). Add `lib/supabase/public.ts` (anon, server) + `lib/supabase/admin.ts` (service-role, server-only).
- **Phase 4 — Wire public reads + the collab write.** Swap the public page mocks for real anon SELECTs in Server Components with `revalidate=60`; make `generateMetadata` data-driven; make `opengraph-image` data-driven if desired. Implement the `collab-submit` Edge Function (honeypot + `ip_hash`) and point `WorkWithMeForm` at it (direct anon INSERT fallback).
- **Phase 5 — Wire admin writes.** Implement every `/api/admin/*` Route Handler (service-role + `requireAdmin`), rate-limit `verify`/admin routes. Connect all editors. Connect the inbound→outbound promote actions (inquiry→contact, contact→portfolio).
- **Phase 6 — Auto-create-from-URL.** Add the shared `extractMeta`/`extractOgImage`/`extractFavicon` helpers to `_shared/scrape.ts`; build the `scrape-meta` Edge Function reusing `normalizeDomain`/`fetchText`/`USER_AGENT`/robots helpers; wire `AddBrandByUrl` → prefilled `BrandEditor`.
- **Phase 7 — Enhancements + polish.** `GrowthSparkline` from `history`, `MediaShowcase` embeds, `DownloadKitButton` PDF, JSON-LD, sitemap/robots finalization, share-card validation, optional `next/font/google` swap.
- **Phase 8 (later, unblocked) — Social API auto-sync.** Meta + TikTok app review, the `sync-social` Edge Function + `pg_cron`, server-only token storage. Manual path stays permanently as fallback.

---

## Open questions

1. **Public route placement** — root `/` (cleanest for a creator domain; assumed throughout) vs `/mediakit`? The OG/sitemap/canonical wiring above assumes root.
2. **Admin route shape** — keep the faithful in-memory `useState<Page>` switch under a single `/admin` (matches the lift-and-shift), or split into real `/admin/profile`, `/admin/portfolio`, etc. sub-routes? Zustand's singleton survives client nav either way, but sub-routes change deep-link/back-button semantics.
3. **PDF generation** — client-side (e.g. `@react-pdf` / canvas) vs an Edge Function rendering server-side? Affects whether `DownloadKitButton` needs a backend seam in Phase 1.
4. **Markdown rendering** — which renderer/sanitizer for `bio_md` on the public page (must sanitize since it's owner-authored but rendered to anon)?
5. **Rate-limiting infra** — Upstash (assumed) vs another store for the `verify`/admin and `collab-submit` throttles? Needs an account/env.
6. **Storage bucket policy** — confirm a public Storage bucket for avatar/hero/logo with appropriate upload policy (writes via service-role through admin routes; reads public).
7. **Passphrase rotation / multiple admins** — single static `ADMIN_SECRET` is assumed (no accounts). Is rotation-on-demand or a second operator ever needed? If so, this is the point to reconsider Supabase Auth.
8. **`total_followers` source of truth** — always compute `SUM(social_stats.followers)` (assumed), or allow the manual `public_profile.total_followers` override to win when set?
9. **Embed privacy/perf** — third-party TikTok/IG/YT embeds set cookies and hurt LCP. Lazy-load + facade thumbnails (assumed) — confirm acceptable, and whether a consent banner is needed for the target markets.
10. **Tailwind v4** — confirm we stay on v3 for the foreseeable future (the two-theme config above assumes v3); a v4 migration would move the plum + dark palettes to `@theme` and is a separate effort.