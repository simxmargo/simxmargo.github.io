-- DEV SEED: outreach contact leads (mirrors lib/mock/contacts.ts) so the Outreach
-- Studio (Contacts / Send Queue) shows real DB rows instead of in-memory mock.
-- NOT a migration — kept out of migrations/ so it never runs on prod (per the
-- "seed migrations = prod risk" rule). Idempotent via the unique(email) constraint.
-- Apply with: npm run db:seed  (or the Supabase SQL editor).

insert into contacts (brand, email, email_type, country, website, fit_score, fit_reason, status, notes, last_emailed_at, created_at) values
  ('Reformation','partnerships@thereformation.com','partnerships','United States','thereformation.com',9,'Sustainable womenswear with a young, fashion-forward IG audience — strong overlap.','new','',null,'2026-06-10T09:00:00Z'),
  ('Glossier','press@glossier.com','press','United States','glossier.com',8,'Beauty brand built on creator content; press inbox monitored for collabs.','new','',null,'2026-06-10T09:01:00Z'),
  ('Gymshark','influencers@gymshark.com','named','United Kingdom','gymshark.com',7,'Heavy influencer program; lifestyle/fitness lean fits part of your content.','queued','Pitch the athleisure angle.',null,'2026-06-09T12:00:00Z'),
  ('Frank Body','hello@frankbody.com','generic','Australia','frankbody.com',8,'Skincare DTC with playful creator-led marketing; SEA audience is a plus.','new','',null,'2026-06-10T09:03:00Z'),
  ('Mejuri','partnerships@mejuri.com','partnerships','Canada','mejuri.com',8,'Everyday fine jewelry; strong fit for OOTD/lifestyle styling content.','sent','Sent 2026-06-12.','2026-06-12T03:00:00Z','2026-06-08T10:00:00Z'),
  ('Dr. Jart+','info@drjart.com','generic','United States','drjart.com',6,'K-beauty skincare; relevant niche but large brand, generic inbox.','new','',null,'2026-06-10T09:05:00Z'),
  ('Princess Polly','collabs@princesspolly.com','named','Australia','princesspolly.com',9,'Gen-Z fashion, dedicated collabs inbox, exactly your demographic.','replied','Replied — asked for media kit!','2026-06-11T02:00:00Z','2026-06-07T10:00:00Z'),
  ('The Inkey List','press@theinkeylist.com','press','United Kingdom','theinkeylist.com',7,'Affordable skincare popular with beauty creators; press inbox.','new','',null,'2026-06-10T09:07:00Z'),
  ('Sézane','contact@sezane.com','generic','Ireland','sezane.com',7,'French-inspired fashion with EU/IE presence; elevated lifestyle fit.','new','',null,'2026-06-10T09:08:00Z'),
  ('Aritzia','pr@aritzia.com','press','Canada','aritzia.com',6,'Popular everyday fashion; bigger brand, PR inbox — worth a shot.','skip','Too big, low reply odds — deprioritized.',null,'2026-06-09T08:00:00Z'),
  ('Youth To The People','partnerships@youthtothepeople.com','partnerships','United States','youthtothepeople.com',8,'Clean skincare, creator-friendly, clear partnerships contact.','new','',null,'2026-06-10T09:10:00Z'),
  ('Monica Vinader','hello@monicavinader.com','generic','United Kingdom','monicavinader.com',7,'Demi-fine jewelry; styling content fit, UK-based.','new','',null,'2026-06-10T09:11:00Z')
on conflict (email) do nothing;
