-- Restore checks from the repository that are independent of the unresolved
-- LIVE_REAL article/event design. The position check is installed NOT VALID:
-- it protects future writes while existing publications await real attribution.
begin;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.articles'::regclass
                   and conname = 'articles_not_syndicated_from_self') then
    alter table public.articles add constraint articles_not_syndicated_from_self
      check (syndication_of is null or syndication_of <> id);
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.events'::regclass
                   and conname = 'events_not_merged_into_self') then
    alter table public.events add constraint events_not_merged_into_self
      check (merged_into is null or merged_into <> id);
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.events'::regclass
                   and conname = 'events_merge_metadata_coherent') then
    alter table public.events add constraint events_merge_metadata_coherent
      check ((merged_into is null and merged_by is null and merged_at is null)
          or (merged_into is not null and merged_by is not null and merged_at is not null));
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.positions'::regclass
                   and conname = 'positions_publication_metadata_coherent') then
    alter table public.positions add constraint positions_publication_metadata_coherent
      check (publication_state <> 'published'
          or (neutral_rank is not null and published_at is not null and published_by is not null))
      not valid;
  end if;
end
$$;

commit;
