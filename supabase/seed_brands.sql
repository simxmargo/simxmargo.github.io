-- DEV SEED: the real "simxmargo" brand partners (mirrors the live beacons grid).
-- NOT a migration — kept out of migrations/ so it never runs on prod via db:apply.
-- Re-runnable: it REPLACES the whole portfolio_brands set with this canonical list,
-- so running it again converges to exactly these 17 rows (idempotent by design).
--
-- LOGOS: domain brands use logo.dev (clean square logos resolved by domain — the
-- same service the source media kit used); app-store-only brands use the logos the
-- creator uploaded to the beacons CDN. Both are EXTERNAL hotlinks — see the note at
-- the bottom for the durable path (own logo.dev token / Supabase Storage upload).
-- NOTE: pk_B7yuqACiTu6q29RrYrQD2Q is the source kit's PUBLIC logo.dev token; swap it
-- for your own (env LOGO_DEV_TOKEN) when you have one.

begin;

-- Clean replace so order/category/logo edits below are authoritative.
delete from portfolio_brands;

insert into portfolio_brands (brand, website, logo_url, category, featured, sort_order, is_visible)
values
  ('LaceMade',       'https://lacemade.com',                                                    'https://img.logo.dev/lacemade.com?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                              'fashion', false, 1,  true),
  ('Kapi Cam',       'https://apps.apple.com/ph/app/kapi-cam-y2k-ccd-camera/id6740760807',      'https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_Kapi%20Cam_brand_logo.jpg?t=1768144302594',         'app',     false, 2,  true),
  ('Flighthouse',    'https://flighthousemedia.com',                                            'https://img.logo.dev/flighthousemedia.com?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                      'media',   false, 3,  true),
  ('Fashion Nova',   'https://fashionnova.com',                                                 'https://img.logo.dev/fashionnova.com?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                           'fashion', false, 4,  true),
  ('Beautyplus App', 'https://apps.apple.com/ph/app/beautyplus-selfie-photo-editor/id622434129','https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_Beautyplus%20App_brand_logo.jpg?t=1768144375804',    'beauty',  false, 5,  true),
  ('CHNGE',          'https://chnge.com',                                                       'https://img.logo.dev/chnge.com?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                                 'fashion', false, 6,  true),
  ('Glowmode',       'https://inglowmode.com',                                                  'https://img.logo.dev/inglowmode.com?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                            'fashion', false, 7,  true),
  ('Oh Polly',       'https://ohpolly.com',                                                     'https://img.logo.dev/ohpolly.com?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                               'fashion', false, 8,  true),
  ('Filmora',        'https://apps.apple.com/ph/app/filmora-ai-video-editor-maker/id1019382747','https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_Filmora_brand_logo.jpg?t=1768144507016',            'app',     false, 9,  true),
  ('Fashion Chingu', 'https://www.fashionchingu.com',                                           'https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_Fashion%20Chingu_brand_logo.jpg?t=1768144624149',   'fashion', false, 10, true),
  ('OldRoll Cam',    'https://apps.apple.com/ph/app/oldroll-vintage-film-camera/id1570093460',  'https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_OldRoll%20Cam_brand_logo.jpg?t=1768550686154',     'app',     false, 11, true),
  ('VivaVideo',      'https://vivavideo.tv',                                                    'https://img.logo.dev/vivavideo.tv?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                              'app',     false, 12, true),
  ('Reelsapp',       'https://apps.apple.com/ph/app/reelsapp-reel-video-editor/id1609942350',   'https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_Reelsapp_brand_logo.jpg?t=1768144848187',           'app',     false, 13, true),
  ('BeautyPlus',     'https://apps.apple.com/ph/app/beautyplus-selfie-photo-editor/id622434129','https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_BeautyPlus_brand_logo.jpg?t=1768147321442',          'beauty',  false, 14, true),
  ('ProCCD',         'https://apps.apple.com/ph/app/proccd-digital-film-camera/id1616113199',   'https://cdn.beacons.ai/user_content/HoYsYgs17jNtAiffYBlDfHRCZAB2/mediakit_ProCCD_brand_logo.jpg?t=1768144736365',             'app',     false, 15, true),
  ('Hypic MOD APK',  'https://hypic.co',                                                        'https://img.logo.dev/hypic.co?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                                  'app',     false, 16, true),
  ('Halara',         'https://thehalara.com',                                                   'https://img.logo.dev/thehalara.com?token=pk_B7yuqACiTu6q29RrYrQD2Q',                                                             'fashion', false, 17, true);

commit;

-- DURABILITY NOTE (senior-backend): these logo_urls are EXTERNAL hotlinks. logo.dev
-- with the source kit's public token + the beacons CDN both resolve today, but
-- neither is under our control (token can be rate-limited/rotated; CDN objects can
-- be purged). The durable path is to upload each logo into a public Supabase Storage
-- bucket and store THAT url in logo_url — a future "image upload" task. Until then,
-- the page falls back to the brand's initials if a logo 404s.
