# Studio Settings redesign + admin editorial restyle

_Last updated: 2026-06-25_

This documents the full-admin redesign (port of the Claude Design "Studio
Settings.dc.html") and the Supabase-connectivity work done alongside it, plus the
**backend seams intentionally deferred** for later review.

## What shipped (UI + wiring)

- **Whole `/admin` adopts the warm-editorial DARK design** (Bodoni Moda + Archivo,
  terracotta `#cf5d39`, `#141210` surfaces). The design system is ported verbatim
  into `app/globals.css` scoped under **`.studio`** (mirrors how the public page is
  scoped under `.mk`). `AdminShell` sets the `.studio` root; every admin page uses
  the semantic classes (`card`, `field`, `input`, `btn`, `pill`, `table`, `slot`…).
- **New `components/pages/SettingsPage.tsx`** with the four design cards: Sending
  account, Creator profile, Public media kit images, Sending safety.
- **`public_profile` is now the single identity source** feeding BOTH the media kit
  and outreach emails (the schema historically kept `app_settings.profile` and
  `public_profile` decoupled — see `0003_mediakit.sql:18`; the new Settings design
  deliberately bridges them).

## Data model

Migration `supabase/migrations/0004_settings.sql` adds to `public_profile`:
`handle, audience, reply_to_email, mailing_address, media_kit_url, cover_image_url`.
The social-share image continues to live in `seo->>'og_image_url'`.

| Settings field | Stored | Notes |
|---|---|---|
| Your name | `public_profile.display_name` | |
| Handle | `public_profile.handle` | |
| Niche | `public_profile.niche` | |
| Audience | `public_profile.audience` | |
| Reply-to email | `public_profile.reply_to_email` | |
| Mailing address | `public_profile.mailing_address` | CAN-SPAM |
| Media kit URL | `public_profile.media_kit_url` | |
| Profile photo | `public_profile.avatar_url` | upload → `media` bucket |
| Cover image | `public_profile.cover_image_url` | upload → `media` bucket |
| Social share (og) | `public_profile.seo.og_image_url` | upload → `media` bucket |
| **Followers / Avg views / Engagement** | **derived (read-only)** | from `social_stats` (see below) |
| Daily send cap | `app_settings.daily_cap` | outreach knob |

### API route
`app/api/admin/settings/route.ts` (service-role, `requireAdmin`):
- `GET` → `{ profile, metrics (derived), platforms, dailyCap }`.
- `PUT` → whitelisted identity → `public_profile`; `dailyCap` → `app_settings`.

Derived metrics are **follower-weighted averages** across visible `social_stats`
rows (`followers` = SUM, `avgViews`/`engagement` = weighted mean of platforms that
report each metric).

## Connectivity fixes (from the audit)

- **Outreach was silently non-persistent.** `contacts` and `app_settings` have only
  `authenticated` RLS policies, but the Zustand store used the **anon** client → all
  reads/writes were RLS-blocked. Fixed by routing the store through new service-role
  routes: `app/api/admin/contacts` (GET/PATCH) + `app/api/admin/settings`. `lib/store.ts`
  now hydrates via `adminFetch` (not the anon client).
- **`contacts` seeded** from `lib/mock/contacts.ts` via `supabase/seed_contacts.sql`
  (12 leads) so Contacts/Send Queue show real DB rows.
- **Social Stats visibility toggle** fixed (`SocialStatsEditor` sent `visible`; the
  route whitelists `isVisible`).
- Portfolio brands were already in the DB (17 rows) — no change needed there.

## Deferred backend seams (TODO — for later review)

These are UI shells / read-only today; each has a clear single swap point.

1. **Social metrics API sync** — followers/avg-views/engagement should be pulled from
   the **TikTok / Instagram / Facebook** APIs, not hand-entered. The schema is ready:
   `social_stats.source ('manual'|'api')` + `synced_at`. Swap point: a scheduled
   Edge Function that upserts `social_stats` rows with `source='api'`; the Settings
   page + media kit already read from `social_stats`, so no UI change is needed.
   Seam marker: derived metrics in `app/api/admin/settings/route.ts` (`deriveMetrics`).

2. **Gmail sending account** (`Sending account` card) — `gmail.send` OAuth for a
   dedicated secondary inbox, replies routed to `reply_to_email`. UI is a disabled
   "Connect Gmail (Backend pending)" button. Swap point: an OAuth Edge Function +
   token storage; then `send_queue` → `pg_cron` → `send-one` (see `BACKEND_DESIGN.md` §6).
   The Send Queue's "Approve & send" remains mocked until this lands
   (`lib/store.ts` `markQueuedAsSent`).

3. **Outreach scrape/enrich** — "Scrape new brands" (Contacts) stays disabled; the
   scraper/enrich Edge Functions are the backend (`BACKEND_DESIGN.md` §3–4).

4. **Email template consolidation** — `buildDraft` consumes a `CreatorProfile`, now
   assembled in `lib/store.ts` (`settingsToProfile`) from `public_profile` + derived
   metrics. `app_settings.profile` is no longer the identity source (kept only for
   `daily_cap`/`warmup_start`); it can be dropped in a future migration once nothing
   reads it.
