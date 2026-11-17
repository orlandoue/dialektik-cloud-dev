import { sql, type Migration } from 'kysely';

// Privacy of comment reports, on top of 092.
//
// - Reading a report (who reported whom and why) is limited to a session
//   with the moderator flag that Core sets only for
//   DIALEKTIK_SCIENCE_MODERATORS, or to the reader who filed it. Before, any
//   Core session could read every report (using (true)).
// - A moderator may only resolve a report: the Core role can update
//   resolved_at and resolution and nothing else, so who reported, which
//   comment and the reason can never be changed.
//
// Idempotent; apply after 092 (and 093).
export const scienceReportPrivacySql = String.raw`
drop policy if exists story_comment_reports_read on public.story_comment_reports;
create policy story_comment_reports_read on public.story_comment_reports for select to dialektik_core_app
  using (current_setting('dialektik.science_moderator', true) = 'on'
    or user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    revoke update on public.story_comment_reports from dialektik_core_app;
    grant update (resolved_at, resolution) on public.story_comment_reports to dialektik_core_app;
  end if;
end
$grants$;
`;

export const scienceReportPrivacyMigration: Migration = {
  async up(db) { await sql.raw(scienceReportPrivacySql).execute(db); },
  async down() { throw new Error('Report privacy is forward-only.'); },
};
