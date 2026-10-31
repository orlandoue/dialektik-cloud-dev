import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
do $dependencies$
begin
  if not exists(select 1 from pg_roles where rolname='dialektik_corporate_live_writer')
    or to_regclass('public.prospective_content_rights_write_guards') is null
    or to_regclass('public.corporate_live_source_connections') is null then
    raise exception 'MIGRATION_072_REQUIRED_CORPORATE_RIGHTS_DEPENDENCIES_MISSING';
  end if;
end;
$dependencies$;

create or replace function public.dialektik_lock_corporate_source_rights_guard(source_identity dialektik_ulid)
returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if not exists(
    select 1
    from public.prospective_content_rights_write_guards guard
    join public.sources source on source.id=guard.source_id
    where guard.source_id=source_identity
      and source.origin='LIVE_REAL'
      and exists(
        select 1 from public.corporate_live_source_connections connection
        where connection.source_id=source.id
          and connection.active
          and connection.approved_by='01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid
      )
  ) then
    raise exception using errcode='42501',message='CORPORATE_SOURCE_RIGHTS_GUARD_UNAVAILABLE';
  end if;

  perform 1 from public.prospective_content_rights_write_guards
    where source_id=source_identity for update;
  if not found then
    raise exception using errcode='42501',message='CORPORATE_SOURCE_RIGHTS_GUARD_UNAVAILABLE';
  end if;
end;
$$;

revoke all on function public.dialektik_lock_corporate_source_rights_guard(dialektik_ulid)
  from public,anon,authenticated,service_role;
grant execute on function public.dialektik_lock_corporate_source_rights_guard(dialektik_ulid)
  to dialektik_corporate_live_writer;
`;

export const corporateLiveRightsGuardLockDdl = { schema: SCHEMA } as const;

export const corporateLiveRightsGuardLockMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(corporateLiveRightsGuardLockDdl.schema).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Corporate live rights guard locking must remain narrowly scoped.');
  },
};
