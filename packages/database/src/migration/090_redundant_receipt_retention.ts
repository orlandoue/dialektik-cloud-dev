import { sql, type Migration } from 'kysely';

// live_acquisition_receipts records every sighting of every feed item on
// every poll (267 MB of a 364 MB database on 2026-11-16, Supabase free plan:
// 500 MB). A receipt is redundant once it is older than the window, a newer
// sighting of the same item exists, and no article version cites it as its
// provenance. Those are deleted in batches; the latest sighting of each item
// and every receipt a version (or anything else) refers to are kept. The
// append-only trigger of the table is disabled only inside this function's
// transaction; foreign keys stay enforced.
export const redundantReceiptRetentionSql = String.raw`
create index if not exists live_versions_by_receipt on public.live_article_versions(receipt_id);

create or replace function public.dialektik_purge_redundant_receipts(
  p_older_than interval default interval '2 days',
  p_limit integer default 20000
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare
  guard text := '';
  fk record;
  trig record;
  disabled text[] := array[]::text[];
  cutoff timestamptz;
  deleted integer := 0;
begin
  if p_older_than < interval '1 day' then raise exception 'RECEIPT_RETENTION_WINDOW_TOO_SHORT'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('dialektik-receipt-retention', 0)) then
    return jsonb_build_object('status', 'ALREADY_RUNNING');
  end if;
  p_limit := least(greatest(coalesce(p_limit, 20000), 1), 100000);
  cutoff := clock_timestamp() - p_older_than;

  -- Every table that refers to a receipt keeps it.
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.live_acquisition_receipts'::regclass
  loop
    guard := guard || format(' and not exists(select 1 from %s x where x.%I = r.id)', fk.tbl, fk.col);
  end loop;

  for trig in
    select t.tgname from pg_trigger t
    where t.tgrelid = 'public.live_acquisition_receipts'::regclass and not t.tgisinternal
      and t.tgenabled <> 'D' and (t.tgtype & 8) = 8
  loop
    execute format('alter table public.live_acquisition_receipts disable trigger %I', trig.tgname);
    disabled := disabled || format('alter table public.live_acquisition_receipts enable trigger %I', trig.tgname);
  end loop;

  execute format(
    'with doomed as (
       select r.id from public.live_acquisition_receipts r
       where r.seen_at < %L
         and exists(select 1 from public.live_acquisition_receipts newer
           where newer.exclusion_id = r.exclusion_id and (newer.seen_at, newer.id) > (r.seen_at, r.id)) %s
       limit %s)
     delete from public.live_acquisition_receipts d using doomed where d.id = doomed.id',
    cutoff, guard, p_limit);
  get diagnostics deleted = row_count;

  for i in 1 .. coalesce(array_length(disabled, 1), 0) loop
    execute disabled[i];
  end loop;
  return jsonb_build_object('status', 'DONE', 'deleted', deleted, 'cutoff', cutoff);
end
$fn$;

revoke all on function public.dialektik_purge_redundant_receipts(interval, integer) from public, anon, authenticated;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_corporate_live_writer') then
    grant execute on function public.dialektik_purge_redundant_receipts(interval, integer) to dialektik_corporate_live_writer;
  end if;
end
$grant$;
`;

export const redundantReceiptRetentionMigration: Migration = {
  async up(db) { await sql.raw(redundantReceiptRetentionSql).execute(db); },
  async down() { throw new Error('Retention functions are forward-only.'); },
};
