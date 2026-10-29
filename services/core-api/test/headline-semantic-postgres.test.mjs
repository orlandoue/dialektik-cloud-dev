import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { HeadlineSemanticRepository } from '../dist/semantic/headline-semantic-repository.js';
import { analyzeHeadlineForReview } from '../dist/semantic/headline-semantic-runner.js';
import { HeadlineReviewService } from '../dist/moderation/headline-review.service.js';

const source = '01M4YDQK00CH1000C1PERCH11E';
const user = '01M4YDQK00ED1T0R0R1AND0VE1';
const grant = '01M4YDQK00EVART00000000004';
const article = '01M4YDQK00EVART00000000001';
const version = '01M4YDQK00EVART00000000002';
const receipt = '01M4YDQK00EVART00000000003';
const policy = 'a'.repeat(64);
const headline = '🔴 Consejo aprobó medida el 2026-10-28';
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

test('title grants, provenance, evidence, review and least-privilege roles in isolated PostgreSQL', async () => {
  const db = new PGlite();
  let kysely;
  try {
    await db.exec(`create domain dialektik_ulid as text check (value ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$');
    create role anon; create role authenticated; create role dialektik_core_app; create role dialektik_moderation_writer;
    create table sources(id dialektik_ulid primary key,origin text,name text,canonical_domain text);
    create table live_source_policies(id text primary key,source_id dialektik_ulid references sources,
      active boolean,rights_class text,storage_policy text,policy jsonb,recorded_at timestamptz,
      unique(source_id,id));
    create table users(id dialektik_ulid primary key,role text);
    create table moderation_auth_sessions(id dialektik_ulid primary key,user_id dialektik_ulid,
      token_hash text,expires_at timestamptz,revoked_at timestamptz);
    create table editorial_single_editor_authorizations(editor_user_id dialektik_ulid,revoked_at timestamptz);
    create table articles(id dialektik_ulid primary key,source_id dialektik_ulid references sources,
      origin text,live_exposure_id text,url_canonical text);
    create table live_acquisition_receipts(id dialektik_ulid primary key,source_id dialektik_ulid,
      exclusion_id text,canonical_url text,disposition text);
    create table live_article_versions(id dialektik_ulid primary key,article_id dialektik_ulid,
      receipt_id dialektik_ulid,version_number int,headline text,published_at timestamptz);`);
    const text = readFileSync(
      new URL(
        '../../../packages/database/src/migration/048_headline_semantic_review.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const ddl = /const HEADLINE_REVIEW_SQL = String\.raw`([\s\S]*?)`;/.exec(text)?.[1];
    assert.ok(ddl, 'migration SQL available');
    await db.exec(ddl);
    await db.exec(
      `grant select on sources,live_source_policies,users,moderation_auth_sessions,editorial_single_editor_authorizations,articles,live_acquisition_receipts,live_article_versions to dialektik_core_app; create role test_moderator; create role test_ai; grant dialektik_core_app,dialektik_moderation_writer to test_moderator; grant dialektik_core_app,dialektik_headline_ai_writer to test_ai`,
    );
    await db.query(`insert into sources values ($1,'LIVE_REAL','Fixture','example.invalid')`, [
      source,
    ]);
    await db.query(
      `insert into live_source_policies values($1,$2,true,'LIVE_READY','METADATA_ONLY',$3,now())`,
      [
        policy,
        source,
        JSON.stringify({
          rightsReviewStatus: 'APPROVED',
          authorizationReference: 'fixture',
          endpoint: 'https://example.invalid/feed',
          rightsEvidenceUrl: 'https://example.invalid/terms',
        }),
      ],
    );
    await db.query(`insert into users values($1,'editor')`, [user]);
    await db.query(
      `insert into moderation_auth_sessions values($1,$2,'test-hash',now()+interval '1 day',null)`,
      [receipt, user],
    );
    await db.query(`insert into editorial_single_editor_authorizations values($1,null)`, [user]);
    await db.query(
      `insert into articles values($1,$2,'LIVE_REAL','x','https://example.invalid/article')`,
      [article, source],
    );
    await db.query(
      `insert into live_acquisition_receipts values($1,$2,'x','https://example.invalid/article','PERSISTED')`,
      [receipt, source],
    );
    await db.query(`insert into live_article_versions values($1,$2,$3,1,$4,now())`, [
      version,
      article,
      receipt,
      headline,
    ]);
    await db.exec('set role test_moderator');
    await assert.rejects(
      db.query(
        `insert into headline_ai_source_grants values($1,$2,$3,$4,'fixture','https://example.invalid/terms','CLOUDFLARE_WORKERS_AI','HEADLINE_ONLY','EDITORIAL_REVIEW_ONLY',now()-interval '1 minute',null,null,now())`,
        [grant, source, policy, user],
      ),
    );
    const pool = {
      async connect() {
        return {
          query: (query, values) =>
            db.query(typeof query === 'string' ? query : query.text, values ?? query.values ?? []),
          release() {},
        };
      },
      async end() {},
    };
    kysely = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const previousFlag = process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED;
    process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED = 'true';
    const editorial = new HeadlineReviewService(
      { database: kysely },
      {
        async authenticate() {
          return {
            kind: 'session',
            role: 'editor',
            userId: user,
            sessionId: receipt,
            tokenHash: 'test-hash',
          };
        },
      },
      { database: kysely },
    );
    try {
      assert.deepEqual(
        await editorial.setSourceGrant('Bearer fixture', source, grant, {
          action: 'ENABLE',
        }),
        { sourceId: source, enabled: true },
      );
      assert.deepEqual(
        await editorial.setSourceGrant('Bearer fixture', source, grant, {
          action: 'ENABLE',
        }),
        { sourceId: source, enabled: true },
      );
      assert.equal((await editorial.sources('Bearer fixture'))[0].current, true);
      await db.exec('reset role; set role test_ai');
      const repository = new HeadlineSemanticRepository(
        kysely,
        user,
        'fixture-model',
        hash('fixture-config'),
      );
      const candidate = (await repository.eligible(1))[0];
      assert.equal(candidate.articleId, article);
      let receivedTitle = null;
      const transport = {
        kind: 'external',
        providerType: 'llm_cloudflare_workers_ai',
        name: 'fixture',
        async generate(_stage, payload) {
          receivedTitle = payload.title;
          assert.equal(payload.body, '');
          return {
            output: {
              status: 'INSUFFICIENT_EVIDENCE',
              boundedOccurrence: false,
              boundedThread: false,
              facts: [],
            },
          };
        },
      };
      const result = await analyzeHeadlineForReview(
        candidate,
        transport,
        repository.hooks(),
        new AbortController().signal,
      );
      assert.equal(receivedTitle, headline);
      assert.equal(result.extraction.status, 'INSUFFICIENT_EVIDENCE');
      const insufficientAttemptId = result.attemptId;
      assert.equal((await repository.eligible(1)).length, 0);
      const attempt = (id) =>
        db.query(
          `insert into headline_ai_attempts values($1,$2,$3,$4,$5,$6,$7,$8,'fixture',$9,now())`,
          [id, grant, source, policy, article, version, user, hash(headline), hash(id)],
        );
      const aid = '01M4YDQK00EVART00000000005';
      await attempt(aid);
      await assert.rejects(
        db.query(
          `insert into headline_ai_attempts values($1,$2,$3,$4,$5,$6,$7,$8,'fixture',$9,now())`,
          [
            '01M4YDQK00EVART00000000009',
            grant,
            source,
            policy,
            article,
            version,
            user,
            hash(headline),
            hash(aid),
          ],
        ),
      );
      const points = Array.from(headline);
      const fact = (id, role, value) => {
        const start = Array.from(headline.slice(0, headline.indexOf(value))).length;
        return {
          id,
          role,
          valueHash: hash(value),
          retrievalHash: hash(value.toLowerCase()),
          isoDate: role === 'date' ? value : null,
          evidence: {
            field: 'title',
            start,
            end: start + Array.from(value).length,
            sourceSha256: hash(headline),
            spanSha256: hash(value),
          },
        };
      };
      const valid = {
        status: 'OBSERVATION_AVAILABLE',
        boundedOccurrence: true,
        boundedThread: false,
        facts: [fact('f1', 'action', 'aprobó'), fact('f2', 'date', '2026-10-28')],
      };
      assert.equal(points.length, 37);
      await db.query(`insert into headline_ai_attempt_outcomes values($1,'VALIDATED',$2,now())`, [
        aid,
        JSON.stringify(valid),
      ]);
      await db.exec('reset role; set role test_moderator');
      assert.ok((await editorial.list('Bearer fixture')).some((row) => row.attemptId === aid));
      await assert.rejects(
        editorial.decide('Bearer fixture', insufficientAttemptId, '01M4YDQK00EVART00000000012', {
          decision: 'ACCEPT_FOR_GROUPING',
        }),
      );
      assert.equal(
        (
          await editorial.decide(
            'Bearer fixture',
            insufficientAttemptId,
            '01M4YDQK00EVART00000000013',
            {
              decision: 'NEEDS_EVIDENCE',
            },
          )
        ).decision,
        'NEEDS_EVIDENCE',
      );
      const decisionId = '01M4YDQK00EVART00000000006';
      const decision = await editorial.decide('Bearer fixture', aid, decisionId, {
        decision: 'ACCEPT_FOR_GROUPING',
      });
      assert.equal(decision.decision, 'ACCEPT_FOR_GROUPING');
      assert.deepEqual(
        await editorial.decide('Bearer fixture', aid, decisionId, {
          decision: 'ACCEPT_FOR_GROUPING',
        }),
        decision,
      );
      await assert.rejects(
        editorial.decide('Bearer fixture', aid, '01M4YDQK00EVART00000000010', {
          decision: 'REJECT',
        }),
      );
      await db.exec('reset role; set role test_ai');
      const badid = '01M4YDQK00EVART00000000007';
      await attempt(badid);
      const bad = structuredClone(valid);
      bad.facts[0].evidence.start = 0;
      await assert.rejects(
        db.query(`insert into headline_ai_attempt_outcomes values($1,'VALIDATED',$2,now())`, [
          badid,
          JSON.stringify(bad),
        ]),
      );
      const injected = structuredClone(valid);
      injected.rawBody = 'not permitted';
      await assert.rejects(
        db.query(`insert into headline_ai_attempt_outcomes values($1,'VALIDATED',$2,now())`, [
          badid,
          JSON.stringify(injected),
        ]),
      );
      await assert.rejects(
        db.query(`update headline_ai_attempts set model='other' where id=$1`, [aid]),
      );
      await assert.rejects(db.exec(`truncate headline_ai_attempts cascade`));
      await db.exec('reset role; set role test_moderator');
      assert.deepEqual(
        await editorial.setSourceGrant('Bearer fixture', source, '01M4YDQK00EVART00000000011', {
          action: 'REVOKE',
        }),
        { sourceId: source, enabled: false },
      );
      await db.exec('reset role; set role test_ai');
      await assert.rejects(attempt('01M4YDQK00EVART00000000008'));
      await db.exec('reset role');
      const rights =
        await db.query(`select has_table_privilege('anon','headline_ai_attempts','SELECT') a,
    has_table_privilege('dialektik_core_app','headline_ai_attempts','INSERT') b,
    has_table_privilege('dialektik_headline_ai_writer','headline_ai_attempts','INSERT') c`);
      assert.deepEqual(rights.rows[0], { a: false, b: false, c: true });
    } finally {
      if (previousFlag === undefined) delete process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED;
      else process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED = previousFlag;
    }
  } finally {
    if (kysely) await kysely.destroy();
    await db.close();
  }
});
