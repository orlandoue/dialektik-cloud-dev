import { sql, type Migration } from 'kysely';

// Retention for raw live articles (Supabase free plan: 500 MB).
//
// An article older than the window (14 days at least) is purged only when
// nothing but its own raw provenance refers to it: no event, position, claim,
// contrast, semantic group or pair, community entry or evidence comment, and
// no other table at all. The check reads every foreign key to `articles`,
// its versions, extraction generations and exposure record at run time, so a
// table added later is protected automatically. Published cases and their
// evidence are therefore never touched.
//
// The raw provenance tables are append-only by trigger. This reviewed
// function disables only their user triggers for the duration of its own
// transaction (foreign keys stay enforced) and re-enables them before it
// returns; any failure rolls everything back. Each article is purged in its
// own subtransaction, so an unexpected reference skips that article only.
export const rawArticleRetentionSql = String.raw`
create or replace function public.dialektik_purge_raw_articles(
  p_older_than interval default interval '14 days',
  p_limit integer default 500
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare
  raw_tables constant regclass[] := array[
    'public.live_semantic_article_outcomes', 'public.live_semantic_article_attempts',
    'public.assertion_extraction_generations', 'public.corporate_live_metadata_backfill_attempts',
    'public.live_article_versions', 'public.live_acquisition_receipts', 'public.live_exposure_exclusions'
  ]::regclass[];
  guard text := '';
  fk record;
  trig record;
  disabled text[] := array[]::text[];
  candidate record;
  cutoff timestamptz;
  purged integer := 0;
  skipped integer := 0;
  has_outcomes boolean := to_regclass('public.live_semantic_article_outcomes') is not null;
  has_attempts boolean := to_regclass('public.live_semantic_article_attempts') is not null;
  has_backfill boolean := to_regclass('public.corporate_live_metadata_backfill_attempts') is not null;
begin
  if p_older_than < interval '14 days' then raise exception 'RAW_ARTICLE_RETENTION_WINDOW_TOO_SHORT'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('dialektik-raw-article-retention', 0)) then
    return jsonb_build_object('status', 'ALREADY_RUNNING');
  end if;
  p_limit := least(greatest(coalesce(p_limit, 500), 1), 2000);
  cutoff := clock_timestamp() - p_older_than;

  -- Any reference from outside the raw provenance keeps the article.
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col, c.confrelid::regclass as parent
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.confrelid in ('public.articles'::regclass, 'public.live_article_versions'::regclass,
        'public.assertion_extraction_generations'::regclass, 'public.live_acquisition_receipts'::regclass,
        'public.live_exposure_exclusions'::regclass)
      and (c.conrelid <> all(raw_tables) or (c.conrelid = c.confrelid and c.confrelid = 'public.articles'::regclass))
      and not (c.conrelid = 'public.articles'::regclass and c.confrelid = 'public.live_exposure_exclusions'::regclass)
  loop
    guard := guard || case fk.parent
      when 'public.articles'::regclass then
        format(' and not exists(select 1 from %s x where x.%I = a.id)', fk.tbl, fk.col)
      when 'public.live_article_versions'::regclass then
        format(' and not exists(select 1 from %s x join public.live_article_versions v on v.id = x.%I where v.article_id = a.id)', fk.tbl, fk.col)
      when 'public.assertion_extraction_generations'::regclass then
        format(' and not exists(select 1 from %s x join public.assertion_extraction_generations g on g.id = x.%I where g.article_id = a.id)', fk.tbl, fk.col)
      when 'public.live_acquisition_receipts'::regclass then
        format(' and not exists(select 1 from %s x join public.live_acquisition_receipts r on r.id = x.%I where r.exclusion_id = a.live_exposure_id)', fk.tbl, fk.col)
      else
        format(' and not exists(select 1 from %s x where x.%I = a.live_exposure_id)', fk.tbl, fk.col)
    end;
  end loop;
  -- Generations referenced by anything but outcomes or their own lineage.
  -- (Covered above.) An exposure record shared with another article stays.
  guard := guard || ' and not exists(select 1 from public.articles other where other.live_exposure_id = a.live_exposure_id and other.id <> a.id)';

  -- Disable only the enabled user triggers that fire on DELETE.
  for trig in
    select t.tgrelid::regclass as tbl, t.tgname
    from pg_trigger t
    where t.tgrelid = any(raw_tables) and not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 8) = 8
  loop
    execute format('alter table %s disable trigger %I', trig.tbl, trig.tgname);
    disabled := disabled || format('alter table %s enable trigger %I', trig.tbl, trig.tgname);
  end loop;

  for candidate in execute format(
    'select a.id, a.live_exposure_id from public.articles a
     where a.origin = %L and a.event_id is null and a.captured_at < %L and a.published_at < %L %s
     order by a.captured_at, a.id limit %s',
    'LIVE_REAL', cutoff, cutoff, guard, p_limit)
  loop
    begin
      if has_outcomes then
        delete from public.live_semantic_article_outcomes o
        where (has_attempts and o.attempt_id in (select id from public.live_semantic_article_attempts where article_id = candidate.id))
           or o.extraction_generation_id in (select id from public.assertion_extraction_generations where article_id = candidate.id);
      end if;
      if has_attempts then
        delete from public.live_semantic_article_attempts where article_id = candidate.id;
      end if;
      delete from public.assertion_extraction_generations where article_id = candidate.id;
      if has_backfill then
        delete from public.corporate_live_metadata_backfill_attempts where article_id = candidate.id;
      end if;
      delete from public.live_article_versions where article_id = candidate.id;
      delete from public.articles where id = candidate.id;
      if candidate.live_exposure_id is not null then
        delete from public.live_acquisition_receipts where exclusion_id = candidate.live_exposure_id;
        delete from public.live_exposure_exclusions where id = candidate.live_exposure_id;
      end if;
      purged := purged + 1;
    exception when others then
      skipped := skipped + 1;
    end;
  end loop;

  for i in 1 .. coalesce(array_length(disabled, 1), 0) loop
    execute disabled[i];
  end loop;
  return jsonb_build_object('status', 'DONE', 'purged', purged, 'skipped', skipped, 'cutoff', cutoff);
end
$fn$;

revoke all on function public.dialektik_purge_raw_articles(interval, integer) from public, anon, authenticated;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_corporate_live_writer') then
    grant execute on function public.dialektik_purge_raw_articles(interval, integer) to dialektik_corporate_live_writer;
  end if;
end
$grant$;
`;

export const rawArticleRetentionMigration: Migration = {
  async up(db) { await sql.raw(rawArticleRetentionSql).execute(db); },
  async down() { throw new Error('Retention functions are forward-only.'); },
};
