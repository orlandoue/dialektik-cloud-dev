import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { HeadlineAnalysisService } from '../dist/semantic/headline-analysis.service.js';
import { HeadlineReviewService } from '../dist/moderation/headline-review.service.js';

const editor = '01M4YDQK00ED1T0R0R1AND0VE1';
const input = {
  articleId: '01M4YDQK00EVART00000000001',
  versionId: '01M4YDQK00EVART00000000002',
  sourceId: '01M4YDQK00CH1000C1PERCH11E',
  policyId: 'a'.repeat(64),
  canonicalDomain: 'ciperchile.cl',
  canonicalUrl: 'https://www.ciperchile.cl/news/story/',
  headline: 'Titular sintético para prueba',
};
const grant = {
  sourceId: input.sourceId,
  policyId: input.policyId,
  decisionId: '01M4YDQK00EVART00000000004',
  approvedBy: editor,
  authorizationReference: 'fixture',
  rightsEvidenceUrl: 'https://example.invalid/terms',
  active: true,
  rightsReviewStatus: 'APPROVED',
  storagePolicy: 'METADATA_ONLY',
  allowCloudflareHeadline: true,
  allowDerivedEditorialReview: true,
  validFrom: new Date('2020-01-01T00:00:00Z'),
  expiresAt: null,
};
function fixture({ allowed = true, eligible = true, role = 'editor' } = {}) {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(command, parameters) {
          const text = typeof command === 'string' ? command : command.text;
          queries.push({ text, values: parameters ?? command.values ?? [] });
          if (text.includes('as allowed')) return { rows: [{ allowed }] };
          if (text.includes('as "articleId"')) return { rows: eligible ? [input] : [] };
          if (text.includes('as "decisionId"')) return { rows: [grant] };
          if (text.includes('select id from public.headline_ai_source_grants'))
            return { rows: [{ id: grant.decisionId }] };
          if (text.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
  const reviews = new HeadlineReviewService(
    { database: db },
    {
      async authenticate() {
        return {
          kind: 'session',
          userId: editor,
          role,
          sessionId: input.articleId,
          tokenHash: 'x',
        };
      },
    },
    { database: db },
  );
  return {
    db,
    queries,
    reviews,
    analysis: new HeadlineAnalysisService(reviews, { database: db }),
  };
}

test('only an enabled, authorized single editor may request an analysis', async () => {
  const previous = process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED;
  const h = fixture();
  try {
    delete process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED;
    await assert.rejects(
      h.analysis.analyzeNext('Bearer fixture', {}),
      (error) => error.getStatus() === 404,
    );
    process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED = 'true';
    const unauthorized = fixture({ allowed: false });
    try {
      await assert.rejects(
        unauthorized.analysis.analyzeNext('Bearer fixture', {}),
        (error) => error.status === 403 || error.getStatus?.() === 403,
      );
    } finally {
      await unauthorized.db.destroy();
    }
    await assert.rejects(
      h.analysis.analyzeNext('Bearer fixture', { headline: 'client supplied' }),
      (error) => error.status === 400 || error.getStatus?.() === 400,
    );
    assert.equal(
      h.queries.some((q) => q.text.includes('headline_ai_attempts')),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED;
    else process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED = previous;
    await h.db.destroy();
  }
});

test('selects server-side metadata and records a validated result without sending article bodies', async () => {
  const saved = {
    enabled: process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED,
    token: process.env.CLOUDFLARE_API_TOKEN,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    fetch: globalThis.fetch,
  };
  const h = fixture();
  let sent = 0;
  try {
    process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED = 'true';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32);
    globalThis.fetch = async (url, options) => {
      sent += 1;
      assert.ok(String(url).includes('/accounts/' + 'a'.repeat(32) + '/ai/run/'));
      assert.ok(
        h.queries.some((query) => query.text.includes('insert into public.headline_ai_attempts')),
      );
      const payload = JSON.parse(options.body);
      const data = JSON.parse(payload.messages[1].content);
      assert.equal(data.title, input.headline);
      assert.equal(data.body, '');
      assert.equal(Object.hasOwn(data, 'articleBody'), false);
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            response: {
              status: 'INSUFFICIENT_EVIDENCE',
              boundedOccurrence: false,
              boundedThread: false,
              facts: [],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const result = await h.analysis.analyzeNext('Bearer fixture', {});
    assert.equal(result.status, 'ANALYZED');
    assert.equal(result.observation, 'INSUFFICIENT_EVIDENCE');
    assert.equal(sent, 1);
    const statements = h.queries.map((query) => query.text);
    assert.ok(
      statements.findIndex((sql) => sql.includes('headline_ai_attempts')) <
        statements.findIndex((sql) => sql.includes('headline_ai_attempt_outcomes')),
    );
  } finally {
    for (const [key, value] of [
      ['DIALEKTIK_HEADLINE_REVIEW_ENABLED', saved.enabled],
      ['CLOUDFLARE_API_TOKEN', saved.token],
      ['CLOUDFLARE_ACCOUNT_ID', saved.account],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = saved.fetch;
    await h.db.destroy();
  }
});
