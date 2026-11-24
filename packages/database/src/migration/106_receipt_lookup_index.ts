import { sql, type Migration } from 'kysely';

// The capture looks up each new item by (source_id, source_item_id) in the
// receipts. Without an index every lookup read the whole table (65 M blocks
// read from outside shared buffers between 12 and 24 Nov 2026, the main
// spend of Supabase's disk budget). Partial and covering: the lookup orders
// by seen_at and joins on exclusion_id, so it is an index-only scan.
// CREATE INDEX CONCURRENTLY cannot run inside a transaction: on production
// it is applied as a single statement; here, for fresh databases, plainly.
// Autovacuum runs earlier on this table, which loses rows every 6 hours to
// retention, so the visibility map stays fresh for index-only scans.
// No fillfactor change: the table is append-only. Idempotent.
export const receiptLookupIndexSql = String.raw`
create index if not exists live_receipts_by_source_item
  on public.live_acquisition_receipts (source_id, source_item_id, seen_at)
  include (exclusion_id)
  where source_item_id is not null;
alter table public.live_acquisition_receipts set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 500
);
`;

export const receiptLookupIndexMigration: Migration = {
  async up(db) { await sql.raw(receiptLookupIndexSql).execute(db); },
  async down(db) {
    await sql.raw(`drop index if exists public.live_receipts_by_source_item;
      alter table public.live_acquisition_receipts reset (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold,
        autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);`).execute(db);
  },
};
