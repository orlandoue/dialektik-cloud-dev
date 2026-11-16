import { sql, type Migration } from 'kysely';

// Daily harvest of studies into the Science cache (Phase D).
//
// - dialektik_science_harvester: the role the GitHub Actions job connects
//   with. It is created without login; the owner gives it a password in the
//   SQL editor and stores the connection string as a GitHub secret. It can
//   only write the study cache, its own run log and API usage:
//   * column grants keep it away from every field a moderator completes
//     (design, population, sample, follow-up, funding, conflicts,
//     corrections, abstract_by_moderator, moderated_at);
//   * row security keeps it from overwriting an abstract a moderator loaded,
//     and lets it delete only harvested studies older than 90 days that no
//     comment connects to a story and no moderator touched.
// - science_studies.harvested_at / harvest_source: when and from where a
//   study entered by the harvest.
// - science_harvest_runs: one row per run with what it fetched, added,
//   updated and deleted, and the size of the tables. Core reads the latest
//   one to warn moderators when the harvest has not run for 48 hours.
//
// Idempotent; apply after 091 and 092.
export const scienceHarvestSql = String.raw`
alter table public.science_studies add column if not exists harvested_at timestamptz;
alter table public.science_studies add column if not exists harvest_source text;
do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'science_studies_harvest_source_check') then
    alter table public.science_studies add constraint science_studies_harvest_source_check
      check (harvest_source is null or harvest_source in ('openalex_cl', 'scielo_cl', 'europepmc', 'arxiv'));
  end if;
end
$checks$;
create index if not exists science_studies_harvest_idx on public.science_studies(harvested_at) where harvested_at is not null;

create table if not exists public.science_harvest_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  added integer not null default 0 check (added >= 0),
  updated integer not null default 0 check (updated >= 0),
  deleted integer not null default 0 check (deleted >= 0),
  -- Per source: fetched, added, updated, skipped, error; and table sizes.
  details jsonb not null default '{}'::jsonb
);
create index if not exists science_harvest_runs_started_idx on public.science_harvest_runs(started_at desc);

-- Whether any comment connects a study to a story. Only the answer leaves
-- the function, so the harvester never reads comments.
create or replace function public.dialektik_science_study_connected(p_doi text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$ select exists (select 1 from public.story_comment_studies where doi = p_doi) $fn$;
revoke all on function public.dialektik_science_study_connected(text) from public, anon, authenticated;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'dialektik_science_harvester') then
    create role dialektik_science_harvester nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$role$;
alter role dialektik_science_harvester nosuperuser nobypassrls;

alter table public.science_harvest_runs enable row level security;
alter table public.science_harvest_runs force row level security;
revoke all on public.science_harvest_runs from public, anon, authenticated, service_role;

grant usage on schema public to dialektik_science_harvester;
revoke all on public.science_studies from dialektik_science_harvester;
grant select on public.science_studies to dialektik_science_harvester;
grant insert (doi, title, review, authors, institution, journal, published_at, abstract, abstract_source,
  abstract_language, access, retracted, retracted_at, made_in_chile, resolved_at, harvested_at, harvest_source)
  on public.science_studies to dialektik_science_harvester;
grant update (title, review, authors, institution, journal, published_at, abstract, abstract_source,
  abstract_language, access, retracted, retracted_at, made_in_chile, resolved_at)
  on public.science_studies to dialektik_science_harvester;
grant delete on public.science_studies to dialektik_science_harvester;
grant select, insert, update on public.science_harvest_runs to dialektik_science_harvester;
grant select, insert, update on public.science_api_usage to dialektik_science_harvester;
grant execute on function public.dialektik_science_study_connected(text) to dialektik_science_harvester;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant select on public.science_harvest_runs to dialektik_core_app;
  end if;
end
$grants$;

drop policy if exists science_studies_harvest_read on public.science_studies;
drop policy if exists science_studies_harvest_insert on public.science_studies;
drop policy if exists science_studies_harvest_update on public.science_studies;
drop policy if exists science_studies_harvest_retention on public.science_studies;
create policy science_studies_harvest_read on public.science_studies for select to dialektik_science_harvester using (true);
create policy science_studies_harvest_insert on public.science_studies for insert to dialektik_science_harvester
  with check (harvested_at is not null and harvest_source is not null);
-- Never over an abstract a moderator loaded from the publisher.
create policy science_studies_harvest_update on public.science_studies for update to dialektik_science_harvester
  using (true) with check (not abstract_by_moderator);
-- Retention: harvested, older than 90 days, never connected, never moderated.
create policy science_studies_harvest_retention on public.science_studies for delete to dialektik_science_harvester
  using (harvested_at is not null and harvested_at < now() - interval '90 days' and moderated_at is null
    and not abstract_by_moderator and not public.dialektik_science_study_connected(doi));

drop policy if exists science_harvest_runs_harvester on public.science_harvest_runs;
drop policy if exists science_harvest_runs_core on public.science_harvest_runs;
create policy science_harvest_runs_harvester on public.science_harvest_runs for all to dialektik_science_harvester
  using (true) with check (true);
create policy science_harvest_runs_core on public.science_harvest_runs for select to dialektik_core_app using (true);

drop policy if exists science_api_usage_harvester on public.science_api_usage;
create policy science_api_usage_harvester on public.science_api_usage for all to dialektik_science_harvester
  using (true) with check (true);
`;

export const scienceHarvestMigration: Migration = {
  async up(db) { await sql.raw(scienceHarvestSql).execute(db); },
  async down() { throw new Error('The Science harvest is forward-only.'); },
};
