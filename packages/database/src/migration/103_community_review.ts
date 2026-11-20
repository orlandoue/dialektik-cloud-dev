import { sql, type Migration } from 'kysely';

// Community contributions with a stated version and sense, a review queue
// and protection of the public vote split (migration 103).
// - position_id: the version the contribution is about (null: the case as a
//   whole). An id, not «A»/«B»: which version is A is drawn per reader.
// - stance: whether the link supports, contradicts or gives context.
// - status: the first link contributions of each account wait for a
//   moderator (in_review); rejected ones stay hidden. Earlier rows are
//   published. Only the moderator flag Core sets for moderators changes it.
// - dialektik_account_created_at: lets Core leave accounts younger than 72 h
//   out of the public split, without reading auth.users itself.
// Idempotent.
export const communityReviewSql = String.raw`
alter table public.social_community_entries add column if not exists position_id dialektik_ulid;
alter table public.social_community_entries add column if not exists stance text;
alter table public.social_community_entries add column if not exists status text not null default 'published';
alter table public.social_community_entries add column if not exists reviewed_at timestamptz;
alter table public.social_community_entries add column if not exists reviewed_by uuid;
do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_community_entries_stance') then
    alter table public.social_community_entries add constraint social_community_entries_stance
      check (stance is null or stance in ('supports', 'contradicts', 'context'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_community_entries_status') then
    alter table public.social_community_entries add constraint social_community_entries_status
      check (status in ('published', 'in_review', 'rejected'));
  end if;
end
$checks$;
create index if not exists social_community_entries_review_idx
  on public.social_community_entries (created_at) where status = 'in_review';

create or replace function public.dialektik_account_created_at(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, auth
as $fn$ select created_at from auth.users where id = p_user $fn$;
revoke all on function public.dialektik_account_created_at(uuid) from public, anon, authenticated;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant update (status, reviewed_at, reviewed_by) on public.social_community_entries to dialektik_core_app;
    grant execute on function public.dialektik_account_created_at(uuid) to dialektik_core_app;
    drop policy if exists social_community_entries_review on public.social_community_entries;
    create policy social_community_entries_review on public.social_community_entries for update to dialektik_core_app
      using (current_setting('dialektik.science_moderator', true) = 'on')
      with check (current_setting('dialektik.science_moderator', true) = 'on');
  end if;
end
$grants$;
`;

export const communityReviewMigration: Migration = {
  async up(db) { await sql.raw(communityReviewSql).execute(db); },
  async down() { throw new Error('Community review is forward-only.'); },
};
