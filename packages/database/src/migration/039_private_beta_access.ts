import { sql, type Kysely, type Migration } from 'kysely';

import type { Database } from '../database.types';

const SCHEMA = `
-- Tighten inherited function execution before adding any private beta surface.
revoke execute on function public.dialektik_cloudflare_official_api_hash_only_decision_allowed(
  text, dialektik_ulid, dialektik_ulid, dialektik_ulid, dialektik_ulid,
  text, text, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.dialektik_title_only_external_authorization_available(
  dialektik_ulid, dialektik_ulid, dialektik_ulid, dialektik_ulid,
  text, text, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.dialektik_reserve_cloudflare_title_only_attempt(
  dialektik_ulid, text, dialektik_ulid, dialektik_ulid, dialektik_ulid,
  dialektik_ulid, text, text, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.dialektik_record_cloudflare_title_only_attempt_outcome(
  dialektik_ulid, text, integer, integer, text, timestamptz
) from public, anon, authenticated;

-- Core uses only the reservation and outcome routines; internal decisions run
-- under the owning database function. The client roles receive no EXECUTE.
grant execute on function public.dialektik_reserve_cloudflare_title_only_attempt(
  dialektik_ulid, text, dialektik_ulid, dialektik_ulid, dialektik_ulid,
  dialektik_ulid, text, text, text, text, text, text
) to dialektik_core_app;
grant execute on function public.dialektik_record_cloudflare_title_only_attempt_outcome(
  dialektik_ulid, text, integer, integer, text, timestamptz
) to dialektik_core_app;

-- Supabase migration execution is postgres in this project. Preserve the
-- owner-only default for future functions in public even if inherited defaults
-- are edited later. The supabase_admin role is not assumable by postgres here;
-- do not broaden role membership or alter platform-managed schema defaults.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

create table public.private_beta_testers (
  user_id uuid primary key references auth.users(id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint private_beta_testers_revocation_consistent
    check (revoked_at is null or enabled is false)
);
alter table public.private_beta_testers enable row level security;
revoke all on table public.private_beta_testers from public, anon, authenticated;
grant usage on schema public to dialektik_core_app;
grant select on table public.private_beta_testers to dialektik_core_app;
create policy private_beta_core_active_testers_read
  on public.private_beta_testers
  for select to dialektik_core_app
  using (enabled is true and revoked_at is null);
`;

export const privateBetaAccessMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Private beta access hardening is forward-only.');
  },
};
