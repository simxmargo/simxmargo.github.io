-- Which marquee row a brand appears in on the public "brand partners" carousel.
-- NULL ⇒ the page auto-splits the list in half (back-compat for existing rows).
-- The "Top content" per-post fields (views/likes/caption) live inside the existing
-- portfolio_brands.media jsonb, so they need no column change.
alter table public.portfolio_brands
  add column if not exists row_index smallint
  check (row_index is null or row_index in (1, 2));
