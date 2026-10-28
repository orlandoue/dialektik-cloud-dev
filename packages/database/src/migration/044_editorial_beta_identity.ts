import { sql, type Migration } from 'kysely';

/** Explicit, revocable association between a beta identity and an editorial user. */
const SCHEMA = String.raw`
create table if not exists public.editorial_beta_identities (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  editorial_user_id dialektik_ulid not null unique references public.users(id),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint editorial_beta_identity_revocation_coherent
    check (revoked_at is null or enabled is false)
);

-- Refuse a pre-existing table with an incompatible shape. This keeps the
-- migration safe to apply after the same schema has been installed manually.
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'editorial_beta_identities') <> 5
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'editorial_beta_identities'
        and column_name = 'auth_user_id' and data_type = 'uuid' and is_nullable = 'NO')
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'editorial_beta_identities'
        and column_name = 'editorial_user_id' and domain_name = 'dialektik_ulid' and is_nullable = 'NO')
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'editorial_beta_identities'
        and column_name = 'enabled' and data_type = 'boolean' and is_nullable = 'NO')
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'editorial_beta_identities'
        and column_name = 'created_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO')
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'editorial_beta_identities'
        and column_name = 'revoked_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES')
    or (select count(*) from pg_constraint
      where conrelid = 'public.editorial_beta_identities'::regclass
        and conname in ('editorial_beta_identities_pkey',
          'editorial_beta_identities_editorial_user_id_key',
          'editorial_beta_identities_auth_user_id_fkey',
          'editorial_beta_identities_editorial_user_id_fkey',
          'editorial_beta_identity_revocation_coherent')) <> 5
    or not exists (select 1 from pg_constraint c
      where c.conrelid = 'public.editorial_beta_identities'::regclass
        and c.conname = 'editorial_beta_identities_pkey' and c.contype = 'p'
        and c.conkey = array[(select attnum from pg_attribute
          where attrelid = c.conrelid and attname = 'auth_user_id')])
    or not exists (select 1 from pg_constraint c
      where c.conrelid = 'public.editorial_beta_identities'::regclass
        and c.conname = 'editorial_beta_identities_editorial_user_id_key' and c.contype = 'u'
        and c.conkey = array[(select attnum from pg_attribute
          where attrelid = c.conrelid and attname = 'editorial_user_id')])
    or not exists (select 1 from pg_constraint c
      where c.conrelid = 'public.editorial_beta_identities'::regclass
        and c.conname = 'editorial_beta_identities_auth_user_id_fkey' and c.contype = 'f'
        and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c'
        and c.conkey = array[(select attnum from pg_attribute
          where attrelid = c.conrelid and attname = 'auth_user_id')])
    or not exists (select 1 from pg_constraint c
      where c.conrelid = 'public.editorial_beta_identities'::regclass
        and c.conname = 'editorial_beta_identities_editorial_user_id_fkey' and c.contype = 'f'
        and c.confrelid = 'public.users'::regclass
        and c.conkey = array[(select attnum from pg_attribute
          where attrelid = c.conrelid and attname = 'editorial_user_id')])
    or not exists (select 1 from pg_constraint c
      where c.conrelid = 'public.editorial_beta_identities'::regclass
        and c.conname = 'editorial_beta_identity_revocation_coherent' and c.contype = 'c'
        and regexp_replace(lower(pg_get_expr(c.conbin, c.conrelid)), '[[:space:]()]', '', 'g')
          = 'revoked_atisnullorenabledisfalse') then
    raise exception 'Existing editorial beta identity table has an incompatible schema';
  end if;
end
$$;

alter table public.editorial_beta_identities enable row level security;
revoke all on table public.editorial_beta_identities from public, anon, authenticated;
grant select on table public.editorial_beta_identities to dialektik_core_app;

do $$
declare existing_policy record;
begin
  if exists (select 1 from pg_policy
    where polrelid = 'public.editorial_beta_identities'::regclass
      and polname <> 'editorial_beta_identity_core_active_read') then
    raise exception 'Unexpected policy on editorial beta identities';
  end if;
  select p.polcmd, p.polroles, pg_get_expr(p.polqual, p.polrelid) as condition
    into existing_policy from pg_policy p
    where p.polrelid = 'public.editorial_beta_identities'::regclass
      and p.polname = 'editorial_beta_identity_core_active_read';
  if not found then
    create policy editorial_beta_identity_core_active_read
      on public.editorial_beta_identities
      for select to dialektik_core_app
      using (enabled is true and revoked_at is null);
  elsif existing_policy.polcmd <> 'r'
    or existing_policy.polroles <> array['dialektik_core_app'::regrole::oid]
    or regexp_replace(lower(existing_policy.condition), '[[:space:]()]', '', 'g')
      <> 'enabledistrueandrevoked_atisnull' then
    raise exception 'Existing editorial beta identity policy has unexpected permissions';
  end if;
end
$$;
`;

export const editorialBetaIdentityMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Editorial identity bindings are forward-only.');
  },
};
