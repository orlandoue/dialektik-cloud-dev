import { sql, type Migration } from 'kysely';

// Science moderation, on top of 091.
//
// - science_studies.abstract_source: where the abstract came from (Crossref,
//   OpenAlex, or the publisher named by a moderator). A moderator may load an
//   abstract only from the published article, never a generated one; it is
//   then kept when Core resolves the DOI again.
// - story_comments.review_reason: the reason a moderator gives when rejecting
//   a comment in review or hiding a reported one.
// - story_comment_reports: one report per reader and comment, with a reason.
//   Reports reach the same moderation queue as study comments.
//
// Same rules as 091: only the Core role, row security bound to the reader set
// after the beta JWT, moderator actions only with the moderator flag that
// Core sets for DIALEKTIK_SCIENCE_MODERATORS. Idempotent.
export const scienceModerationSql = String.raw`
alter table public.science_studies add column if not exists abstract_source text;
alter table public.science_studies add column if not exists abstract_by_moderator boolean not null default false;
alter table public.story_comments add column if not exists review_reason text;
do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'science_studies_abstract_source_check') then
    alter table public.science_studies add constraint science_studies_abstract_source_check
      check (abstract_source is null or char_length(btrim(abstract_source)) between 2 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_comments_review_reason_check') then
    alter table public.story_comments add constraint story_comments_review_reason_check
      check (review_reason is null or char_length(btrim(review_reason)) between 2 and 300);
  end if;
end
$checks$;
-- Earlier abstracts all came from Crossref or OpenAlex; the exact one is
-- recorded from the next resolution on.
update public.science_studies set abstract_source = 'Crossref u OpenAlex'
  where abstract is not null and abstract_source is null;

create table if not exists public.story_comment_reports (
  comment_id uuid not null references public.story_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'ofensivo', 'desinformacion', 'datos_personales', 'otro')),
  note text check (note is null or char_length(btrim(note)) between 1 and 280),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('dismissed', 'hidden')),
  primary key (comment_id, user_id),
  constraint story_comment_reports_resolved check ((resolved_at is null) = (resolution is null))
);
create index if not exists story_comment_reports_open_idx on public.story_comment_reports(created_at) where resolved_at is null;

alter table public.story_comment_reports enable row level security;
alter table public.story_comment_reports force row level security;
revoke all on public.story_comment_reports from public, anon, authenticated, service_role;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant select, insert, update on public.story_comment_reports to dialektik_core_app;
  end if;
end
$grants$;

drop policy if exists story_comment_reports_read on public.story_comment_reports;
drop policy if exists story_comment_reports_insert on public.story_comment_reports;
drop policy if exists story_comment_reports_resolve on public.story_comment_reports;
create policy story_comment_reports_read on public.story_comment_reports for select to dialektik_core_app using (true);
-- A reader reports in their own name only, and never their own comment.
create policy story_comment_reports_insert on public.story_comment_reports for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid
    and resolved_at is null
    and not exists (select 1 from public.story_comments c where c.id = comment_id and c.user_id = story_comment_reports.user_id));
create policy story_comment_reports_resolve on public.story_comment_reports for update to dialektik_core_app
  using (current_setting('dialektik.science_moderator', true) = 'on')
  with check (current_setting('dialektik.science_moderator', true) = 'on');
`;

export const scienceModerationMigration: Migration = {
  async up(db) { await sql.raw(scienceModerationSql).execute(db); },
  async down() { throw new Error('Science moderation is forward-only.'); },
};
