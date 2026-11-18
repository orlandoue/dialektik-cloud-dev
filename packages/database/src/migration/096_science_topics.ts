import { sql, type Migration } from 'kysely';

// Science topics (on top of 091–095): one value from a fixed list, taken from
// each source's own taxonomy (OpenAlex field/subfield, arXiv category,
// Europe PMC = health). Null when the source has none. Idempotent.
export const scienceTopicsSql = String.raw`
alter table public.science_studies add column if not exists topic text;
do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'science_studies_topic_check') then
    alter table public.science_studies add constraint science_studies_topic_check
      check (topic is null or topic in ('salud', 'astronomia', 'biologia', 'medioambiente', 'arqueologia',
        'ciencias_exactas', 'tecnologia', 'sociedad'));
  end if;
end
$checks$;
create index if not exists science_studies_topic_published_idx
  on public.science_studies (topic, published_at desc nulls last);

-- What is already known without asking any API again (only once 093, the
-- harvest, is applied).
do $backfill$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'science_studies' and column_name = 'harvest_source') then
    execute $u$update public.science_studies set topic = 'salud' where topic is null and harvest_source = 'europepmc'$u$;
    execute $u$update public.science_studies set topic = 'astronomia' where topic is null and harvest_source = 'arxiv'$u$;
  end if;
end
$backfill$;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_science_harvester') then
    grant insert (topic) on public.science_studies to dialektik_science_harvester;
    grant update (topic) on public.science_studies to dialektik_science_harvester;
  end if;
end
$grants$;
`;

export const scienceTopicsMigration: Migration = {
  async up(db) { await sql.raw(scienceTopicsSql).execute(db); },
  async down() { throw new Error('Science topics are forward-only.'); },
};
