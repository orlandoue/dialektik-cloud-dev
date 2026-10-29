import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { HeadlineSemanticRepository } from '../dist/semantic/headline-semantic-repository.js';
import { analyzeHeadlineForReview } from '../dist/semantic/headline-semantic-runner.js';

const input = {
  articleId: '01M4YDQK00EVART00000000001',
  versionId: '01M4YDQK00EVART00000000002',
  sourceId: '01M4YDQK00CH1000C1PERCH11E',
  policyId: 'a'.repeat(64),
  canonicalDomain: 'ciperchile.cl',
  canonicalUrl: 'https://www.ciperchile.cl/news/story/',
  headline: 'Un titular sintético',
};
const grant = {
  sourceId: input.sourceId,
  policyId: input.policyId,
  decisionId: '01M4YDQK00EVART00000000004',
  approvedBy: '01M4YDQK00ED1T0R0R1AND0VE1',
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

function fakeDatabase() {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(command, parameters) {
          const text = typeof command === 'string' ? command : command.text;
          queries.push({ text, values: parameters ?? command.values ?? [] });
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
  return {
    database: new Kysely({ dialect: new PostgresDialect({ pool }) }),
    queries,
  };
}

test('candidate selection keeps source, receipt, grant and quarantine checks in SQL', async () => {
  const { database, queries } = fakeDatabase();
  try {
    const repository = new HeadlineSemanticRepository(
      database,
      grant.approvedBy,
      'model',
      'b'.repeat(64),
    );
    await assert.rejects(repository.eligible(31), /HEADLINE_LIMIT_INVALID/);
    await repository.eligible(10);
    const query = queries[0].text;
    for (const requirement of [
      'LIVE_REAL',
      'PERSISTED',
      'METADATA_ONLY',
      'APPROVED',
      'HEADLINE_ONLY',
      'EDITORIAL_REVIEW_ONLY',
      'quarantinedArticleIds',
      'not exists',
    ])
      assert.ok(query.includes(requirement), requirement);
  } finally {
    await database.destroy();
  }
});

test('the provider is called between a durable reservation and outcome under the source lease', async () => {
  const { database, queries } = fakeDatabase();
  const order = [];
  try {
    const repository = new HeadlineSemanticRepository(
      database,
      grant.approvedBy,
      'model',
      'b'.repeat(64),
    );
    const transport = {
      kind: 'external',
      providerType: 'llm_cloudflare_workers_ai',
      name: 'fixture',
      async generate(_stage, payload) {
        assert.ok(
          queries.some(({ text }) => text.includes('insert into public.headline_ai_attempts')),
        );
        assert.equal(payload.body, '');
        order.push('provider');
        return {
          output: {
            status: 'INSUFFICIENT_EVIDENCE',
            boundedOccurrence: false,
            boundedThread: false,
            facts: [],
          },
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cost: null,
          },
        };
      },
    };
    const result = await analyzeHeadlineForReview(
      input,
      transport,
      repository.hooks(),
      new AbortController().signal,
    );
    assert.equal(result.extraction.status, 'INSUFFICIENT_EVIDENCE');
    assert.deepEqual(order, ['provider']);
    const texts = queries.map(({ text }) => text);
    for (const table of ['headline_ai_attempts', 'headline_ai_attempt_outcomes']) {
      const insert = texts.find((text) => text.includes(`insert into public.${table}`));
      assert.ok(insert.includes("date_trunc('milliseconds',clock_timestamp())"), table);
    }
    assert.ok(
      texts.findIndex((q) => q.includes('pg_advisory_lock')) <
        texts.findIndex((q) => q.includes('headline_ai_attempts')),
    );
    assert.ok(
      texts.findIndex((q) => q.includes('headline_ai_attempt_outcomes')) <
        texts.findIndex((q) => q.includes('pg_advisory_unlock')),
    );
  } finally {
    await database.destroy();
  }
});
