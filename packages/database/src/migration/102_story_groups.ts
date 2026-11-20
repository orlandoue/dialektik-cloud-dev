import { sql, type Migration } from 'kysely';

// Stories that group several published events about one developing topic
// (migration 102). The semantic engine pairs two notes per event, so one
// story (Kast's tour of Asia) used to appear as 17 events of 2 outlets.
// Core proposes groupings from shared names, words and dates (no AI); only a
// moderator approves one, with its title, and nothing is grouped
// automatically. Events and duels are never merged or changed: a story only
// lists them. An event belongs to at most one story.
// - story_group_proposals: what Core proposes; rejected ones are kept by
//   signature so the same set is not proposed again.
// - story_groups / story_group_events: approved stories.
// Core reads everything (public stories) and writes proposals; approving,
// rejecting and editing stories needs the moderator flag Core sets for
// moderators (dialektik.science_moderator). Idempotent.
export const storyGroupsSql = String.raw`
create table if not exists public.story_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  -- Plain ids: public_events has no unique key to reference in every
  -- deployment; Core only takes them from public_events.
  cover_event_id dialektik_ulid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_by uuid not null
);
create table if not exists public.story_group_events (
  event_id dialektik_ulid primary key,
  group_id uuid not null references public.story_groups(id) on delete cascade,
  added_at timestamptz not null default now()
);
create index if not exists story_group_events_group_idx on public.story_group_events (group_id);
create table if not exists public.story_group_proposals (
  id uuid primary key default gen_random_uuid(),
  signature text not null unique check (signature ~ '^[0-9a-f]{16,64}$'),
  target_group_id uuid references public.story_groups(id) on delete cascade,
  event_ids text[] not null check (cardinality(event_ids) between 1 and 60),
  suggested_title text not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  proposed_at timestamptz not null default now(),
  -- Last proposer run that still produced this set; older open proposals
  -- are stale (their events changed) and are not shown.
  seen_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  constraint story_group_proposals_decided check ((status = 'proposed') = (decided_at is null))
);
create index if not exists story_group_proposals_open_idx on public.story_group_proposals (proposed_at desc)
  where status = 'proposed';

alter table public.story_groups enable row level security;
alter table public.story_groups force row level security;
alter table public.story_group_events enable row level security;
alter table public.story_group_events force row level security;
alter table public.story_group_proposals enable row level security;
alter table public.story_group_proposals force row level security;
revoke all on public.story_groups, public.story_group_events, public.story_group_proposals
  from public, anon, authenticated;

do $grants$
declare
  moderator constant text := 'current_setting(''dialektik.science_moderator'', true) = ''on''';
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant select, insert, update, delete on public.story_groups, public.story_group_events to dialektik_core_app;
    grant select, insert, update on public.story_group_proposals to dialektik_core_app;
    drop policy if exists story_groups_read on public.story_groups;
    drop policy if exists story_groups_moderate on public.story_groups;
    drop policy if exists story_group_events_read on public.story_group_events;
    drop policy if exists story_group_events_moderate on public.story_group_events;
    drop policy if exists story_group_proposals_read on public.story_group_proposals;
    drop policy if exists story_group_proposals_propose on public.story_group_proposals;
    drop policy if exists story_group_proposals_decide on public.story_group_proposals;
    create policy story_groups_read on public.story_groups for select to dialektik_core_app using (true);
    execute format('create policy story_groups_moderate on public.story_groups for all to dialektik_core_app using (%s) with check (%s)', moderator, moderator);
    create policy story_group_events_read on public.story_group_events for select to dialektik_core_app using (true);
    execute format('create policy story_group_events_moderate on public.story_group_events for all to dialektik_core_app using (%s) with check (%s)', moderator, moderator);
    create policy story_group_proposals_read on public.story_group_proposals for select to dialektik_core_app using (true);
    create policy story_group_proposals_propose on public.story_group_proposals for insert to dialektik_core_app
      with check (status = 'proposed' and decided_at is null and decided_by is null);
    execute format('create policy story_group_proposals_decide on public.story_group_proposals for update to dialektik_core_app using (%s) with check (%s)', moderator, moderator);
  end if;
end
$grants$;
`;

export const storyGroupsMigration: Migration = {
  async up(db) { await sql.raw(storyGroupsSql).execute(db); },
  async down() { throw new Error('Story groups are forward-only.'); },
};
