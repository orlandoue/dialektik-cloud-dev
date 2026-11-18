import { sql, type Migration } from 'kysely';

// Peer review and date precision of studies, on top of 091–094.
//
// - review may be «not_reported»: a repository record (Zenodo, OSF…) or a
//   source that does not say is never shown as peer reviewed.
// - review_by_moderator: a moderator set the review; resolving or harvesting
//   the DOI again keeps it.
// - published_precision: day, month or year, so a year-only date is shown
//   as the year and never as «1 ene».
//
// Idempotent.
export const scienceStudyReviewSql = String.raw`
alter table public.science_studies drop constraint if exists science_studies_review_check;
alter table public.science_studies add constraint science_studies_review_check
  check (review in ('peer_reviewed', 'preprint', 'not_reported'));
alter table public.science_studies add column if not exists review_by_moderator boolean not null default false;
alter table public.science_studies add column if not exists published_precision text not null default 'day';
do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'science_studies_published_precision_check') then
    alter table public.science_studies add constraint science_studies_published_precision_check
      check (published_precision in ('day', 'month', 'year'));
  end if;
end
$checks$;

-- Earlier rows were all called peer reviewed unless preprint: a repository
-- record says nothing about review.
update public.science_studies set review = 'not_reported'
  where review = 'peer_reviewed' and not review_by_moderator
    and (journal ilike any (array['%zenodo%', '%figshare%', '%osf%', '%researchgate%', '%repositor%'])
      or doi ~ '^10\.(5281|6084|31219|17605)/');
-- A 1 January date from a repository is almost always «year only».
update public.science_studies set published_precision = 'year'
  where published_precision = 'day' and to_char(published_at, 'MM-DD') = '01-01' and review = 'not_reported';

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_science_harvester') then
    grant insert (published_precision) on public.science_studies to dialektik_science_harvester;
    grant update (published_precision) on public.science_studies to dialektik_science_harvester;
  end if;
end
$grants$;
`;

export const scienceStudyReviewMigration: Migration = {
  async up(db) { await sql.raw(scienceStudyReviewSql).execute(db); },
  async down() { throw new Error('Study review is forward-only.'); },
};
