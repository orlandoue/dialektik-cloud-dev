-- Applied to dialektik-dev on 2026-10-28 UTC. Retained for review and recovery.
-- Preserve the origin/exposure part of migration 017 while the Event-to-Article
-- design is resolved. The news endpoint still selects event_id IS NULL.
-- This check does not replace the original event_id rule in other environments.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.articles
  add constraint articles_live_exposure_presence_check check (
    (origin = 'LIVE_REAL' and live_exposure_id is not null)
    or (origin <> 'LIVE_REAL' and live_exposure_id is null)
  );
commit;
