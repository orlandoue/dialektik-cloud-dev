import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { semanticRunBatchSizeSql } from '../../../packages/database/dist/migration/086_semantic_run_batch_size.js';

test('086 widens requested_count to 1..15 and can run twice', async () => {
  const db = new PGlite();
  try {
    // The constraint exactly as migration 058 declares it, inline.
    await db.exec(`create table public.live_semantic_production_runs (
      id text primary key,
      requested_count integer not null check(requested_count between 1 and 5),
      processed_count integer not null default 0 check(processed_count between 0 and requested_count));`);
    await assert.rejects(db.exec(`insert into public.live_semantic_production_runs values('r0',6,0)`));
    await db.exec(semanticRunBatchSizeSql);
    await db.exec(semanticRunBatchSizeSql);
    await db.exec(`insert into public.live_semantic_production_runs values('r1',10,10),('r2',15,0)`);
    await assert.rejects(db.exec(`insert into public.live_semantic_production_runs values('r3',16,0)`));
    await assert.rejects(db.exec(`insert into public.live_semantic_production_runs values('r4',0,0)`));
    // The dependent check is untouched.
    await assert.rejects(db.exec(`insert into public.live_semantic_production_runs values('r5',3,4)`));
  } finally { await db.close(); }
});
