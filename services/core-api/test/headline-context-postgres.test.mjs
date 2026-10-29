import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { HeadlineContextRepository } from '../dist/semantic/headline-context-repository.js';
import { analyzeContextPair } from '../dist/semantic/headline-context-runner.js';
import { HeadlineContextAnalysisService } from '../dist/semantic/headline-context-analysis.service.js';
import { HeadlineReviewService } from '../dist/moderation/headline-review.service.js';

const ids = {
  editor: '01M4YDQK00ED1T0R0R1AND0VE1',
  leftSource: '01M4YDQK00CH1000C1PERCH11E',
  rightSource: '01M4YDQK00CH100C00PERAT1VA',
  leftArticle: '01M4YDQK00EVART00000000001',
  leftVersion: '01M4YDQK00EVART00000000002',
  rightArticle: '01M4YDQK00EVART00000000003',
  rightVersion: '01M4YDQK00EVART00000000004',
  leftGrant: '01M4YDQK00EVART00000000005',
  rightGrant: '01M4YDQK00EVART00000000006',
  leftReceipt: '01M4YDQK00EVART00000000007',
  rightReceipt: '01M4YDQK00EVART00000000008',
  attempt: '01M4YDQK00EVART00000000009',
};
const leftTitle = '🔴 Torres declaró sobre proceso Rivera';
const rightTitle = 'Torres enfrenta investigación sobre Rivera';
const hash = (v) => createHash('sha256').update(v, 'utf8').digest('hex');

function migration(file, symbol) {
  const text = readFileSync(
    new URL(`../../../packages/database/src/migration/${file}`, import.meta.url),
    'utf8',
  );
  const match = new RegExp(`const ${symbol} = String\\.raw\`([\\s\\S]*?)\`;`).exec(text);
  assert.ok(match, `migration ${file} exists`);
  return match[1];
}

test('isolated PostgreSQL verifies both source grants, shared title evidence and editor decisions', async () => {
  const db = new PGlite();
  let kysely;
  const previousHeadlineFlag = process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED;
  const previousContextFlag = process.env.DIALEKTIK_CONTEXT_PAIR_ENABLED;
  const previousToken = process.env.CLOUDFLARE_API_TOKEN;
  const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const previousFetch = globalThis.fetch;
  try {
    await db.exec(`create domain dialektik_ulid as text check (value ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$');
      create role anon; create role authenticated; create role dialektik_core_app; create role dialektik_moderation_writer;
      create table sources(id dialektik_ulid primary key,origin text,name text,canonical_domain text);
      create table live_source_policies(id text primary key,source_id dialektik_ulid references sources,
        active boolean,rights_class text,storage_policy text,policy jsonb,recorded_at timestamptz,unique(source_id,id));
      create table users(id dialektik_ulid primary key,role text);
      create table moderation_auth_sessions(id dialektik_ulid primary key,user_id dialektik_ulid,
        token_hash text,expires_at timestamptz,revoked_at timestamptz);
      create table editorial_single_editor_authorizations(editor_user_id dialektik_ulid,revoked_at timestamptz);
      create table articles(id dialektik_ulid primary key,source_id dialektik_ulid,origin text,live_exposure_id text,url_canonical text);
      create table live_acquisition_receipts(id dialektik_ulid primary key,source_id dialektik_ulid,
        exclusion_id text,canonical_url text,disposition text);
      create table live_article_versions(id dialektik_ulid primary key,article_id dialektik_ulid,
        receipt_id dialektik_ulid,version_number int,headline text,published_at timestamptz);`);
    await db.exec(migration('048_headline_semantic_review.ts', 'HEADLINE_REVIEW_SQL'));
    await db.exec(migration('050_headline_context_pair_review.ts', 'HEADLINE_CONTEXT_PAIR_SQL'));
    await db.exec(
      migration('051_headline_context_model_relation.ts', 'HEADLINE_CONTEXT_MODEL_RELATION_SQL'),
    );
    await db.exec(`grant select on sources,live_source_policies,users,moderation_auth_sessions,editorial_single_editor_authorizations,articles,
      live_acquisition_receipts,live_article_versions to dialektik_core_app;
      create role test_moderator; create role test_ai;
      grant dialektik_core_app,dialektik_moderation_writer to test_moderator;
      grant dialektik_core_app,dialektik_headline_ai_writer to test_ai;`);
    await db.query("insert into users values($1,'editor')", [ids.editor]);
    await db.query(
      `insert into moderation_auth_sessions values($1,$2,'test-hash',now()+interval '1 day',null)`,
      [ids.leftReceipt, ids.editor],
    );
    await db.query('insert into editorial_single_editor_authorizations values($1,null)', [
      ids.editor,
    ]);
    for (const [source, article, version, receipt, grant, domain, headline, policy] of [
      [
        ids.leftSource,
        ids.leftArticle,
        ids.leftVersion,
        ids.leftReceipt,
        ids.leftGrant,
        'left.invalid',
        leftTitle,
        'a'.repeat(64),
      ],
      [
        ids.rightSource,
        ids.rightArticle,
        ids.rightVersion,
        ids.rightReceipt,
        ids.rightGrant,
        'right.invalid',
        rightTitle,
        'b'.repeat(64),
      ],
    ]) {
      const url = `https://${domain}/story`;
      await db.query(`insert into sources values($1,'LIVE_REAL','Fixture',$2)`, [source, domain]);
      await db.query(
        `insert into live_source_policies values($1,$2,true,'LIVE_READY','METADATA_ONLY',$3,now())`,
        [
          policy,
          source,
          JSON.stringify({
            rightsReviewStatus: 'APPROVED',
            authorizationReference: 'fixture',
            endpoint: `https://${domain}/feed`,
            rightsEvidenceUrl: `https://${domain}/terms`,
          }),
        ],
      );
      await db.query(`insert into articles values($1,$2,'LIVE_REAL','x',$3)`, [
        article,
        source,
        url,
      ]);
      await db.query(`insert into live_acquisition_receipts values($1,$2,'x',$3,'PERSISTED')`, [
        receipt,
        source,
        url,
      ]);
      await db.query(`insert into live_article_versions values($1,$2,$3,1,$4,now())`, [
        version,
        article,
        receipt,
        headline,
      ]);
      await db.exec(
        `select set_config('dialektik.actor_id','${ids.editor}',false); select set_config('dialektik.actor_type','editor',false)`,
      );
      await db.query(
        `insert into headline_ai_source_grants values($1,$2,$3,$4,'fixture','https://example.invalid/terms',
        'CLOUDFLARE_WORKERS_AI','HEADLINE_ONLY','EDITORIAL_REVIEW_ONLY',now()-interval '1 minute',null,null,now())`,
        [grant, source, policy, ids.editor],
      );
    }
    await db.exec('set role test_ai');
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
    const repository = new HeadlineContextRepository(
      kysely,
      ids.editor,
      'fixture-model',
      hash('repository-config'),
    );
    const pair = await repository.nextPair();
    assert.equal(pair.left.articleId, ids.leftArticle);
    assert.equal(pair.right.articleId, ids.rightArticle);
    const transport = {
      kind: 'external',
      providerType: 'llm_cloudflare_workers_ai',
      name: 'fixture',
      async generate(_stage, payload) {
        assert.deepEqual(Object.keys(payload.left).sort(), ['publishedAt', 'title']);
        return { output: { relation: 'POSSIBLY_SAME_THREAD' } };
      },
    };
    const generated = await analyzeContextPair(
      pair.left,
      pair.right,
      transport,
      repository.hooks(),
      new AbortController().signal,
    );
    assert.equal(generated.relation.relation, 'POSSIBLY_SAME_THREAD');
    assert.equal(generated.relation.modelRelation, 'POSSIBLY_SAME_THREAD');
    assert.equal(
      (
        await db.query(
          'select model_relation from headline_context_pair_outcomes where attempt_id=$1',
          [generated.attemptId],
        )
      ).rows[0].model_relation,
      'POSSIBLY_SAME_THREAD',
    );
    assert.equal(await repository.nextPair(), null);
    process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED = 'true';
    process.env.DIALEKTIK_CONTEXT_PAIR_ENABLED = 'true';
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-test';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32);
    const editorial = new HeadlineReviewService(
      { database: kysely },
      {
        async authenticate() {
          return {
            kind: 'session',
            role: 'editor',
            userId: ids.editor,
            sessionId: ids.leftReceipt,
            tokenHash: 'test-hash',
          };
        },
      },
      { database: kysely },
    );
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      const input = JSON.parse(request.messages[1].content);
      assert.deepEqual(Object.keys(input.left).sort(), ['publishedAt', 'title']);
      assert.equal(Object.hasOwn(request, 'tools'), false);
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            response: {
              relation: 'POSSIBLY_SAME_THREAD',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const analysis = new HeadlineContextAnalysisService(editorial, { database: kysely });
    const analyzed = await analysis.analyzeNext('Bearer fixture', {});
    assert.equal(analyzed.status, 'ANALYZED');
    assert.equal(analyzed.relation, 'POSSIBLY_SAME_THREAD');
    assert.equal(analyzed.modelRelation, 'POSSIBLY_SAME_THREAD');
    assert.deepEqual(await analysis.analyzeNext('Bearer fixture', {}), { status: 'NO_CANDIDATE' });
    await db.exec('reset role; set role test_moderator');
    const initialList = await editorial.listContextPairs('Bearer fixture');
    assert.equal(
      initialList.some((row) => row.attemptId === generated.attemptId),
      false,
    );
    assert.equal(
      initialList.some((row) => row.attemptId === analyzed.attemptId),
      true,
    );
    const decisionId = '01M4YDQK00EVART00000000015';
    const decision = await editorial.decideContextPair(
      'Bearer fixture',
      analyzed.attemptId,
      decisionId,
      { decision: 'KEEP_FOR_REVIEW' },
    );
    assert.deepEqual(
      await editorial.decideContextPair('Bearer fixture', analyzed.attemptId, decisionId, {
        decision: 'KEEP_FOR_REVIEW',
      }),
      decision,
    );
    await db.exec('reset role; set role test_ai');
    const insertAttempt = (id, rightGrant = ids.rightGrant) =>
      db.query(
        `insert into headline_context_pair_attempts
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'model',$11,now())`,
        [
          id,
          ids.leftArticle,
          ids.leftVersion,
          ids.leftGrant,
          hash(leftTitle),
          ids.rightArticle,
          ids.rightVersion,
          rightGrant,
          hash(rightTitle),
          ids.editor,
          hash(id),
        ],
      );
    await assert.rejects(insertAttempt('01M4YDQK00EVART00000000011', ids.leftGrant));
    await insertAttempt(ids.attempt);
    await db.query(
      `insert into headline_context_pair_outcomes values($1,'VALIDATED','POSSIBLY_SAME_THREAD',2,8,0,6,now())`,
      [ids.attempt],
    );
    const badAttempt = '01M4YDQK00EVART00000000011';
    await insertAttempt(badAttempt);
    await assert.rejects(
      db.query(
        `insert into headline_context_pair_outcomes values($1,'VALIDATED','POSSIBLY_SAME_EVENT',0,6,0,6,now())`,
        [badAttempt],
      ),
    );
    await db.query(
      `insert into headline_context_pair_outcomes values($1,'VALIDATED','UNCERTAIN',null,null,null,null,now())`,
      [badAttempt],
    );
    const legacyAttempt = '01M4YDQK00EVART00000000017';
    await insertAttempt(legacyAttempt);
    await db.query(
      `insert into headline_context_pair_outcomes values($1,'VALIDATED','POSSIBLY_SAME_EVENT',2,8,0,6,now())`,
      [legacyAttempt],
    );
    await assert.rejects(
      db.query(`update headline_context_pair_attempts set model='other' where id=$1`, [
        ids.attempt,
      ]),
    );
    await db.exec('reset role; set role test_moderator');
    const reviewList = await editorial.listContextPairs('Bearer fixture');
    assert.equal(
      reviewList.find((row) => row.attemptId === analyzed.attemptId).reviewDecision,
      'KEEP_FOR_REVIEW',
    );
    const legacy = reviewList.find((row) => row.attemptId === legacyAttempt);
    assert.equal(legacy.relation, 'UNCERTAIN');
    assert.equal(legacy.modelRelation, 'POSSIBLY_SAME_EVENT');
    await assert.rejects(
      editorial.decideContextPair('Bearer fixture', legacyAttempt, '01M4YDQK00EVART00000000018', {
        decision: 'KEEP_FOR_REVIEW',
      }),
      (error) => error.status === 409,
    );
    await db.exec(
      `select set_config('dialektik.actor_id','${ids.editor}',false); select set_config('dialektik.actor_type','editor',false)`,
    );
    await db.query(
      `insert into headline_context_pair_decisions values($1,$2,$3,'KEEP_FOR_REVIEW',now())`,
      ['01M4YDQK00EVART00000000010', ids.attempt, ids.editor],
    );
    await assert.rejects(
      db.query(
        `insert into headline_context_pair_decisions values($1,$2,$3,'KEEP_FOR_REVIEW',now())`,
        ['01M4YDQK00EVART00000000014', badAttempt, ids.editor],
      ),
    );
    await assert.rejects(
      db.query(
        `insert into headline_context_pair_decisions values($1,$2,$3,'KEEP_FOR_REVIEW',now())`,
        ['01M4YDQK00EVART00000000012', ids.attempt, ids.editor],
      ),
    );
    await db.query(`update headline_ai_source_grants set revoked_at=now() where id=$1`, [
      ids.rightGrant,
    ]);
    await db.exec('reset role; set role test_ai');
    await assert.rejects(insertAttempt('01M4YDQK00EVART00000000013'));
    await db.exec('reset role');
    const permissions =
      await db.query(`select has_table_privilege('anon','headline_context_pair_attempts','SELECT') as anon_read,
      has_table_privilege('dialektik_core_app','headline_context_pair_attempts','INSERT') as reader_write,
      has_function_privilege('anon','public.dialektik_context_title_authorized(dialektik_ulid,dialektik_ulid,dialektik_ulid,text,dialektik_ulid)','EXECUTE') as anon_function`);
    assert.deepEqual(permissions.rows[0], {
      anon_read: false,
      reader_write: false,
      anon_function: false,
    });
  } finally {
    if (previousHeadlineFlag === undefined) delete process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED;
    else process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED = previousHeadlineFlag;
    if (previousContextFlag === undefined) delete process.env.DIALEKTIK_CONTEXT_PAIR_ENABLED;
    else process.env.DIALEKTIK_CONTEXT_PAIR_ENABLED = previousContextFlag;
    if (previousToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = previousToken;
    if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;
    globalThis.fetch = previousFetch;
    if (kysely) await kysely.destroy();
    await db.close();
  }
});
