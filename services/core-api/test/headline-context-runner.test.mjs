import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeContextPair } from '../dist/semantic/headline-context-runner.js';

const left = {
  articleId: '01M4YDQK00EVART00000000001',
  versionId: '01M4YDQK00EVART00000000002',
  sourceId: '01M4YDQK00CH1000C1PERCH11E',
  policyId: 'a'.repeat(64),
  canonicalDomain: 'left.invalid',
  canonicalUrl: 'https://left.invalid/story',
  headline: 'Torres declaró sobre proceso Rivera',
  grantId: '01M4YDQK00EVART00000000004',
  publishedAt: '2026-10-27T18:00:00Z',
};
const right = {
  articleId: '01M4YDQK00EVART00000000003',
  versionId: '01M4YDQK00EVART00000000005',
  sourceId: '01M4YDQK00CH100C00PERAT1VA',
  policyId: 'b'.repeat(64),
  canonicalDomain: 'right.invalid',
  canonicalUrl: 'https://right.invalid/story',
  headline: 'Torres enfrenta investigación por Rivera',
  grantId: '01M4YDQK00EVART00000000006',
  publishedAt: '2026-10-28T18:00:00Z',
};
function grant(input) {
  return {
    sourceId: input.sourceId,
    policyId: input.policyId,
    decisionId: input.grantId,
    approvedBy: '01M4YDQK00ED1T0R0R1AND0VE1',
    authorizationReference: 'fixture',
    rightsEvidenceUrl: 'https://example.invalid/terms',
    active: true,
    rightsReviewStatus: 'APPROVED',
    storagePolicy: 'METADATA_ONLY',
    allowCloudflareHeadline: true,
    allowDerivedEditorialReview: true,
    validFrom: '2020-01-01T00:00:00Z',
    expiresAt: null,
  };
}
function harness(output) {
  const calls = [];
  let revoked = false;
  const hooks = {
    withRightsLeases: async (_a, _b, _s, work) => {
      calls.push('lease');
      return work();
    },
    currentGrant: async (input) =>
      revoked && input.sourceId === right.sourceId ? null : grant(input),
    reserveAttempt: async () => {
      calls.push('reserve');
      return '01M4YDQK00EVART00000000007';
    },
    finishAttempt: async (_id, outcome, value) => {
      calls.push({ outcome, value });
    },
  };
  const transport = {
    kind: 'external',
    providerType: 'llm_cloudflare_workers_ai',
    name: 'fixture',
    async generate(_stage, payload) {
      calls.push('provider');
      assert.deepEqual(Object.keys(payload.left).sort(), ['publishedAt', 'title']);
      return { output };
    },
  };
  return {
    hooks,
    transport,
    calls,
    revoke: () => {
      revoked = true;
    },
  };
}

test('records a provisional two-source comparison without bodies or automatic publication', async () => {
  const h = harness({ relation: 'POSSIBLY_SAME_THREAD' });
  const result = await analyzeContextPair(
    left,
    right,
    h.transport,
    h.hooks,
    new AbortController().signal,
  );
  assert.equal(result.relation.relation, 'POSSIBLY_SAME_THREAD');
  assert.deepEqual(h.calls.slice(0, 3), ['lease', 'reserve', 'provider']);
  assert.equal(h.calls.at(-1).outcome, 'VALIDATED');
  assert.ok(!JSON.stringify(result).includes(left.headline));
});

test('requires distinct current source grants and a bounded publication window', async () => {
  const h = harness({ relation: 'UNCERTAIN' });
  await assert.rejects(
    analyzeContextPair(
      left,
      { ...right, sourceId: left.sourceId },
      h.transport,
      h.hooks,
      new AbortController().signal,
    ),
    /CONTEXT_PAIR_INVALID/,
  );
  await assert.rejects(
    analyzeContextPair(
      left,
      { ...right, publishedAt: '2026-11-10T00:00:00Z' },
      h.transport,
      h.hooks,
      new AbortController().signal,
    ),
    /CONTEXT_PAIR_INVALID/,
  );
  h.revoke();
  await assert.rejects(
    analyzeContextPair(left, right, h.transport, h.hooks, new AbortController().signal),
    /HEADLINE_RIGHTS_DENIED/,
  );
  assert.ok(!h.calls.includes('provider'));
});

test('rejects an unexpected model-provided anchor and does not retain a model response', async () => {
  const h = harness({ relation: 'POSSIBLY_SAME_EVENT', sharedAnchor: 'inventado' });
  await assert.rejects(
    analyzeContextPair(left, right, h.transport, h.hooks, new AbortController().signal),
    /CONTEXT_MODEL_OUTPUT_REJECTED/,
  );
  assert.equal(h.calls.at(-1).outcome, 'REJECTED');
  assert.equal(h.calls.at(-1).value, undefined);
});

test('discards a result when either source is revoked during inference', async () => {
  const h = harness({ relation: 'POSSIBLY_SAME_THREAD' });
  h.transport.generate = async () => {
    h.revoke();
    return { output: { relation: 'POSSIBLY_SAME_THREAD' } };
  };
  await assert.rejects(
    analyzeContextPair(left, right, h.transport, h.hooks, new AbortController().signal),
    /CONTEXT_RIGHTS_REVOKED/,
  );
  assert.equal(h.calls.at(-1).outcome, 'RIGHTS_REVOKED');
});
