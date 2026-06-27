# Authenticated social sync — auto-pull "Top content" reels with real counts

**Status:** SCOPED (design only — no code/migrations applied yet). 2026-06-26.
**Supersedes** the short "Future: authenticated / login-based enrichment" section in
`docs/mediakit-brand-detail-backend.md` (that section now points here).
**Seam tag:** `// TODO(mediakit-social-oauth-sync)`.

---

## 1. The problem this solves (and the reframe that makes it work)

Brand "Top content" cards show the reels **simxmargo made for that campaign**. Today they're
populated either by the synthetic `peak`-falloff (curated) or by the **manual** flow: paste a
post URL → keyless TikTok oEmbed gives a thumbnail+caption → the creator **types** the
view/like counts by hand, because per-post counts are NOT fetchable keyless (verified — TikTok
video pages return a blocked shell; IG posts are login-walled).

**The reframe:** those campaign reels live on simxmargo's **own** TikTok/Instagram accounts.
TikTok's Display API and Instagram's Graph API both let you read **the authenticated user's own
media, including real view/like counts**. The keyless approach failed only because it tried to
read *arbitrary* posts. Reading *your own* feed is the supported, ToS-compliant happy path.

So the feature is: **creator authenticates once per platform → we pull their own feed (with real
counts) → creator tags each post to a brand → tagged posts persist into the existing
`portfolio_brands.media`.** The manual + keyless-thumbnail flow stays as the always-on fallback.

**Why this is low-risk:** every tagged post lands in the *same* `BrandMedia[]` jsonb the public
page already renders (`brandDetail.ts` → `mapRealContent`). The public render path, the modal,
the carousel — **none of it changes.** This is purely a new *sourcing* path into an existing sink.

---

## 2. Access-tier reality (the headline decision)

This is the part that's easy to get wrong, so it's first. Both are FREE official APIs; the gate
is review/verification, and it differs sharply by platform for a single-creator app.

### Instagram — CLEAN, no review for the owner's own account ✅
Use **"Instagram API with Instagram Login"** (the post-Dec-2024 replacement for the dead Basic
Display API). It logs in directly with Instagram, **needs no linked Facebook Page**, and works on
a Business/Creator account (simxmargo is one). Meta, verbatim:

> "If your app only serves your Instagram professional account or an account you manage,
> **Standard Access is all your app needs**."

→ For simxmargo's own account: **no App Review, no business verification.** Advanced Access
(review + verification) is only required the day this onboards *other people's* accounts.

### TikTok — production needs app review; sandbox works but is capped ⚠️
`video.list` in **production** requires app review of both Login Kit + a Display-API product:
a live website with **Privacy Policy + ToS links visible without opening a menu**, app
name/icon/description, a per-scope justification, and **at least one end-to-end demo video**.
Review takes days–2 weeks.

The no-review alternative is **Sandbox**: up to 5 sandboxes/app, each shareable with ≤10 "target
users." You add **your own TikTok account** as a target user and call `video.list` against it
with real data. Caveats: capped at 10 accounts and TikTok does **not** bless sandbox as a
*production* mechanism ("Apps must not be for private or personal use").

**Recommendation:**
- **Phase A (now):** ship **Instagram fully** (clean) + TikTok **via sandbox** for the owner's
  account. This gets real counts on both with zero review.
- **Phase B (if/when it must be "production" or onboard other creators):** complete TikTok app
  review (prereq: confirm the site has visible Privacy Policy + ToS pages — see §9 open items)
  and, for IG, Advanced Access + business verification.

---

## 3. Architecture / data flow

```
 ┌─ Admin (one-time per platform) ─────────────────────────────────────────┐
 │  Settings → "Connections" → [Connect TikTok] [Connect Instagram]         │
 │     → /api/admin/social/connect/[platform]  (302 → platform authorize)   │
 │     ← /api/admin/social/callback/[platform] (code → tokens, ENCRYPTED)   │
 │        stored in  social_connections                                     │
 └──────────────────────────────────────────────────────────────────────── ┘
                                  │
 ┌─ Sync (button now; cron later) ─────────────────────────────────────────┐
 │  POST /api/admin/social/sync                                             │
 │   • refresh token if near expiry                                         │
 │   • TikTok  POST /v2/video/list/  (own videos + counts)                  │
 │   • IG      GET  /me/media + per-reel /insights?metric=views,reach       │
 │   • RE-HOST each cover/thumbnail → Supabase `media/synced/…` (TTLs!)     │
 │   • upsert → synced_media  (per-platform cache of the creator's posts)   │
 └──────────────────────────────────────────────────────────────────────── ┘
                                  │
 ┌─ Tag to brand (PortfolioManager "Top content") ─────────────────────────┐
 │  "Pick from synced posts" → choose a synced_media row → it fills a       │
 │  BrandMedia {url,thumbUrl,platform,views,likes,caption} on that brand    │
 │  → saved into portfolio_brands.media  (EXISTING sink — no shape change)  │
 └──────────────────────────────────────────────────────────────────────── ┘
                                  │
                 Public page renders unchanged (mapRealContent)
```

**Snapshot, not live-join.** When a synced post is tagged to a brand, its counts are **copied**
into `portfolio_brands.media` (a snapshot). This matches the current shape, keeps the public read
a single `portfolio_brands` query, and survives token expiry. A "Refresh counts" action can
re-pull + re-host later. (Live-joining `synced_media` at render time was rejected: it couples the
public page to token health and adds a join for no user-visible benefit.)

---

## 4. Data model (proposed — DDL, not yet applied)

`supabase/migrations/0007_social_connections.sql`:

```sql
-- One row per connected platform (owner-only app → at most a handful of rows).
create table if not exists social_connections (
  platform        text primary key check (platform in ('tiktok','instagram')),
  external_id     text,                 -- TikTok open_id / IG user id
  username        text,
  access_token    text not null,        -- AES-256-GCM sealed (see §6) — NEVER plaintext
  refresh_token   text,                 -- sealed; TikTok only (IG long-lived self-refreshes)
  scope           text,
  access_expires  timestamptz,          -- when access_token dies (TikTok 24h / IG 60d)
  refresh_expires timestamptz,          -- TikTok refresh 365d
  connected_at    timestamptz not null default now(),
  last_synced_at  timestamptz
);

-- Cache of the creator's OWN recent posts, pulled by sync. Tagging copies a row's
-- fields into portfolio_brands.media (snapshot).
create table if not exists synced_media (
  id            text not null,          -- platform post id
  platform      text not null check (platform in ('tiktok','instagram')),
  url           text not null,          -- share_url / permalink
  caption       text,
  thumb_url     text,                   -- RE-HOSTED Supabase url (source TTLs expire)
  views         bigint,
  likes         bigint,
  comments      bigint,
  posted_at     timestamptz,
  fetched_at    timestamptz not null default now(),
  primary key (platform, id)
);

-- Both tables are admin-only: NO anon RLS policy → unreachable by the public anon client.
alter table social_connections enable row level security;
alter table synced_media        enable row level security;
-- (service-role bypasses RLS; all access is via /api/admin/* behind requireAdmin)
```

No change to `portfolio_brands` or `BrandMedia` — tagged posts reuse the existing `media` jsonb.

---

## 5. New code (file-by-file seams)

| File | Responsibility |
| --- | --- |
| `lib/crypto/secretbox.ts` | `seal()/open()` — AES-256-GCM with `SOCIAL_TOKEN_KEY` (32-byte base64 env). Tokens are sealed before they touch the DB. |
| `lib/social/oauth/tiktok.ts` | `authorizeUrl()`, `exchangeCode()`, `refresh()`, `listVideos()`. v2 endpoints; comma-separated scopes; form-urlencoded token POST; **no PKCE for web**. |
| `lib/social/oauth/instagram.ts` | `authorizeUrl()`, `exchangeCode()` (short-lived) → `exchangeLongLived()` (60d) → `refresh()`; `listMedia()` + `mediaInsights()`. Host `graph.instagram.com`. |
| `lib/social/oauth/tokenStore.ts` | read/seal/persist a `social_connections` row; `getFreshToken(platform)` refreshes when near expiry and **re-persists rotated refresh tokens** (TikTok rotates conditionally). |
| `lib/social/rehost.ts` | factor `rehostThumb()` OUT of `fetch-post/route.ts` so both the manual flow and sync share one SSRF-guarded re-host (reuses `isBlockedHost` + a widened thumb-host allowlist). |
| `app/api/admin/social/connect/[platform]/route.ts` | `requireAdmin` → 302 to platform authorize URL with `state` (CSRF, signed/stored). |
| `app/api/admin/social/callback/[platform]/route.ts` | verify `state` → exchange code → seal + upsert `social_connections` → redirect back to admin Connections. |
| `app/api/admin/social/sync/route.ts` | `requireAdmin` → pull own feed (both platforms or one) → re-host covers → upsert `synced_media` → return counts. |
| `app/api/admin/social/status/route.ts` | connection status per platform (connected? username? expiring? last sync). |
| `components/admin/SocialConnections.tsx` | Settings panel: Connect/Disconnect/Sync + status chips. |
| `components/admin/PortfolioManager.tsx` | extend the "Top content" `ContentRow`: add **"Pick from synced posts"** beside the existing URL+Fetch — selecting a synced row fills the `BrandMedia` fields. |

### Platform call specifics (verified 2026-06-26 — see §8 sources)
**TikTok** (`open.tiktokapis.com`):
- Authorize: `https://www.tiktok.com/v2/auth/authorize/` — `client_key, scope (CSV), redirect_uri, state, response_type=code`.
- Token: `POST /v2/oauth/token/` form-urlencoded → `access_token` (`expires_in` 86400 = **24h**), `refresh_token` (`refresh_expires_in` 31536000 = **365d**), `open_id`.
- Scopes: `user.info.basic` (default) + `video.list` (review/sandbox).
- Videos: `POST /v2/video/list/?fields=id,video_description,cover_image_url,share_url,embed_link,view_count,like_count,comment_count,share_count,create_time,duration`; pagination in JSON body (`cursor` ms, `max_count` ≤20, `has_more`).
- **`cover_image_url` TTL = 6h → re-host on ingest.** Refresh covers later via `POST /v2/video/query/` (≤20 ids).
- Rate limit ~600 req/min per endpoint.

**Instagram** (`graph.instagram.com`, Instagram-Login path):
- Authorize: `GET https://api.instagram.com/oauth/authorize?client_id&redirect_uri&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights&state`.
- Token: `POST https://api.instagram.com/oauth/access_token` (short-lived 1h) → `GET /access_token?grant_type=ig_exchange_token` (long-lived **60d**) → refresh `GET /refresh_access_token?grant_type=ig_refresh_token` (token must be ≥24h old; extends 60d).
- Media: `GET /me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count`. Reel ⇔ `media_product_type == "REELS"`.
- Plays/views: `GET /{media-id}/insights?metric=views,reach` — **`views` is the current metric**; `plays`/`impressions` were **deprecated 2025-04-21** for media created on/after 2024-07-02 (requesting them errors). Read `like_count`/`comments_count` straight off the media object.
- `media_url`/`thumbnail_url` are ephemeral signed CDN urls → **re-host**.
- Rate limit ~200 calls/user/hour — sync is infrequent, fine.

---

## 6. Security

- **Token encryption at rest.** Tokens are bearer credentials to the creator's social accounts —
  never store plaintext. `secretbox.ts` seals with AES-256-GCM using `SOCIAL_TOKEN_KEY` (32-byte
  base64 in env, server-only). *Alternative considered:* Supabase Vault / `pgsodium` — heavier
  setup, ties secrets to the DB; app-layer AES-GCM is simpler and portable. **Recommend AES-GCM**;
  revisit Vault if multi-tenant.
- **RLS lockout.** `social_connections` + `synced_media` get RLS enabled with **no anon policy** →
  the public anon client (`lib/supabase/public.ts`) can't read them; all access is service-role
  via `/api/admin/*` behind `requireAdmin`.
- **Reuse the SSRF guard.** Every outbound thumbnail/cover fetch goes through the shared
  re-host (`isBlockedHost` + DNS-resolve-all-public check, as in `fetch-post/route.ts`). Add the
  IG/TikTok CDN hosts to the thumb allowlist. *(Note: the pre-existing IPv6 gap in `isBlockedHost`
  — NAT64/6to4/`fec0::/10` — tracked separately in the handoff; widen it here too if we touch it.)*
- **OAuth `state`.** Signed/stored `state` on connect, verified on callback (CSRF). Redirect URIs
  registered per platform; HTTPS in prod, `http://localhost:5174/...` for dev.
- **Secrets in env, never client.** `TIKTOK_CLIENT_KEY/SECRET`, `IG_APP_ID/SECRET`,
  `SOCIAL_TOKEN_KEY`, redirect base — all server-only; add to `.env.example` with blanks.

---

## 7. Build phases (UI-shell-first, per the standing preference)

**Phase 0 — UI shell + seams (ship first, no live OAuth):**
- `SocialConnections.tsx` in Settings with Connect/Sync buttons wired to **stubbed** routes that
  return `{ connected:false, note:'OAuth backend pending' }`.
- PortfolioManager "Pick from synced posts" picker reading `synced_media` (empty until sync runs).
- All backend calls behind `// TODO(mediakit-social-oauth-sync)`; migration `0007` authored but
  **applied by the user** (dev DB writes are OK here, but I won't auto-apply).

**Phase 1 — Instagram end-to-end** (clean, no review): connect → sync → tag. Proves the loop.

**Phase 2 — TikTok via sandbox**: same loop; document the sandbox target-user setup.

**Phase 3 — production hardening**: token-refresh cron (`/api/admin/social/sync` on a schedule),
"Refresh counts" per-card action, TikTok app review if going production.

---

## 8. Sources (verified 2026-06-26)

- TikTok Login Kit / OAuth: https://developers.tiktok.com/doc/login-kit-web · token mgmt
  https://developers.tiktok.com/doc/oauth-user-access-token-management
- TikTok scopes: https://developers.tiktok.com/doc/tiktok-api-scopes · video list
  https://developers.tiktok.com/doc/tiktok-api-v2-video-list/ · video object (cover TTL)
  https://developers.tiktok.com/doc/tiktok-api-v2-video-object/ · sandbox
  https://developers.tiktok.com/doc/add-a-sandbox/ · review
  https://developers.tiktok.com/doc/app-review-guidelines
- IG overview / Instagram-Login: https://developers.facebook.com/docs/instagram-platform/overview/ ·
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/ ·
  get-started (token lifetimes)
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started/
- IG media + insights: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/ ·
  v22 changelog (`views`, deprecations) https://developers.facebook.com/docs/graph-api/changelog/version22.0/
- IG access tiers (Standard vs Advanced):
  https://developers.facebook.com/docs/instagram-platform/app-review/
- Basic Display shutdown: https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api/

## 8b. IMPLEMENTED (bridge): ScrapeCreators bulk pull → brand auto-match

The current "Pull videos" tool. The creator enters a handle; we fetch their recent
TikTok/IG posts via the **ScrapeCreators managed API** and auto-match each to a brand by
caption. Chosen as a fast bridge (no OAuth/dev-app registration) while the durable
official-API path (§5–7) is built. **No cookie, no login** — ScrapeCreators runs the
JS-walled fetch.

> ### Why NOT the cookie approach (PROVEN dead 2026-06-26 — do not retry)
> The earlier design pasted a TikTok session cookie and fetched the profile server-side.
> Tested firsthand against `@simxmargo` and it CANNOT work:
> - A server `fetch()` of `tiktok.com/@simxmargo` returns only a **1462-byte
>   `SlardarWAF` JavaScript-challenge shell** — **byte-identical with or without the
>   cookie**, and unchanged by modern Chrome headers. The wall is **JS execution, not
>   auth**, so `fetch()` (no JS engine) never reaches the profile HTML. In-app it surfaced
>   as the "No videos found (HTTP 403/200 wall)" message.
> - A **real browser, logged OUT** (Playwright) DOES get the 264KB page — but the
>   rehydration blob (`__DEFAULT_SCOPE__`) contains only `webapp.user-detail` (followers/
>   bio) and **zero posts**. The video grid is loaded *after* hydration by a **signed
>   `api/post/item_list/` XHR** (`X-Bogus`/`X-Gnarly`/`msToken`). So even a headless
>   browser must scrape the rendered DOM or intercept that XHR — the cookie was always
>   irrelevant. (A headless DOM-scrape works but needs proxies+captcha+constant upkeep →
>   rejected as too high-maintenance for a single-creator tool.)

**Flow (RawVideo is the contract boundary — everything downstream is unchanged):**
- `POST /api/admin/brands/pull-videos { platform, handle }` → `lib/social/scrapeCreators.ts`
  `fetchProfilePosts()` calls ScrapeCreators with the `SCRAPECREATORS_API_KEY` (header
  `x-api-key`), maps the response → `RawVideo[]` (id, url, caption, raw cover, views, likes):
  - TikTok `GET /v3/tiktok/profile/videos?handle=` → `aweme_list[].{aweme_id, desc,
    video.dynamic_cover.url_list[0], statistics.play_count/digg_count, share_url}`. ⚠️ Use
    `dynamic_cover` (image/webp) — TikTok serves the static `cover`/`origin_cover` as
    **image/heic**, which browsers can't render in an `<img>` and `rehost.ts` rejects.
  - Instagram `GET /v2/instagram/user/posts?handle=` → `items[].{pk, caption.text,
    image_versions2.candidates[0].url, play_count, like_count, url}` (caption can be null).
  - Host is fixed to `api.scrapecreators.com` → **no SSRF surface** (unlike the old route).
  - Pagination: pages up to **5 pages / 60 items** (TikTok `max_cursor`, IG `next_max_id`),
    dedup by id, 1 credit/page; returns partial results if a later page fails.
- Caption→brand matching: `lib/social/brandMatch.ts` (`matchCaption`) — unchanged. Only fires
  when a caption literally names a managed brand, so organic (non-sponsored) posts show as
  "unmatched" — that's correct; assign them by hand via the dropdown.
- Preview thumbnails: `GET /api/admin/brands/cover-proxy?u=` mirrors the CDN image through our
  origin (TikTok/IG CDNs 403 cross-origin `<img>` hotlinks). Unauthenticated by necessity (an
  `<img>` can't send the admin header) but locked to `isAllowedThumbHost` + public-IP +
  raster-only + size cap. Preview-only; persisted covers still go through `rehost.ts`.
- Review + commit: `components/admin/PullVideosModal.tsx` (Brand Partners "Pull videos",
  default handle `simxmargo`) → `POST /api/admin/brands/add-videos` re-hosts each cover
  (`lib/social/rehost.ts`, which now also rejects non-http(s) urls) and appends to each brand's
  `media` (dedup by url, cap 24). ScrapeCreators returns ORIGINAL CDN cover URLs
  (`*.tiktokcdn(-us|-eu).com` / `*.cdninstagram.com` / `*.fna.fbcdn.net`), all on the
  `isAllowedThumbHost` allowlist.

**Setup:** get a free key at https://app.scrapecreators.com (1000 credits, no card, never
expire; 1 credit/request), put it in `.env` as `SCRAPECREATORS_API_KEY=`, restart the dev
server. Unset → the tool returns a clear "key not configured" error.

**Limits / caveats:** capped at ~60 posts / 5 credits per pull; covers are signed/expiring
(re-hosted on commit; TikTok static covers are HEIC so we take the webp `dynamic_cover`);
auto-match needs a brand name in the caption (organic posts won't match → assign by hand);
ToS-gray (public data — fine at this volume, don't redistribute media commercially); schema
can drift (vendor-maintained). It's a BRIDGE — the durable home is the official APIs in §5–7.

**Ranked options (2026-06-26 research) for the durable replacement:** ① **Instagram official
API** ("Instagram API with Instagram Login" → `/me/media`) — free, no app review for own
account, no FB Page; **ship this first** (easiest). ② **TikTok Display API**
(`/v2/video/list/`, Login Kit OAuth) in **Sandbox** — free, no review for own account; the
"unaudited = forced private" rule is on the Content *Posting* API, NOT `video.list` reads.
③ ScrapeCreators (this bridge). ④ Manual paste-per-link (permanent fallback). ❌ Headless
browser (works but high-maintenance — not recommended).

## 9. Open items / decisions for the user

1. **Access-tier approach (§2):** confirm Phase A = IG full + TikTok sandbox now; defer TikTok app
   review to Phase B. (Affects whether we need a demo video + visible Privacy/ToS pages soon.)
2. **TikTok app-review prereq:** does the live site already have **visible Privacy Policy + ToS
   pages**? Required for TikTok production review (not for sandbox). Need to confirm/add.
3. **Token encryption:** app-layer AES-256-GCM (`SOCIAL_TOKEN_KEY`) — recommended — vs Supabase Vault.
4. **Sync trigger:** manual "Sync" button only (Phase 0–1) vs add a cron/scheduled refresh (Phase 3).
5. **Snapshot vs live counts:** snapshot into `portfolio_brands.media` (recommended) vs live-join
   `synced_media` at render. Snapshot chosen above — confirm.
6. **UNVERIFIED to nail before coding the calls:** exact IG `media_product_type` enum
   (`REELS`/`STORY` confirmed; `AD`/`FEED` not), IG reels watch-time metric names, and whether
   TikTok business verification is a hard prereq for `video.list` review. None block Phase 0.
```
