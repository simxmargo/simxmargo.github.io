-- 0016_contact_alternates.sql
-- One contact row per company, with the runners-up kept on the row.
--
-- WHY THIS COLUMN EXISTS
--   The scraper used to write EVERY address a site published. meandem.com publishes one
--   mailbox per retail store, so it produced 21 rows; goodhousekeeping.com produced 8.
--   At the time of writing, 93 of 166 contacts — 56% of the table — were redundant rows
--   for a company already represented, and 96 sat at 'skip' because the post-send sweep
--   had archived them after the fact.
--
--   The scraper now ranks the addresses it finds and writes ONE. That alone would throw
--   the alternates away, and they are worth keeping for exactly one reason: when the
--   chosen address bounces, promoting a runner-up costs a single UPDATE, while
--   re-crawling the site costs a queue slot, a politeness delay per page, and — for the
--   59% of sites that answer our user agent with 403 — probably yields nothing at all.
--
-- SHAPE (validated by the CHECK below, which only asserts it is an array):
--   [{"email": "press@brand.com", "type": "press", "score": 46}, …]
--   Capped at 8 entries by MAX_ALTERNATES in lib/outreach/pickEmail.ts.
--
-- `confidence` is NOT added here — it has existed since 0001 as the Hunter.io
-- enrichment score and has been unused since Hunter was dropped. The ranker reuses it
-- rather than adding a second, near-identical column.
--
-- Idempotent — `npm run db:apply` re-runs every migration file.

begin;

alter table public.contacts
  add column if not exists alternates jsonb not null default '[]'::jsonb;

-- Guard the shape at the boundary rather than trusting every future writer. A scalar or
-- an object here would break the UI's `.map()` at render time, which is a long way from
-- the write that caused it.
alter table public.contacts drop constraint if exists contacts_alternates_is_array;
alter table public.contacts add constraint contacts_alternates_is_array
  check (jsonb_typeof(alternates) = 'array');

comment on column public.contacts.alternates is
  'Runner-up addresses for this company, best first: [{email,type,score}]. Promote one if the chosen address bounces. Written by lib/outreach/pickEmail.ts.';

comment on column public.contacts.confidence is
  'Address-quality score 0-100 from lib/outreach/pickEmail.ts — role intent plus publication signals. Higher means more likely to be read by a human who handles collaborations.';

-- The working list is ordered by how good the address is, so the sort must not be a
-- sequential scan once the table grows past a few hundred rows.
create index if not exists contacts_confidence_idx
  on public.contacts (confidence desc nulls last);

commit;
