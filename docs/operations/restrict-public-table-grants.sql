-- Private-beta tables and views are consumed through the authenticated Core.
-- Remove direct public SQL/REST reads while retaining every existing Core read
-- grant. Also stop postgres-owned future tables from inheriting public grants.
-- Supabase-managed default privileges for its own administrative role are not
-- altered. Execute as postgres, inside a single transaction.
begin;

do $$
declare
  relation record;
  core_readable oid[];
  core_oid oid;
begin
  select coalesce(array_agg(c.oid), array[]::oid[])
  into core_readable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege('dialektik_core_app', c.oid, 'SELECT');

  revoke select on all tables in schema public from public, anon, authenticated;
  alter default privileges for role postgres in schema public
    revoke all privileges on tables from public, anon, authenticated;

  foreach core_oid in array core_readable loop
    if not has_table_privilege('dialektik_core_app', core_oid, 'SELECT') then
      raise exception 'Revocation would remove a Core read grant';
    end if;
  end loop;

  for relation in
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if has_table_privilege('anon', relation.oid, 'SELECT')
      or has_table_privilege('authenticated', relation.oid, 'SELECT')
      or has_any_column_privilege('anon', relation.oid, 'SELECT')
      or has_any_column_privilege('authenticated', relation.oid, 'SELECT')
    then
      raise exception 'Direct beta table read remains on %', relation.relname;
    end if;
  end loop;
end
$$;

commit;
