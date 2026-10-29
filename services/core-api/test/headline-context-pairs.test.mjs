import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rankContextPairs,
  verifyContextRelation,
} from '../dist/semantic/headline-context-pairs.js';

const left = {
  articleId: '01M4YDQK00EVART00000000001',
  versionId: '01M4YDQK00EVART00000000002',
  sourceId: '01M4YDQK00CH1000C1PERCH11E',
  policyId: 'a'.repeat(64),
  canonicalDomain: 'example.invalid',
  canonicalUrl: 'https://example.invalid/a',
  grantId: '01M4YDQK00EVART00000000004',
  headline: '🔴 Torres declaró sobre proceso de Rivera',
  publishedAt: '2026-10-27T18:00:00Z',
};
const right = {
  ...left,
  articleId: '01M4YDQK00EVART00000000003',
  sourceId: '01M4YDQK00CH100C00PERAT1VA',
  headline: 'Torres enfrenta investigación por Rivera',
  publishedAt: '2026-10-28T18:00:00Z',
};

test('ranks shared non-generic terms only across sources within the publication window', () => {
  const pair = rankContextPairs([right, left]);
  assert.equal(pair.length, 1);
  assert.equal(pair[0].left.articleId, left.articleId);
  assert.equal(pair[0].sharedTerms, 2);
  assert.equal(rankContextPairs([left, { ...right, sourceId: left.sourceId }]).length, 0);
  assert.equal(
    rankContextPairs([left, { ...right, publishedAt: '2026-11-03T18:00:00Z' }]).length,
    0,
  );
  assert.equal(rankContextPairs([left, { ...right, headline: 'La economía regional' }]).length, 0);
});

test('grounds a proposed shared anchor in both titles using Unicode offsets', () => {
  const result = verifyContextRelation(
    { relation: 'POSSIBLY_SAME_THREAD', sharedAnchor: 'Torres' },
    left.headline,
    right.headline,
  );
  assert.equal(result.anchor.leftStart, 2);
  assert.equal(result.anchor.rightStart, 0);
  assert.ok(!JSON.stringify(result).includes('Torres'));
});

test('refuses fabricated, repeated or generic shared anchors', () => {
  for (const anchor of ['NoExiste', 'Gobierno', 'Torres']) {
    const titleA = anchor === 'Gobierno' ? 'Gobierno cambia norma' : 'Torres visita Torres';
    const titleB = anchor === 'Gobierno' ? 'Gobierno anuncia medida' : 'Torres responde';
    assert.throws(
      () =>
        verifyContextRelation(
          { relation: 'POSSIBLY_SAME_EVENT', sharedAnchor: anchor },
          titleA,
          titleB,
        ),
      /CONTEXT_ANCHOR_INVALID/,
    );
  }
});

test('uncertain results retain no proposed anchor', () => {
  assert.deepEqual(
    verifyContextRelation(
      { relation: 'UNCERTAIN', sharedAnchor: 'inventado' },
      left.headline,
      right.headline,
    ),
    { relation: 'UNCERTAIN', anchor: null },
  );
});
