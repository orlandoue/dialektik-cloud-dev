// A receipt is written only when the evidence of what was seen changes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { receiptNeeded, SightingRecorder, SIGHTING_WRITE_INTERVAL_MS } = await import('../dist/live/live-sightings.js');

const evidence = {
  policy_id: 'p1', discovery_url: 'https://medio.cl/rss', discovered_url: 'https://medio.cl/a?utm=1',
  canonical_url: 'https://medio.cl/a', source_item_id: 'guid-1', raw_payload_hash: 'a'.repeat(64),
  adapter_version: 'v3', disposition: 'PERSISTED', error_code: null,
};

test('a new item, or any change of evidence, needs a receipt; an identical repeat does not', () => {
  assert.equal(receiptNeeded(undefined, evidence), true);
  assert.equal(receiptNeeded(evidence, { ...evidence }), false);
  assert.equal(receiptNeeded({ ...evidence, error_code: undefined }, evidence), false, 'null and missing are equal');
  for (const [field, value] of Object.entries({
    policy_id: 'p2', discovery_url: 'https://medio.cl/feed', discovered_url: null, canonical_url: 'https://medio.cl/b',
    source_item_id: 'guid-2', adapter_version: 'v4', disposition: 'QUARANTINED',
    error_code: 'INVALID_ITEM',
  })) {
    assert.equal(receiptNeeded(evidence, { ...evidence, [field]: value }), true, field);
  }
  // The item's hash is recorded, not compared: its content changes write a
  // receipt through the new article version (live-item-hash.ts).
  assert.equal(receiptNeeded(evidence, { ...evidence, raw_payload_hash: 'b'.repeat(64) }), false);
});

test('the in-memory throttle asks the database at most once per hour per item', async () => {
  let clock = 0;
  const recorder = new SightingRecorder(() => clock);
  const calls = [];
  // A Kysely-shaped executor that counts the queries record() sends.
  const counting = {
    executeQuery: async () => { calls.push(clock); return { rows: [] }; },
  };
  const kyselyLike = { getExecutor: () => ({
    transformQuery: (q) => q, compileQuery: (q) => ({ sql: '', parameters: [], query: q }),
    executeQuery: counting.executeQuery, adapter: { supportsReturning: true },
  }) };
  for (let i = 0; i < 720; i++) { await recorder.record(kyselyLike, 'item', new Date(clock)); clock += 5_000; }
  assert.equal(calls.length, 1, '720 polls of 5 s are one write');
  clock = SIGHTING_WRITE_INTERVAL_MS + 1;
  await recorder.record(kyselyLike, 'item', new Date(clock));
  assert.equal(calls.length, 2);
});
