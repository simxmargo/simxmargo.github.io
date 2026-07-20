# Deploy the public media kit to GitHub Pages

**Status:** IMPLEMENTED (code/config done; user ops + commit pending) · **Created:** 2026-06-26
**Decision:** host the **public media kit only** on GitHub Pages; keep the admin +
API on a real server (local `next dev`, or a Next host later).

---

## ✅ FINAL PLAN — decided 2026-06-26

**URL:** `https://simxmargo.github.io/` — a **free GitHub Organization** named
`simxmargo` with a repo named **`simxmargo.github.io`**. Root-served, so **no
`basePath`**, no username in the URL, no custom domain / DNS. (`simxmargo` was
confirmed available as an org name.) Trade-off: the Pages repo must be **public**
(secrets stay safe — `.env`/`.mcp.json` are gitignored and never committed).

**Code/config already implemented in this repo (ready to commit):**
- `next.config.ts` — `EXPORT_STATIC=1` → `output:'export'` + `images.unoptimized`.
- `lib/siteUrl.ts` — `SITE_URL`/`SITE_HOST` from `NEXT_PUBLIC_SITE_URL`
  (default `https://simxmargo.github.io`); wired into `layout.tsx` (`metadataBase`),
  `sitemap.ts`, `robots.ts`, `page.tsx` (JSON-LD). One var swaps to a custom domain later.
- `app/page.tsx` — static `openGraph.images:['/og.png']` **only** when `EXPORT_STATIC=1`
  (no duplicate OG tags locally, where `opengraph-image.tsx` still runs).
- `public/og.png` — static 1200×630 share card (replace anytime). `public/.nojekyll`.
- `components/mediakit/RateAndContact.tsx` — collab form posts to
  `NEXT_PUBLIC_COLLAB_ENDPOINT || '/api/collab'`.
- `supabase/functions/collab/index.ts` — Edge Function port of `/api/collab`
  (honeypot + validation + IP hash, anon insert).
- `.github/workflows/pages.yml` — carve out `app/api`+`app/admin`+`opengraph-image.tsx`,
  `EXPORT_STATIC=1 next build`, publish `out/`.
- `.env.example` — documents `NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_COLLAB_ENDPOINT`.

**Your steps (only you can do these), in order:**
1. Create a free GitHub **organization** named `simxmargo`.
2. **Transfer** `kitdaniellim/simxmargo` into the org (Settings → *Transfer ownership*
   — keeps all history), then **rename** the repo to `simxmargo.github.io`
   (Settings → repo name). *(Or make a fresh `simxmargo/simxmargo.github.io` and push.)*
   Ensure the repo is **public**.
3. Repoint your local remote:
   ```bash
   git remote set-url origin https://github.com/simxmargo/simxmargo.github.io.git
   git remote -v
   ```
4. Repo **Settings → Secrets and variables → Actions** → add two secrets (values are
   in your local `.env`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   *(Both are publishable/anon — if absent the build still works but shows mock data.)*
5. Repo **Settings → Pages → Source = GitHub Actions**.
6. Deploy the collab function: `npm run sb -- functions deploy collab --no-verify-jwt`.
7. Commit the new/changed files and `git push -u origin master` → watch the Action →
   visit `https://simxmargo.github.io/` and test the "Work with me" form.

> The detailed design rationale below predates the final URL decision; where it
> mentions a custom domain or `basePath`, the org-site route above supersedes it.

---

## 0. Why this is a refactor, not a config flip

`simxmargo` is a **full-stack Next.js 16 app**, and GitHub Pages serves **static files
only — there is no server runtime.** Three things in this app require a server and
therefore cannot run on Pages:

| Feature | File(s) | Needs a server because… |
|---------|---------|--------------------------|
| 14 API route handlers | `app/api/**` | `export async function GET/POST/…` execute server-side (service-role writes, scraping, uploads). |
| Dynamic OG image | `app/opengraph-image.tsx` | `next/og` `ImageResponse` runs in a server/edge runtime at request time. |
| ISR | `revalidate` in `app/page.tsx`, `opengraph-image.tsx` | "Re-fetch every N seconds" requires a server to re-render. |

`next build` with `output: 'export'` will **hard-error** the moment it hits a route
handler — it won't produce an `out/` dir at all. So we don't "configure export"; we
**carve the public page out** of the server surface and build *that* statically.

### The one piece of luck that makes this tractable

`lib/mediakit/data.ts` (`getMediaKit()`) reads Supabase using **only the publishable
anon key** (`lib/supabase/public.ts`), RLS-gated to published/visible rows, with a
**mock fallback**. It touches **no server secret**. That means the public page's data
can be fetched **at build time in CI** (a snapshot baked into the HTML) — keeping the
server-rendered SEO/JSON-LD — without leaking anything. This is the whole reason a
static media kit is viable.

---

## 1. What goes where after this change

| Surface | Today | After |
|---------|-------|-------|
| Public media kit (`app/page.tsx`) | Server component, ISR | **Static export → GitHub Pages.** Data snapshotted at build. |
| `sitemap.ts` / `robots.ts` | Generated routes | Emit as static `sitemap.xml` / `robots.txt` (export-compatible). |
| Dynamic OG (`opengraph-image.tsx`) | `next/og` at runtime | **Static `public/og.png`** referenced from `page.tsx` metadata. |
| Collab form (`/api/collab`) | Next route handler | **Supabase Edge Function** `collab` (behavior-preserving) — see §5. |
| Admin studio (`/admin` + `app/api/admin/**`) | Next server | **NOT on Pages.** Runs locally (`next dev -p 5174`) or on a real Next host. |

> The admin is a single-operator tool (one passphrase, server-verified). Running it
> locally to edit content, then triggering a Pages rebuild, is the expected workflow.

---

## 2. Build-split strategy (one codebase, two outputs)

We do **not** split into a monorepo. The local repo keeps the full app intact for
admin/dev. The **CI job builds a Pages-only variant** from a throwaway checkout:

```
CI checkout  ─►  delete app/api, app/admin, app/opengraph-image.tsx
             ─►  EXPORT_STATIC=1 next build   (output: 'export')
             ─►  publish ./out to GitHub Pages
```

Deleting those folders in the *CI workspace only* leaves a tree that static-export
accepts. Your working copy is never touched.

`next.config.ts` becomes env-toggled so local dev/build is unchanged:

```ts
import type { NextConfig } from 'next'

const isExport = process.env.EXPORT_STATIC === '1'

const nextConfig: NextConfig = isExport
  ? {
      output: 'export',
      images: { unoptimized: true }, // no Image Optimization server on Pages
      // basePath: only if NOT using a custom domain — see §4
      // basePath: process.env.PAGES_BASE_PATH || undefined,
      // assetPrefix: process.env.PAGES_BASE_PATH || undefined,
    }
  : {}

export default nextConfig
```

---

## 3. File-by-file changes

1. **`next.config.ts`** — env-toggled export config (above).
2. **`app/page.tsx`** — add `openGraph.images: ['/og.png']` + `twitter` card to
   `generateMetadata` (the dynamic OG route is gone in the export build, so the page
   must declare the static card itself). Leave `revalidate` — it's a harmless no-op
   under export. `getMediaKit()` already runs at build → snapshot. ✅
3. **`public/og.png`** — add a 1200×630 share card. Either a hand-made PNG, or
   generate one once locally from the existing `opengraph-image.tsx` design and commit
   it. (Optional polish: a CI step regenerates it each deploy.)
4. **`public/CNAME`** — `simxmargo.com` (only if using the custom domain — §4).
5. **`public/.nojekyll`** — empty file. Stops GitHub's Jekyll from dropping Next's
   `_next/` assets. (The official Pages action adds this, but commit it to be safe.)
6. **`components/mediakit/RateAndContact.tsx`** — point the collab `fetch` at an
   env-driven endpoint so it hits the Next route locally and the Edge Function in prod:
   ```ts
   const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_ENDPOINT || '/api/collab'
   const res = await fetch(COLLAB_URL, { method: 'POST', /* …unchanged… */ })
   ```
7. **`.github/workflows/pages.yml`** — the deploy workflow (§6).
8. **`.env.example`** — document `EXPORT_STATIC`, `PAGES_BASE_PATH`,
   `NEXT_PUBLIC_COLLAB_ENDPOINT`.

Nothing is deleted from the working tree — the admin/API stay for local use.

---

## 4. Custom domain vs project subpath  ⚠ the one decision that affects URLs

The code **already hardcodes `simxmargo.com`** as canonical in four places
(`app/page.tsx` JSON-LD + canonical, `sitemap.ts`, `robots.ts`, the OG copy). Two ways
to serve:

- **A — Custom domain `simxmargo.com` (recommended, matches the code as-is):**
  add `public/CNAME` = `simxmargo.com`, set the custom domain in repo
  **Settings → Pages**, and point DNS at GitHub Pages (apex `A`/`AAAA` records to
  GitHub's 4 IPs, or `www` `CNAME → kitdaniellim.github.io`). **No `basePath`.** All the
  hardcoded URLs stay correct. Zero edits to those files.

- **B — Default `kitdaniellim.github.io/simxmargo` (no domain needed):** the site
  lives under a subpath, so set `PAGES_BASE_PATH=/simxmargo` (uncomment in
  `next.config.ts`) **and** rewrite the four hardcoded `simxmargo.com` URLs to the
  github.io path, or the canonical/sitemap/OG will point at a domain you don't serve.

**Recommendation: A.** It's what the app was built for and needs no URL edits. Do you
own/can you point `simxmargo.com`? If not yet, ship on B now and switch to A later
(switching is just adding the CNAME + DNS + removing basePath).

---

## 5. Collab form → Supabase Edge Function (behavior-preserving)

The current `/api/collab` route does: honeypot check → validate name/email/message →
hash the caller IP (sha256, salted, truncated; raw IP never stored) → insert into
`collab_inquiries` (anon key; RLS only allows `status='new'` + non-empty message).

Port that **verbatim** into a Supabase Edge Function so the static form keeps the same
server-side validation + IP hashing:

- New `supabase/functions/collab/index.ts` — same logic, Deno-flavored, with CORS
  headers (the existing `_shared/http.ts` already has the CORS helper).
- Deploy: `npm run sb -- functions deploy collab` (no JWT verification — it's a public
  endpoint; rate-limit via the honeypot + RLS + the DB CHECKs).
- Set `NEXT_PUBLIC_COLLAB_ENDPOINT` = the function URL
  (`https://zzgypushqcpchfxrjexc.supabase.co/functions/v1/collab`) in the GitHub
  Actions build env.

**Simpler alternative (MVP):** drop the function and have the form `insert()` directly
to `collab_inquiries` via the browser anon client. RLS already gates it; you lose only
the server-side IP hash. Pick this if you don't want to maintain a function. *(I'll use
the Edge Function unless you say otherwise — it preserves current behavior + compliance
posture.)*

---

## 6. GitHub Actions workflow (`.github/workflows/pages.yml`)

```yaml
name: Deploy media kit to Pages
on:
  push: { branches: [master] }
  workflow_dispatch:        # manual "rebuild to publish latest content"
  # schedule: [{ cron: '0 6 * * *' }]   # optional: nightly content refresh
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Carve out server-only surfaces
        run: rm -rf app/api app/admin app/opengraph-image.tsx
      - name: Build static export
        env:
          EXPORT_STATIC: '1'
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
          NEXT_PUBLIC_COLLAB_ENDPOINT: ${{ secrets.NEXT_PUBLIC_COLLAB_ENDPOINT }}
          # PAGES_BASE_PATH: '/simxmargo'   # only for option B
        run: npm run build
      - run: touch out/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with: { path: out }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.deploy.outputs.page_url }} }
    steps:
      - id: deploy
        uses: actions/deploy-pages@v4
```

**GitHub Actions secrets to add** (repo **Settings → Secrets → Actions**):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both safe — publishable),
and `NEXT_PUBLIC_COLLAB_ENDPOINT`. If the Supabase secrets are absent, the build still
succeeds via the mock fallback (so a misconfigured CI shows the demo kit, never a
broken page).

Enable Pages: repo **Settings → Pages → Source = GitHub Actions**.

---

## 7. Data freshness model (important expectation)

Static export = **content is frozen at build time.** After the creator edits anything
in the local admin, the public site updates only on the **next build**. Triggers:

- **push** to `master` (code changes), and
- **manual** `workflow_dispatch` ("Run workflow" button) for content-only refreshes, and
- optional **nightly cron** (uncomment) to auto-pick up follower-count edits.

If you'd rather have an always-live page, the alternative is to make `page.tsx` a
client component that fetches Supabase in the browser — but that **loses the
server-rendered JSON-LD/SEO** that the media kit deliberately ships. For a kit shown to
brands, build-time snapshot + SEO is the better trade. Flagged so it's a conscious choice.

### 7b. Paused-Supabase resilience (added 2026-07-06)

The free-tier Supabase project **pauses after ~7 days of inactivity** (nobody opening
the admin). The deployed page is built to survive that fully:

- **Assets are localized at deploy time.** `scripts/localize-export.mjs` (a workflow
  step after `next build`) downloads every Supabase-Storage image the export references
  (portraits, portfolio video covers, OG card, uploaded favicon) into `out/snap/` and
  rewrites the references to `https://simxmargo.github.io/snap/…`. The published page
  has **zero runtime dependency on Supabase** — trade-off: the OG share card is now
  frozen per deploy (admin re-renders need a `workflow_dispatch` rebuild to show up in
  link previews).
- **The client-side live refresh degrades silently.** `MediaKitLive` still tries to
  fetch fresh rows on load; when the project is paused the read fails and the baked
  snapshot (with local assets) simply stays. When it's awake, live data + Storage URLs
  swap in as before.
- **The collab form falls back to `mailto:`.** A failed insert shows "Something went
  wrong — email me at …" instead of losing the inquiry silently.
- **Builds while paused FAIL on purpose.** `getMediaKit()` throws under
  `EXPORT_STATIC=1` when Supabase is unreachable (or the profile is unpublished),
  instead of silently baking the **mock placeholder data** over the live site. The last
  good deploy stays up; restore the project in the Supabase dashboard, then re-run the
  workflow. (Local `next dev`/non-export builds keep the mock fallback.)

### 7c. Keep-alive + offline backups (added 2026-07-20)

Two more layers close the *deletion* end of the free-tier chain (7-day pause →
90-day restore window → project deleted, zero snapshots kept on Free):

- **`.github/workflows/keepalive.yml`** pings Supabase REST Mon+Thu so the
  7-day pause clock never runs out; a non-200 fails the run (GitHub emails you)
  so a pause is noticed immediately. GitHub disables schedules after ~60 days
  of repo inactivity — it emails first; a push or one click re-arms.
- **`npm run backup`** (`scripts/backup.mjs`) dumps all tables + the auth user
  + every `media` Storage object to `backups/<stamp>/` (gitignored — the dumps
  hold PII and this repo is public). Run it after meaningful admin sessions.
  The script header documents the full restore-into-a-fresh-project runbook.

---

## 8. Connect the repo (you run git — local change only)

You renamed the GitHub repo, so this is a one-line URL repoint of `origin`:

```bash
git remote set-url origin https://github.com/kitdaniellim/simxmargo.git
git remote -v   # verify both fetch/push now show …/simxmargo.git
git push -u origin master
```

---

## 9. Execution checklist

- [ ] Repoint `origin` (§8).
- [ ] Decide §4: custom domain (A) or github.io subpath (B).
- [ ] `next.config.ts` env-toggled export config.
- [ ] `app/page.tsx`: static `openGraph.images` + twitter card.
- [ ] Add `public/og.png`, `public/.nojekyll` (+ `public/CNAME` for option A).
- [ ] `RateAndContact.tsx`: env-driven collab endpoint.
- [ ] `supabase/functions/collab/index.ts` + deploy (or choose the direct-insert MVP).
- [ ] `.github/workflows/pages.yml` + add Actions secrets.
- [ ] Settings → Pages → Source = GitHub Actions (+ custom domain for A).
- [ ] Local sanity check: `EXPORT_STATIC=1 npm run build` after temporarily moving
      `app/api`/`app/admin` aside, confirm `out/` is produced and `out/index.html`
      contains the kit.
- [ ] Push → watch the Action → verify the live URL + the collab form submits.

---

## 10. Reminder: the lower-effort alternative still stands

If at any point the build-split feels like too much maintenance, **Vercel** runs this
exact repo unchanged (all 14 routes + ISR + dynamic OG + the admin), free, auto-deploy
on push. This plan exists because you specifically chose GitHub Pages; Vercel remains
the zero-refactor option if priorities shift.
