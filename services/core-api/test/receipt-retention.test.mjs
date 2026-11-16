import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redundantReceiptRetentionSql } from '../../../packages/database/dist/migration/090_redundant_receipt_retention.js';

// Verified on PostgreSQL 16: old sightings with a newer sighting of the same
// item are deleted; the latest sighting and receipts cited by an article
// version are kept; the append-only trigger is re-enabled.
test('receipt retention keeps the latest sighting and every cited receipt', () => {
  assert.match(redundantReceiptRetentionSql, /p_older_than < interval '1 day' then raise exception/u);
  assert.match(redundantReceiptRetentionSql, /newer\.exclusion_id = r\.exclusion_id and \(newer\.seen_at, newer\.id\) > \(r\.seen_at, r\.id\)/u);
  assert.match(redundantReceiptRetentionSql, /c\.confrelid = 'public\.live_acquisition_receipts'::regclass/u);
  assert.match(redundantReceiptRetentionSql, /enable trigger %I/u);
  assert.match(redundantReceiptRetentionSql, /create index if not exists live_versions_by_receipt/u);
});
