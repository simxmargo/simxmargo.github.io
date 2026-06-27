-- Favicon: the browser-tab icon for the whole site (public kit + admin).
-- Editable in Settings → uploaded to storage, URL stored here. A dedicated column
-- (rather than the seo jsonb) keeps it typed and avoids read-merge-write clobber
-- between the Profile route (which owns seo.og_image_url) and the Settings route.
alter table public.public_profile add column if not exists favicon_url text;
