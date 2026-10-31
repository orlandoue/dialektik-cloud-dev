import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
do $roles$
begin
  if not exists(select 1 from pg_roles where rolname='dialektik_corporate_live_writer') then
    execute 'create role dialektik_corporate_live_writer nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls';
  end if;
  execute 'alter role dialektik_corporate_live_writer with nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls';

  if not exists(select 1 from pg_roles where rolname='dialektik_corporate_live_service_20261031') then
    execute 'create role dialektik_corporate_live_service_20261031 login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 5';
  end if;
  execute 'alter role dialektik_corporate_live_service_20261031 with login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 5';
  execute 'alter role dialektik_corporate_live_service_20261031 set default_transaction_read_only=off';
  execute 'alter role dialektik_corporate_live_service_20261031 set search_path=public';
  execute 'alter role dialektik_corporate_live_service_20261031 set statement_timeout=''20s''';
end;
$roles$;

do $dependencies$
begin
  if not exists(select 1 from pg_roles where rolname='dialektik_core_app')
    or not exists(select 1 from pg_roles where rolname='dialektik_govuk_metadata_writer') then
    raise exception 'MIGRATION_068_REQUIRED_RUNTIME_ROLES_MISSING';
  end if;
end;
$dependencies$;

grant connect on database postgres to dialektik_corporate_live_service_20261031;
grant usage on schema public to dialektik_corporate_live_writer;
grant dialektik_core_app,dialektik_govuk_metadata_writer,dialektik_corporate_live_writer
  to dialektik_corporate_live_service_20261031;

-- Feed excerpts remain a bounded metadata field; the normal metadata writer
-- keeps its existing column grants and the new role receives only excerpt access.
grant select(excerpt),insert(excerpt) on public.live_article_versions
  to dialektik_corporate_live_writer;
grant update(text_original,text_normalized,lang) on public.articles
  to dialektik_corporate_live_writer;

create function public.dialektik_corporate_live_source_write_allowed(source_identity dialektik_ulid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
  select exists(
    select 1
    from public.sources source
    join lateral (
      select decision.* from public.personal_owner_source_rights_decisions decision
      where decision.source_id=source.id and decision.owner_identity='orlandoue'
      order by decision.sequence_number desc limit 1
    ) decision on true
    join lateral (
      select policy.* from public.live_source_policies policy
      where policy.source_id=source.id order by policy.recorded_at desc,policy.id desc limit 1
    ) policy on true
    where source.id=source_identity and source.origin='LIVE_REAL'
      and decision.decision_status='AUTHORIZED' and decision.local_processing
      and decision.valid_from<=statement_timestamp()
      and (decision.expires_at is null or decision.expires_at>statement_timestamp())
      and decision.scopes->>'acquisition'='true'
      and decision.scopes->>'metadata_storage'='true'
      and decision.scopes->>'excerpt_storage'='true'
      and decision.scopes->>'fulltext_acquisition'='false'
      and decision.scopes->>'fulltext_persistence'='false'
      and policy.active and policy.rights_class='LIVE_READY'
      and policy.storage_policy='METADATA_AND_FEED_EXCERPT'
      and policy.policy->>'rightsReviewStatus'='APPROVED'
      and nullif(policy.policy->>'authorizationReference','') is not null
      and nullif(policy.policy->>'endpoint','') is not null
      and policy.policy->>'endpoint'<>'https://supabase.com'
      and nullif(policy.policy->>'rightsEvidenceUrl','') is not null
      and policy.policy->>'rightsEvidenceUrl'<>'https://supabase.com'
  )
$$;
revoke all on function public.dialektik_corporate_live_source_write_allowed(dialektik_ulid)
  from public,anon,authenticated;
grant execute on function public.dialektik_corporate_live_source_write_allowed(dialektik_ulid)
  to dialektik_corporate_live_writer;

create policy corporate_live_article_excerpt_projection_update on public.articles
  for update to dialektik_corporate_live_writer
  using (
    origin='LIVE_REAL'
    and current_setting('dialektik.allow_live_excerpt_projection',true)='on'
    and public.dialektik_corporate_live_source_write_allowed(source_id)
  )
  with check (
    origin='LIVE_REAL'
    and current_setting('dialektik.allow_live_excerpt_projection',true)='on'
    and public.dialektik_corporate_live_source_write_allowed(source_id)
  );
`;

export const corporateLiveAcquisitionWriterDdl = { schema: SCHEMA } as const;

export const corporateLiveAcquisitionWriterMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(corporateLiveAcquisitionWriterDdl.schema).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Corporate live acquisition service grants must be revoked explicitly.');
  },
};
