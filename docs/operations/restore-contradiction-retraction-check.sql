-- Applied to dialektik-dev on 2026-10-28 UTC. Retained for review and recovery.
-- Restore the independent contradiction retraction check from migration 001.
-- No publication rows are changed; validation checks the existing rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.contradiction_publications
  add constraint contradiction_publications_retraction_coherent check (
    (publication_state = 'retracted' and retracted_by is not null
      and retracted_at is not null and retraction_reason is not null
      and btrim(retraction_reason) <> '')
    or (publication_state <> 'retracted' and retracted_by is null
      and retracted_at is null and retraction_reason is null)
  );
commit;
