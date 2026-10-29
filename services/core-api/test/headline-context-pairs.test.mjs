import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calibrateContextRelation,
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
    { relation: 'POSSIBLY_SAME_THREAD' },
    left.headline,
    right.headline,
  );
  assert.equal(result.anchor.leftStart, 2);
  assert.equal(result.anchor.rightStart, 0);
  assert.ok(!JSON.stringify(result).includes('Torres'));
});

test('refuses missing, repeated or generic shared anchors', () => {
  for (const [titleA, titleB] of [
    ['Una alerta', 'Otra medida diferente'],
    ['Gobierno cambia norma', 'Gobierno anuncia medida'],
    ['Torres visita Torres', 'Torres responde'],
  ]) {
    assert.throws(
      () => verifyContextRelation({ relation: 'POSSIBLY_SAME_THREAD' }, titleA, titleB),
      /CONTEXT_ANCHOR_INVALID/,
    );
  }
});

test('does not accept a model-provided invented anchor', () => {
  assert.throws(
    () =>
      verifyContextRelation(
        { relation: 'POSSIBLY_SAME_EVENT', sharedAnchor: 'inventado' },
        left.headline,
        right.headline,
      ),
    /LLM_SCHEMA_INVALID/,
  );
});

test('uncertain results retain no proposed anchor', () => {
  assert.deepEqual(
    verifyContextRelation({ relation: 'UNCERTAIN' }, left.headline, right.headline),
    { relation: 'UNCERTAIN', modelRelation: 'UNCERTAIN', anchor: null },
  );
});

test('retains the model label while downgrading shared names without shared actions', () => {
  const coach = 'Entrenador de Montreal explica la situación de Alexis Sánchez';
  const match = 'Alexis Sánchez sumó minutos en dura goleada que sufrió CF Montreal';
  assert.deepEqual(verifyContextRelation({ relation: 'POSSIBLY_SAME_EVENT' }, coach, match), {
    relation: 'UNCERTAIN',
    modelRelation: 'POSSIBLY_SAME_EVENT',
    anchor: null,
  });
  assert.equal(
    calibrateContextRelation('POSSIBLY_SAME_THREAD', coach, match),
    'POSSIBLY_SAME_THREAD',
  );
});

test('allows a provisional same-event suggestion with two shared specific lowercase terms', () => {
  const first = 'Alexis Sánchez suma minutos en otra goleada de Montreal';
  const second = 'Alexis Sánchez sumó minutos en dura goleada que sufrió Montreal';
  const result = verifyContextRelation({ relation: 'POSSIBLY_SAME_EVENT' }, first, second);
  assert.equal(result.relation, 'POSSIBLY_SAME_EVENT');
  assert.equal(result.modelRelation, 'POSSIBLY_SAME_EVENT');
  assert.notEqual(result.anchor, null);
});
