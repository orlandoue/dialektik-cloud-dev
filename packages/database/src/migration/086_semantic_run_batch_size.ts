import { sql, type Migration } from 'kysely';

// Lets one scheduled run record up to 15 extractions instead of 5. The
// constraint was created inline in migration 058, so PostgreSQL named it
// live_semantic_production_runs_requested_count_check. Idempotent: it can be
// run again, and processed_count<=requested_count keeps holding.
export const semanticRunBatchSizeSql = String.raw`
alter table public.live_semantic_production_runs
  drop constraint if exists live_semantic_production_runs_requested_count_check;
alter table public.live_semantic_production_runs
  add constraint live_semantic_production_runs_requested_count_check
  check (requested_count between 1 and 15);
`;

export const semanticRunBatchSizeMigration: Migration = {
  async up(db) { await sql.raw(semanticRunBatchSizeSql).execute(db); },
  async down() { throw new Error('Semantic run limits are forward-only.'); },
};
