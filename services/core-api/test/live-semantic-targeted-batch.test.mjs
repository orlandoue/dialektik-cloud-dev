import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSemanticBatchBody } from '../dist/semantic/live-semantic-production.service.js';
const video = '01M6F3RB2WHZGH0E242NQRR871';
test('targeted batch preserves a bounded list of article IDs', () => {
  assert.deepEqual(parseSemanticBatchBody({targetDay:'2026-10-30',limit:1,articleIds:[video]}),
    {targetDay:'2026-10-30',limit:1,articleIds:[video]});
  assert.deepEqual(parseSemanticBatchBody({targetDay:'2026-10-30'}).articleIds, []);
});
test('targeted batch rejects invalid, duplicate and excessive IDs', () => {
  for (const articleIds of [['bad'],[video,video],Array(6).fill(video)])
    assert.throws(() => parseSemanticBatchBody({targetDay:'2026-10-30',articleIds}));
});
