# Brand-performance modal — backend seam

The public media kit's Partners marquee (`components/mediakit/PortfolioGrid.tsx`) now
opens a **brand-performance modal** on tile click (ported from the Claude Design
"Media Kit v3.dc.html"). The modal's view-model is built by
`lib/mediakit/brandDetail.ts` → `buildBrandDetail(brand)`.

## Where the modal's data comes from

The campaign detail shown in the modal (type, **start/end dates**, **deliverables**,
**total views**, and the **top-content grid**) is the creator's *authored showcase
content*. In the source design it's a hardcoded `DETAILS` table, one curated entry
per brand. We ported that table verbatim into `CURATED` in `brandDetail.ts` and join
it to each live `portfolio_brands` row **by brand name** (normalized, with prefix
tolerance so e.g. DB "Flighthouse Media" matches the design's "Flighthouse").

| Modal element        | Source                                                        |
| -------------------- | ------------------------------------------------------------- |
| Logo, name           | live `brand.logoUrl`, `brand.brand`                           |
| Category chip + icon | `CURATED[slug].cat` → fashion / beauty / app / media          |
| Type / subtitle      | `CURATED[slug].type` (e.g. "App partner")                     |
| Start / End          | `CURATED[slug].start` / `.end`                                |
| Deliverables         | `CURATED[slug].deliv` (e.g. "2 TikToks")                      |
| Total views          | `CURATED[slug].total`                                         |
| Top-content grid     | `peak × [1, .62, .41, .29]`, likes = views × .11, captions by category |

The content cards use a separate `peak` per brand (they intentionally do **not** sum
to `total` — this matches the design: Hypic peak 900K → cards 900K / 558K / 369K /
261K with a 1.6M headline total).

A brand **not** in `CURATED` (e.g. one added later in admin) falls back to a clean
header + blurb + whatever aggregate `metrics` the DB row carries — no fabricated grid.

## To make this admin-editable (the seam)

The curated numbers live in one place: `CURATED` in `lib/mediakit/brandDetail.ts`.
To let staff edit them, move them to the DB:

1. Add columns to `portfolio_brands` (or a `campaign_detail` jsonb): `campaign_type`,
   `campaign_start`, `campaign_end`, `deliverables_text`, `total_views`, `peak_views`.
2. Map them in `lib/mediakit/data.ts` (`mapBrand`) onto `PortfolioBrand`.
3. In `buildBrandDetail`, prefer the DB values when present, falling back to `CURATED`
   then to the metrics path. Keep `CURATED` as the seed so nothing regresses.
4. Edit them in `components/admin/PortfolioManager.tsx`.

For real per-clip stats (instead of the `peak` falloff), extend `BrandMedia` with
`views` / `likes` / `caption` and map real `media[]` rows to `ContentCard[]` first,
falling back to the falloff.

## Real "Top content" (IMPLEMENTED — manual links + auto-thumbnail)

Each brand can now carry real reels in `portfolio_brands.media` (jsonb `BrandMedia[]`,
no schema change). When a brand has ≥1 media item, `buildBrandDetail` renders those
instead of the synthetic falloff (`mapRealContent`): real thumbnail, view/like counts,
caption, and the card links to the post.

**Why this shape (validated against reality):** per-post view/like counts are NOT
fetchable keyless — TikTok video pages return a blocked shell, IG posts are
login-walled (tested). So counts are **manual** (the creator has them in-app). Only
the *thumbnail + caption* are auto-fetchable, and only for TikTok:

- `POST /api/admin/brands/fetch-post { url }` → detect platform.
  - **TikTok**: keyless oEmbed → `{ thumbUrl, caption }`. The thumbnail is **re-hosted**
    into Supabase storage (`media/content/…`) because TikTok's CDN url is signed with
    an ~1-month `x-expires` and would 404 later. SSRF-guarded (host allowlist +
    private-IP check on the oEmbed host AND the `*.tiktokcdn.com` thumbnail host).
  - **Instagram**: returns a manual-only note (paste cover + caption, type counts).
- Admin: `PortfolioManager` → brand editor "Top content" repeater (URL + Fetch + cover
  upload + views/likes/caption). Counts arrive as strings; `sanitizeMedia` in the
  brands route coerces + validates at the boundary (caps length, drops empties).
- Carousel rows: `portfolio_brands.row_index` (1/2, NULL ⇒ auto-split) assigns a brand
  to a marquee row; the public page splits with NO cross-row repetition.

## Future: authenticated / login-based enrichment (exploration)

> **NOW SCOPED in detail → `docs/mediakit-social-oauth-sync.md`** (OAuth flow, access-tier
> reality, proposed schema, file-by-file seams, build phases). The summary below is the
> original orientation; the dedicated doc is the source of truth for this feature.

To get RICHER auto data (the creator's TikTok feed, per-post counts, IG posts) we'd
need authentication. Options, roughly by effort/robustness:

1. **TikTok Display API (official, OAuth)** — the creator logs in once via TikTok
   Login Kit; we get a token to read THEIR own videos incl. `view_count`,
   `like_count`, `share_count`, `cover_image_url`, captions. This is the clean,
   ToS-compliant path to auto-populate "Top content" from the handle. Cost: register a
   TikTok developer app + OAuth flow + token storage/refresh (Supabase table, encrypted).
   Needs app review for production scopes (`video.list`). RECOMMENDED if we go authed.
2. **Instagram Graph API (official, OAuth)** — IG Business/Creator account linked to a
   Facebook Page → `GET /{ig-user}/media` with `like_count`, `comments_count`,
   `media_url`, `caption`, and `/insights` for plays/reach. Same friction as TikTok
   (FB app + review). Only works if the account is Business/Creator (simxmargo is).
3. **Server-side authenticated session scrape** — store a logged-in TikTok/IG session
   cookie and scrape the feed. FRAGILE + likely against ToS + breaks on every markup/
   cookie change + risks the account. NOT recommended.
4. **Third-party API (RapidAPI/Apify TikTok-scraper, etc.)** — pays a vendor to do the
   scraping; returns posts + counts by handle. Fastest to integrate, ongoing cost, and
   you inherit their ToS/reliability risk.

Recommendation if/when we want "by handle, automatically": **TikTok Display API +
Instagram Graph API (options 1+2)** — one-time OAuth per platform, then a "Sync content"
button (or cron) refreshes each brand's reels with real counts. The current manual+
auto-thumbnail flow stays as the always-available fallback.

## Touch points

- `lib/mediakit/brandDetail.ts` — `CURATED` table + name join + `mapRealContent` + `// TODO(mediakit-brand-detail-backend)`.
- `app/api/admin/brands/fetch-post/route.ts` — TikTok oEmbed + thumbnail re-host (SSRF-guarded).
- `app/api/admin/brands/route.ts` — `sanitizeMedia` boundary validation + `row_index` mapping.
- `components/admin/PortfolioManager.tsx` — brand editor "Top content" + inline row selectors.
- `components/mediakit/PortfolioGrid.tsx` — modal markup, real-content cards, 2-row no-repeat split.
- `supabase/migrations/0006_brand_rows.sql` — `row_index` column (applied to dev).
- `app/globals.css` — `.mk .modal-*` / `.mk .vcard` / `.studio .content-*` / `.rowseg` styles.
