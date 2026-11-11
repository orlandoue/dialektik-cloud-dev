import { sql, type Migration } from 'kysely';

// Arena participation: one vote per reader for a posture of a case, and the
// three community channels with shared usefulness votes. Only the Core role
// has access; the reader identity is set transaction-locally after the beta
// JWT is verified and is never accepted from the client.
export const socialArenaSql = String.raw`
create table public.social_position_votes (
  event_id dialektik_ulid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id dialektik_ulid not null references public.positions(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index social_position_votes_position_idx on public.social_position_votes(event_id, position_id);

create table public.social_community_entries (
  id uuid primary key default gen_random_uuid(),
  event_id dialektik_ulid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('DEBATE', 'APORTE', 'NOTA')),
  author_alias text not null check (char_length(btrim(author_alias)) between 2 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 600),
  article_id dialektik_ulid references public.articles(id),
  link_url text check (link_url is null or (link_url ~ '^https?://' and char_length(link_url) <= 2000)),
  created_at timestamptz not null default now(),
  -- Contributions and context notes must carry a verifiable source.
  constraint social_community_entries_source_required
    check (channel = 'DEBATE' or article_id is not null or link_url is not null)
);
create index social_community_entries_event_idx on public.social_community_entries(event_id, created_at desc);

-- entry_id also addresses rows of social_evidence_comments (earlier
-- contributions), so it is validated by Core instead of a foreign key.
create table public.social_entry_votes (
  entry_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (1, -1)),
  updated_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

alter table public.social_position_votes enable row level security;
alter table public.social_community_entries enable row level security;
alter table public.social_entry_votes enable row level security;
revoke all on public.social_position_votes, public.social_community_entries, public.social_entry_votes
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.social_position_votes to dialektik_core_app;
grant select, insert on public.social_community_entries to dialektik_core_app;
grant select, insert, update, delete on public.social_entry_votes to dialektik_core_app;

create policy social_position_votes_read on public.social_position_votes for select to dialektik_core_app using (true);
create policy social_position_votes_insert on public.social_position_votes for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy social_position_votes_update on public.social_position_votes for update to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy social_position_votes_delete on public.social_position_votes for delete to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);

create policy social_community_entries_read on public.social_community_entries for select to dialektik_core_app using (true);
create policy social_community_entries_insert on public.social_community_entries for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);

create policy social_entry_votes_read on public.social_entry_votes for select to dialektik_core_app using (true);
create policy social_entry_votes_insert on public.social_entry_votes for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy social_entry_votes_update on public.social_entry_votes for update to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy social_entry_votes_delete on public.social_entry_votes for delete to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
`;

export const socialArenaMigration: Migration = {
  async up(db) { await sql.raw(socialArenaSql).execute(db); },
  async down() { throw new Error('Social community data is forward-only.'); },
};
