-- DEV SEED for the public media kit (NOT a migration — kept out of migrations/ so
-- it never runs on prod via db:apply; per the "seed migrations = prod risk" rule).
-- Idempotent: profile/social UPDATEs are naturally re-runnable; the brand INSERT is
-- guarded to only seed an empty table. Apply with: npm run db:seed
-- Mirrors lib/mock/mediakit.ts so the live page matches the designed shell.

-- 1) Publish the profile with real content.
update public_profile set
  tagline   = 'Fashion, beauty & everyday inspiration — for brands that want to feel real.',
  niche     = 'Photography & Videography · Fashion & Styling',
  location  = 'Philippines',
  bio_md    = 'Simone Marie Golez is a Filipino lifestyle content creator specializing in fashion, beauty, editing, and day-to-day inspiration. She creates engaging digital content that blends aesthetics with authenticity, letting brands connect meaningfully with her audience.',
  rate_card = '[
    {"deliverable":"TikTok video (1 × 30–60s)","price":"from $1,200","note":"concept, shoot, edit"},
    {"deliverable":"Instagram Reel + 3 Stories","price":"from $950","note":"usage 30 days"},
    {"deliverable":"UGC bundle (3 videos)","price":"from $1,800","note":"no posting, brand-owned"},
    {"deliverable":"Ambassadorship (monthly)","price":"let''s talk","note":"ongoing partnership"}
  ]'::jsonb,
  seo = '{"title":"sim x margo — Media Kit","description":"Fashion & beauty creator · 4.4M followers across TikTok, Instagram & Facebook. Collaborate with sim x margo."}'::jsonb,
  is_published = true,
  updated_at = now()
where id = 1;

-- 2) Enrich social stats (avg views / engagement / 30-day growth / history sparkline).
update social_stats set avg_views=480000, engagement_rate=7.4, growth_30d=3.1, updated_at=now(),
  history='[{"date":"2026-01","followers":2400000},{"date":"2026-02","followers":2480000},{"date":"2026-03","followers":2550000},{"date":"2026-04","followers":2610000},{"date":"2026-05","followers":2660000},{"date":"2026-06","followers":2700000}]'::jsonb
where platform='tiktok';
update social_stats set avg_views=210000, engagement_rate=5.8, growth_30d=2.2, updated_at=now(),
  history='[{"date":"2026-01","followers":1180000},{"date":"2026-02","followers":1210000},{"date":"2026-03","followers":1240000},{"date":"2026-04","followers":1265000},{"date":"2026-05","followers":1285000},{"date":"2026-06","followers":1300000}]'::jsonb
where platform='instagram';
update social_stats set avg_views=88000, engagement_rate=4.1, growth_30d=1.4, updated_at=now(),
  history='[{"date":"2026-01","followers":360000},{"date":"2026-02","followers":368000},{"date":"2026-03","followers":376000},{"date":"2026-04","followers":383000},{"date":"2026-05","followers":389000},{"date":"2026-06","followers":394000}]'::jsonb
where platform='facebook';

-- 3) Seed the brand partners (only when the table is still empty).
insert into portfolio_brands (brand, website, blurb, campaign_title, metrics, category, featured, sort_order)
select v.brand, v.website, v.blurb, v.campaign_title, v.metrics::jsonb, v.category, v.featured, v.sort_order
from (values
  ('LaceMade','lacemade.com','Feminine, romantic ready-to-wear — styled across a 3-look TikTok series and IG Reels.','Spring Lace Capsule','{"reach":"1.9M","views":"740K","engagement":"8.2%","deliverables":["1 TikTok","1 Reel","4 Stories"]}','fashion',true,1),
  ('Fashion Nova','fashionnova.com','Trend-led fast fashion hauls and styling for a Gen-Z audience.','OOTD Drop','{"reach":"2.4M","views":"1.1M","engagement":"6.9%","deliverables":["2 TikToks","5 Stories"]}','fashion',true,2),
  ('Oh Polly','ohpolly.com','Going-out and occasionwear styling with a glossy editorial treatment.','Occasionwear Edit','{"reach":"1.5M","views":"620K","engagement":"7.7%","deliverables":["1 Reel","1 TikTok"]}','fashion',true,3),
  ('BeautyPlus App','beautyplus.com','Tutorial-style content showing real editing workflows — a strong fit for her editing niche.','Edit Like Me','{"reach":"2.1M","views":"980K","engagement":"9.0%","deliverables":["1 TikTok tutorial"]}','beauty',true,4),
  ('Kapi Cam','kapi.cam','Retro camera app — playful day-in-the-life content.','','{}','app',false,5),
  ('Flighthouse','flighthouse.com','Entertainment media collab amplifying short-form trends.','','{}','media',false,6),
  ('CHNGE','chnge.com','Sustainable basics with a values-led message.','','{}','fashion',false,7),
  ('Glowmode','glowmode.com','Activewear styling and movement content.','','{}','fashion',false,8),
  ('Filmora','filmora.wondershare.com','Editing software walkthroughs for creators.','','{}','app',false,9),
  ('Fashion Chingu','fashionchingu.com','K-fashion hauls and styling.','','{}','fashion',false,10),
  ('OldRoll Cam','oldroll.com','Vintage film-camera aesthetic content.','','{}','app',false,11),
  ('VivaVideo','vivavideo.tv','Mobile video editing features showcase.','','{}','app',false,12)
) as v(brand, website, blurb, campaign_title, metrics, category, featured, sort_order)
where not exists (select 1 from portfolio_brands);
