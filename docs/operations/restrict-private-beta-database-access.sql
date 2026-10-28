-- Restrict direct public table access and remove semantic writes from the
-- private-beta reader and metadata-ingestion roles. Run as the project owner.
-- This script does not alter records, authentication users, or the dedicated
-- semantic writer's own permissions. The transaction aborts on unexpected
-- policies or if the reader loses access to its event table.
begin;

do $$
declare
  table_name text;
  policy_name text;
  reader text := 'dialektik_core_app';
  metadata_writer text := 'dialektik_govuk_metadata_writer';
  semantic_tables text[] := array[
    'events', 'event_topics', 'topics', 'categories', 'occurrences',
    'assertions', 'claim_spans', 'evidence', 'evidence_assessments',
    'relationships', 'relationship_endpoints', 'contradiction_publications',
    'positions', 'primary_facts', 'attribution_chain'
  ];
  public_tables text[] := array[
    'articles', 'assertions', 'claim_spans', 'contradiction_publications',
    'event_topics', 'events', 'live_acquisition_receipts', 'live_article_versions',
    'live_exposure_exclusions', 'live_source_policies', 'positions',
    'primary_facts', 'public_events', 'sources', 'topics'
  ];
begin
  if not exists (select 1 from pg_roles where rolname = reader)
    or not exists (select 1 from pg_roles where rolname = metadata_writer)
    or not exists (select 1 from pg_roles where rolname = 'dialektik_semantic_writer')
  then
    raise exception 'Expected private-beta roles are not present';
  end if;

  foreach table_name in array public_tables loop
    if exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = table_name
        and p.policyname = 'public_select_policy'
        and (p.cmd <> 'SELECT' or p.roles::text <> '{public}' or p.qual <> 'true')
    ) then
      raise exception 'Unexpected public policy on %', table_name;
    end if;
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists public_select_policy on public.%I', table_name);
    end if;
  end loop;

  execute format('revoke dialektik_semantic_writer from %I', reader);
  execute format('revoke dialektik_semantic_writer from %I', metadata_writer);

  foreach table_name in array semantic_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;
    policy_name := 'dialektik_semantic_writer_' || table_name || '_write';
    if exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = table_name
        and p.policyname = policy_name
        and (p.cmd <> 'ALL' or p.qual <> 'true' or p.with_check <> 'true'
          or p.roles::text not in (
            '{dialektik_core_app,dialektik_govuk_metadata_writer,dialektik_semantic_writer}',
            '{dialektik_semantic_writer}'
          ))
    ) then
      raise exception 'Unexpected semantic policy on %', table_name;
    end if;
    if exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = table_name
        and p.policyname = policy_name
    ) then
      execute format('alter policy %I on public.%I to dialektik_semantic_writer', policy_name, table_name);
    end if;
    execute format('revoke insert, update, delete on public.%I from %I, %I',
                   table_name, reader, metadata_writer);
    if has_table_privilege(reader, format('public.%I', table_name), 'INSERT')
      or has_table_privilege(reader, format('public.%I', table_name), 'UPDATE')
      or has_table_privilege(reader, format('public.%I', table_name), 'DELETE')
      or has_any_column_privilege(reader, format('public.%I', table_name), 'INSERT')
      or has_any_column_privilege(reader, format('public.%I', table_name), 'UPDATE')
      or has_table_privilege(metadata_writer, format('public.%I', table_name), 'INSERT')
      or has_table_privilege(metadata_writer, format('public.%I', table_name), 'UPDATE')
      or has_table_privilege(metadata_writer, format('public.%I', table_name), 'DELETE')
      or has_any_column_privilege(metadata_writer, format('public.%I', table_name), 'INSERT')
      or has_any_column_privilege(metadata_writer, format('public.%I', table_name), 'UPDATE')
    then
      raise exception 'A restricted role still has semantic write access to %', table_name;
    end if;
  end loop;

  if pg_has_role(reader, 'dialektik_semantic_writer', 'MEMBER')
    or pg_has_role(metadata_writer, 'dialektik_semantic_writer', 'MEMBER')
    or not has_table_privilege(reader, 'public.events', 'SELECT')
  then
    raise exception 'Private-beta role validation failed';
  end if;
end
$$;

commit;
