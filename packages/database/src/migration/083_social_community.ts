import { sql, type Migration } from 'kysely';

// Only the Core role has access. The user's identity is set transaction-locally
// after the beta JWT has been verified; it is never accepted from the client.
export const socialCommunitySql = String.raw`
create table public.social_reactions (
  event_id dialektik_ulid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('SOLID', 'BIASED')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create table public.social_evidence_comments (
  id uuid primary key default gen_random_uuid(),
  event_id dialektik_ulid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id dialektik_ulid not null references public.articles(id),
  body text not null check (char_length(btrim(body)) between 1 and 600),
  created_at timestamptz not null default now()
);
create index social_comments_event_created_idx on public.social_evidence_comments(event_id, created_at desc);
alter table public.social_reactions enable row level security;
alter table public.social_evidence_comments enable row level security;
revoke all on public.social_reactions, public.social_evidence_comments from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.social_reactions to dialektik_core_app;
grant select, insert on public.social_evidence_comments to dialektik_core_app;
create policy social_reactions_read on public.social_reactions for select to dialektik_core_app using (true);
create policy social_reactions_insert on public.social_reactions for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy social_reactions_update on public.social_reactions for update to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy social_reactions_delete on public.social_reactions for delete to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy social_comments_read on public.social_evidence_comments for select to dialektik_core_app using (true);
create policy social_comments_insert on public.social_evidence_comments for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
`;

export const socialCommunityMigration: Migration = {
  async up(db) { await sql.raw(socialCommunitySql).execute(db); },
  async down() { throw new Error('Social community data is forward-only.'); },
};
