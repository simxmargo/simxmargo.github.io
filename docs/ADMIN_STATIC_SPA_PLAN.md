# Plan: Admin → static Supabase-Auth SPA on GitHub Pages (no server, no Vercel)

**Status:** PLAN — RLS migration written; code execution pending review · **Created:** 2026-06-28

## Goal

Make `/admin` a **browser-only SPA** that the influencer can reach at
`https://simxmargo.github.io/admin`, log into with **one password**, and edit the
media kit — with **no server**, **no Vercel**, on the existing GitHub Pages + Supabase
stack. The public site and the admin both ship in the static export.

## Non-negotiables (security)

1. **The `SERVICE_ROLE_KEY` never reaches the browser.** All privileged writes are
   gated by **RLS** tied to the authenticated admin — not by a key in the bundle.
2. **Every write is `is_admin()`-gated at the database.** The login UI is a convenience;
   RLS is the actual boundary. Even if someone reaches `/admin`, they can do nothing
   without a session whose `auth.uid()` is in the `admins` table.
3. **Server-only work moves to Edge Functions**, which verify the caller is the admin
   before doing anything, and keep the service role on the server side.

---

## Target architecture

```
Browser (GitHub Pages static)
 ├─ /            public media kit  → anon Supabase reads (published/visible rows, RLS)
 └─ /admin       SPA → Supabase Auth login (1 password)
        ├─ CRUD  → supabase-js direct, authed session, RLS = is_admin()
        ├─ uploads → supabase.storage 'media' bucket, RLS = is_admin()
        └─ scraping/re-host → Supabase Edge Functions (verify admin JWT, then fetch + service-role)
```

Removed entirely: `app/api/**` (all 14 routes), `lib/requireAdmin.ts`,
`lib/adminClient.ts` (passphrase/`x-admin-secret`), `components/admin/AdminGate.tsx`,
`lib/supabase/admin.ts` (service-role in Node). The passphrase model is gone.

---

## Auth model — "one password," done securely

- **Supabase Auth**, email+password provider. **ONE** admin account (you create it).
- The login screen shows a **single password field**; the admin email is hardcoded in
  the bundle (it is not a secret), so the influencer only ever types a password →
  `supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password })`.
- Session persists in the browser (localStorage) → she stays logged in across visits
  until it expires; Supabase auto-refreshes.
- **Disable public signups** in Supabase Auth settings (defense-in-depth — even if left
  on, a self-registered user isn't in `admins`, so `is_admin()` = false → zero access).
- Identity for RLS: a `public.admins(id uuid)` table + a `SECURITY DEFINER`
  `public.is_admin()` helper. One row = the influencer's `auth.uid()`.

---

## RLS design (migration `0007_admin_rls.sql` — review THIS first)

Replaces every `owner all ... using(true)` with `is_admin()`. Table by table:

| Table | anon | admin (`is_admin()`) |
|-------|------|----------------------|
| `public_profile` | SELECT where `is_published` *(keep)* | ALL |
| `portfolio_brands` | SELECT where `is_visible` *(keep)* | ALL |
| `social_stats` | SELECT where `is_visible` *(keep)* | ALL |
| `collab_inquiries` | INSERT `status='new'` *(keep)* | SELECT/UPDATE/DELETE |
| `contacts` | — | ALL |
| `app_settings` | — | ALL |
| `scrape_jobs` / `send_queue` / `suppression_list` | — | ALL |
| `storage.objects` (bucket `media`) | SELECT | INSERT/UPDATE/DELETE |

`is_admin()` is `SECURITY DEFINER` so it can read `admins` past that table's own RLS,
and returns `exists(select 1 from admins where id = auth.uid())`.

**You apply it** (security-critical → review then run `npm run db:apply`), then seed your
uid (one SQL line, after creating the auth user — included as a comment in the migration).

---

## Storage

Bucket `media` (already used: folders `portraits`/`logos`/`favicon`/`uploads`,
public-read). Client-side upload replaces `/api/admin/upload`:
`supabase.storage.from('media').upload(path, file)` from the authed client. The 8 MB
cap + MIME allowlist move to client-side validation; the **bucket RLS** (`is_admin()`
INSERT) is the real enforcement. `ImageField` + `StudioImageSlot` switch to this.

---

## Data-layer rewrite (CRUD: route → direct supabase-js)

Replace `lib/adminClient.ts` (`adminFetch`/`x-admin-secret`) with `lib/supabase/browser.ts`
(anon key, `persistSession: true`). Rewrite `lib/admin/queries.ts` so `useAdminResource`
and the mutations call supabase-js directly (same React-Query keys, so components barely
change). Call-sites:

| Component | Was | Becomes (authed, RLS-gated) |
|-----------|-----|------------------------------|
| `ProfileEditor` | PUT `/api/admin/profile` | `supabase.from('public_profile').update(...).eq('id',1)` |
| `ThemeEditor` | PUT `/api/admin/profile` (theme) | same row, `theme` field |
| `PortfolioManager` | POST/PUT/DELETE `/api/admin/brands` (+bulk reorder) | `from('portfolio_brands')` insert/update/delete + reorder |
| `SocialStatsEditor` | PUT `/api/admin/socials` | `from('social_stats').update/upsert` |
| `InquiriesInbox` | GET/PATCH `/api/admin/inquiries` | `from('collab_inquiries').select/update` |
| `SettingsPage` | PUT `/api/admin/settings` | `from('public_profile')` + `from('app_settings')` |
| `ContactsPage` (via `lib/store.ts`) | GET/PATCH `/api/admin/contacts` | `from('contacts').select/update` |

The follower-metric derivation (was in the profile route) moves to a small client helper
over the already-fetched `social_stats`.

---

## Edge Functions (the 6 server-only routes)

These do external `fetch`/SSRF-guard/`Buffer`/streaming and **cannot** run in a browser
(CORS + Node). Port to Deno under `supabase/functions/`, each verifying the caller:

```
verify admin → const sb = createClient(URL, ANON, { global:{ headers:{ Authorization: req.header } }})
               if (!(await sb.rpc('is_admin')).data) return 403
            → do the external fetch + (re-host/write) with service-role
```

| New function | From | Notes |
|--------------|------|-------|
| `scrape-meta` | `app/api/admin/scrape-meta` | port `lib/scrape/meta.ts`; keep SSRF guard |
| `social-scrape` | `app/api/admin/socials/scrape` | port `lib/social/scrape.ts` |
| `brand-fetch-post` | `brands/fetch-post` | TikTok oEmbed + thumb re-host → Storage |
| `brand-pull-videos` | `brands/pull-videos` | `lib/social/profileVideos.ts` + `rehost` |
| `brand-add-videos` | `brands/add-videos` | re-host + commit media |
| `brand-cover-proxy` | `brands/cover-proxy` | image proxy (can stay public; CORS) |

Deploy: `npm run sb -- functions deploy <name>`. The admin client calls them via
`supabase.functions.invoke('<name>', { body })` (Authorization auto-attached).

---

## Public page stays live after edits

Static export = build-time snapshot, so without a change the influencer would edit and
**not see it** until a rebuild. Fix: keep `app/page.tsx` rendering the build-time
snapshot (SEO/first paint) **and** wrap the content in a client component that re-fetches
live Supabase on mount (`initialData` + refresh). Crawlers get the snapshot; she sees her
edits on reload — no rebuild, no "Publish" button needed.

---

## Export / deploy changes

- **Delete** `app/api/**` (replaced). The collab form posts to the `collab` Edge
  Function (already built) via `NEXT_PUBLIC_COLLAB_ENDPOINT`.
- `pages.yml` carve-out shrinks to just `rm -rf app/opengraph-image.tsx` (admin now ships;
  api is gone). `/admin` becomes part of the static export.
- `next.config.ts` export config unchanged.

---

## Phase order (build green at each phase; nothing pushed until you approve)

0. **RLS migration `0007`** (written) — you review + `db:apply` + create the auth user + seed `admins`.
1. **Auth foundation** — `lib/supabase/browser.ts`, `AdminLogin` (replaces `AdminGate`), session/logout.
2. **CRUD rewrite** — `queries.ts` + the 7 editors → direct supabase-js. *(Parallelizable.)*
3. **Uploads** — `ImageField`/`StudioImageSlot` → `storage.upload`.
4. **Edge Functions** — the 6 server-only ports + admin-JWT check; deploy.
5. **Public live data** — snapshot + client refresh.
6. **Cleanup + export** — delete `app/api`, `requireAdmin`, `adminClient`, `AdminGate`, `supabase/admin.ts`; update `pages.yml`; `typecheck` + local export build.
7. **You push** → `/admin` live at `simxmargo.github.io/admin`.

---

## Your action items (only you can do these)

1. **Supabase → Authentication → Users → Add user**: create the admin (email + a strong
   password you give the influencer). Note the user's UID.
2. Review `supabase/migrations/0007_admin_rls.sql`, then `npm run db:apply`.
3. Seed admin: `insert into public.admins (id) select id from auth.users where email='<that email>';`
4. **Supabase → Authentication → Providers/Settings**: disable public sign-ups.
5. Later (phase 4): `npm run sb -- functions deploy ...` for the 6 functions.

---

## Risks / must-fix flags

- **RLS correctness (must-fix):** one wrong `is_admin()` policy = lockout or public
  write. The migration is small + reviewed before apply for exactly this reason.
- **No brute-force lockout (consider):** the password is the only barrier on a public
  URL. Mitigation: a long random password + Supabase's built-in auth rate-limiting.
  Optionally add an `hcaptcha`/Turnstile on the login later.
- **Edge function auth (must-fix):** every function must `is_admin`-check before any
  fetch/write — otherwise it's an open SSRF/proxy. The cover-proxy stays read-only.
- **Live site is untouched until you push** — current Pages deploy keeps working
  throughout; this all builds locally first.
