import { sql, type Migration } from 'kysely';

export const userFollowedSourcesSql = String.raw`
create table public.user_followed_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id dialektik_ulid not null references public.sources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, source_id)
);
create index user_followed_sources_source_idx on public.user_followed_sources(source_id);
alter table public.user_followed_sources enable row level security;
revoke all on public.user_followed_sources from public, anon, authenticated, service_role;
grant select, insert, delete on public.user_followed_sources to dialektik_core_app;
create policy user_followed_sources_core_select on public.user_followed_sources for select to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.follow_user',true),'')::uuid);
create policy user_followed_sources_core_insert on public.user_followed_sources for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.follow_user',true),'')::uuid);
create policy user_followed_sources_core_delete on public.user_followed_sources for delete to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.follow_user',true),'')::uuid);
`;
export const userFollowedSourcesMigration: Migration = {
  async up(db) { await sql.raw(userFollowedSourcesSql).execute(db); },
  async down() { throw new Error('Follow preferences are forward-only.'); },
};
