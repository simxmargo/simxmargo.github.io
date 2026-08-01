-- 0014_contact_inbound_status.sql
-- Adds 'inbound' to the contacts status vocabulary.
--
-- WHY: every scraped lead sat at 'new' forever, which made the Status column carry no
-- information at all. The gap wasn't cosmetic — the vocabulary had no way to say the
-- one thing that most changes how you treat a brand: THEY contacted US.
--
--   new      scraped, never touched          (cold, we found them)
--   inbound  they reached out first          (warm — from a Work-with-me inquiry)
--   queued   scheduled to send
--   sent     pitched, awaiting a reply
--   replied  they answered our pitch
--   bounced  delivery failed
--   skip     deliberately passed over
--
-- 'inbound' and 'replied' are deliberately distinct: both mean a human wrote to you,
-- but one is a lead that arrived warm and the other is a cold pitch that worked. They
-- deserve different follow-ups, and collapsing them would lose the only signal that
-- tells you whether outreach is actually converting.
--
-- Idempotent — drop-then-add, so db:apply can re-run it.

begin;

alter table public.contacts drop constraint if exists contacts_status_check;

alter table public.contacts add constraint contacts_status_check
  check (status = any (array[
    'new'::text, 'inbound'::text, 'queued'::text, 'sent'::text,
    'replied'::text, 'bounced'::text, 'skip'::text
  ]));

commit;
