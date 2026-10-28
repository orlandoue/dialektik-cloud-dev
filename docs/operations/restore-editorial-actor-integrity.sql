-- Applied to dialektik-dev on 2026-10-28 UTC. Retained for review and recovery.
-- Restore two foreign keys from migration 001 and enforce attribution on new
-- contradiction writes. Existing rows and user accounts are not modified.
-- The NOT VALID check preserves historical rows without a recorded confirmer.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.positions
  add constraint positions_published_by_fkey
  foreign key (published_by) references public.users(id);

alter table public.contradiction_publications
  add constraint contradiction_publications_confirmed_by_fkey
  foreign key (confirmed_by) references public.users(id);

alter table public.contradiction_publications
  add constraint contradiction_publications_confirmed_by_present
  check (confirmed_by is not null) not valid;

commit;
