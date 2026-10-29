import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { analyzeHeadlineForReview } from '../dist/semantic/headline-semantic-runner.js';

const input = {
  articleId: '01M4YDQK00EVART00000000001',
  versionId: '01M4YDQK00EVART00000000002',
  sourceId: '01M4YDQK00CH1000C1PERCH11E',
  policyId: 'a'.repeat(64),
  canonicalDomain: 'ciperchile.cl',
  canonicalUrl: 'https://www.ciperchile.cl/news/story/',
  headline: '🔴 El consejo aprobó la medida el 2026-10-28',
};
const grant = {
  sourceId: input.sourceId,
  policyId: input.policyId,
  active: true,
  decisionId: '01M4YDQK00EVART00000000004',
  approvedBy: '01M4YDQK00ED1T0R0R1AND0VE1',
  authorizationReference: 'fixture-owner-decision',
  rightsEvidenceUrl: 'https://example.invalid/terms',
  rightsReviewStatus: 'APPROVED',
  storagePolicy: 'METADATA_ONLY',
  allowCloudflareHeadline: true,
  allowDerivedEditorialReview: true,
  validFrom: '2020-01-01T00:00:00.000Z',
  expiresAt: null,
};
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: null };
function fact(id, role, value) {
  const start = Array.from(input.headline.slice(0, input.headline.indexOf(value))).length;
  return {
    id,
    role,
    value,
    evidence: {
      field: 'title',
      start,
      end: start + Array.from(value).length,
      inputHash: hash(input.headline),
    },
  };
}
function harness(result) {
  const events = [];
  const providerInputs = [];
  let grantValue = grant;
  const hooks = {
    withRightsLease: async (_input, _signal, work) => {
      events.push('lease');
      return work();
    },
    currentGrant: async () => {
      events.push('grant');
      return grantValue;
    },
    reserveAttempt: async () => {
      events.push('reserve');
      return '01M4YDQK00EVART00000000003';
    },
    finishAttempt: async (_id, outcome, extraction) => {
      events.push({ outcome, extraction });
    },
  };
  const transport = {
    kind: 'external',
    name: 'fixture',
    providerType: 'llm_cloudflare_workers_ai',
    async generate(_stage, data) {
      events.push('provider');
      providerInputs.push(data);
      return { output: result, usage };
    },
  };
  return {
    events,
    providerInputs,
    hooks,
    transport,
    setGrant: (next) => {
      grantValue = next;
    },
  };
}
const complete = {
  status: 'OBSERVATION_AVAILABLE',
  boundedOccurrence: true,
  boundedThread: false,
  facts: [fact('f1', 'action', 'aprobó'), fact('f2', 'date', '2026-10-28')],
};

test('reserves an attempt and sends only the verified title under a source grant', async () => {
  const h = harness(complete);
  const result = await analyzeHeadlineForReview(
    input,
    h.transport,
    h.hooks,
    new AbortController().signal,
  );
  assert.deepEqual(h.events.slice(0, 4), ['lease', 'grant', 'reserve', 'provider']);
  assert.deepEqual(
    Object.keys(h.providerInputs[0]).sort(),
    ['body', 'bodyHash', 'offsetConvention', 'title', 'titleHash'].sort(),
  );
  assert.equal(h.providerInputs[0].body, '');
  assert.equal(h.providerInputs[0].title, input.headline);
  assert.equal(result.extraction.status, 'OBSERVATION_AVAILABLE');
  assert.equal(result.attemptId, '01M4YDQK00EVART00000000003');
  assert.equal(h.events.at(-1).outcome, 'VALIDATED');
  assert.ok(!JSON.stringify(result).includes(input.headline));
});

test('denies unapproved and expired source decisions before transmitting anything', async () => {
  for (const denied of [
    { ...grant, allowCloudflareHeadline: false },
    { ...grant, expiresAt: '2020-01-01T00:00:00.000Z' },
    { ...grant, validFrom: '2099-01-01T00:00:00.000Z' },
    { ...grant, rightsEvidenceUrl: 'https://supabase.com' },
  ]) {
    const h = harness(complete);
    h.setGrant(denied);
    await assert.rejects(
      analyzeHeadlineForReview(input, h.transport, h.hooks, new AbortController().signal),
      /HEADLINE_RIGHTS_DENIED/,
    );
    assert.ok(!h.events.includes('reserve') && !h.events.includes('provider'));
  }
});

test('rejects invented evidence and records no validated proposal', async () => {
  const h = harness({
    ...complete,
    facts: [{ ...complete.facts[0], value: 'inventado' }],
  });
  await assert.rejects(
    analyzeHeadlineForReview(input, h.transport, h.hooks, new AbortController().signal),
    /HEADLINE_MODEL_OUTPUT_REJECTED/,
  );
  assert.equal(h.events.at(-1).outcome, 'REJECTED');
  assert.equal(h.events.at(-1).extraction, undefined);
});

test('does not persist an output when the source grant is revoked during the call', async () => {
  const h = harness(complete);
  h.transport.generate = async () => {
    h.setGrant({ ...grant, active: false });
    return { output: complete, usage };
  };
  await assert.rejects(
    analyzeHeadlineForReview(input, h.transport, h.hooks, new AbortController().signal),
    /HEADLINE_RIGHTS_REVOKED/,
  );
  assert.equal(h.events.at(-1).outcome, 'RIGHTS_REVOKED');
  assert.equal(h.events.at(-1).extraction, undefined);
});

test('rejects a canonical link outside the approved publisher domain', async () => {
  const h = harness(complete);
  await assert.rejects(
    analyzeHeadlineForReview(
      { ...input, canonicalUrl: 'https://outside.invalid/story' },
      h.transport,
      h.hooks,
      new AbortController().signal,
    ),
    /HEADLINE_URL_INVALID/,
  );
  assert.deepEqual(h.events, []);
});
