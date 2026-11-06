import { sql, type Migration } from 'kysely';

// Returns only a public aggregate. Follow rows stay private to their owners.
export const socialFollowerCountSql = String.raw`
create function public.social_follower_count(p_source_id dialektik_ulid) returns integer
  language sql stable security definer set search_path = pg_catalog
  as $$ select count(*)::integer from public.user_followed_sources where source_id=p_source_id $$;
revoke all on function public.social_follower_count(dialektik_ulid) from public, anon, authenticated, service_role;
grant execute on function public.social_follower_count(dialektik_ulid) to dialektik_core_app;
`;
export const socialFollowerCountMigration: Migration = {
  async up(db) { await sql.raw(socialFollowerCountSql).execute(db); },
  async down() { throw new Error('Social community data is forward-only.'); },
};
