import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { LiveSemanticProductionService } from '../dist/semantic/live-semantic-production.service.js';
import { liveStanceReassessmentDdl } from '../../../packages/database/dist/migration/076_live_stance_reassessment.js';

const id = (n) => `01M4YDQK00EVART${String(n).padStart(11, '0')}`;
const config = 'a'.repeat(64);

test('groups a confirmed case with non-comparable claims without inventing a conflict', async () => {
  const db = new PGlite();
  let database;
  try {
    await db.exec(`
      create domain dialektik_ulid as text;
      create role anon; create role authenticated; create role service_role;
      create role dialektik_core_app; create role dialektik_headline_ai_writer;
      create table users(id dialektik_ulid primary key);
      create table articles(id dialektik_ulid primary key);
      create table live_semantic_production_runs(id dialektik_ulid primary key);
      create table live_semantic_event_group_candidates(id dialektik_ulid primary key,origin_run_id dialektik_ulid,
        group_key_sha256 text unique,target_day date,proposed_event_key text,proposed_title text,proposed_summary text,
        provider_type text,model_id text,config_sha256 text,review_state text,created_at timestamptz);
      create table live_semantic_editorial_decisions(group_id dialektik_ulid);
      create table live_semantic_event_group_members(group_id dialektik_ulid,article_id dialektik_ulid,source_id dialektik_ulid,
        extraction_generation_id dialektik_ulid,matched_at timestamptz,primary key(group_id,article_id));
      create table assertion_extraction_generations(id dialektik_ulid primary key,article_id dialektik_ulid,input_hash text,
        provider_id text,model_id text,schema_version text,config_version text,state text,outcome text,created_at timestamptz,proposal_payload jsonb);
      create table live_semantic_excerpt_inputs(article_id text,source_id text,source_name text,url_canonical text,headline text,
        published_at timestamptz,event_id text,text_original text,input_sha256 text);
      create table live_semantic_pair_assessments(id dialektik_ulid primary key,run_id dialektik_ulid,group_id dialektik_ulid,
        left_article_id dialektik_ulid,right_article_id dialektik_ulid,left_extraction_generation_id dialektik_ulid,
        right_extraction_generation_id dialektik_ulid,same_event boolean,relation text,ratio_conflicting int,ratio_comparable int,
        same_event_confidence int,threshold_rule text,provider_type text,model_id text,config_sha256 text,created_at timestamptz,
        unique(left_article_id,right_article_id,config_sha256));
      create table live_semantic_claim_pair_assessments(id dialektik_ulid primary key);
    `);
    await db.exec(liveStanceReassessmentDdl.schema);
    await db.query('insert into users values($1)', [id(1)]);
    await db.query('insert into live_semantic_production_runs values($1)', [id(2)]);
    await db.query('insert into articles values($1),($2)', [id(3), id(4)]);
    const left = 'Caso Monsalve: Fiscalía amplía diligencias';
    const right = 'Interior informa nuevas diligencias del caso Monsalve';
    const makePayload = (text) => JSON.stringify({ spans: [{ start: 0, end: text.length, quoted_text: text,
      assertion_text: text, event_key: 'caso-monsalve-diligencias', event_title: 'Caso Monsalve', event_summary: 'Nuevas diligencias del caso Monsalve' }] });
    await db.query(`insert into assertion_extraction_generations values
      ($1,$3,'hash-a','llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct','live-claim-extraction-v3',$5,'active','proposed',now(),$6::jsonb),
      ($2,$4,'hash-b','llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct','live-claim-extraction-v3',$5,'active','proposed',now(),$7::jsonb)`,
      [id(5), id(6), id(3), id(4), config, makePayload(left), makePayload(right)]);
    await db.query(`insert into live_semantic_excerpt_inputs values
      ($1,$3,'Fuente A','https://a.test/story',$5,'2026-10-29T13:00:00Z',null,$5,'hash-a'),
      ($2,$4,'Fuente B','https://b.test/story',$6,'2026-10-29T14:00:00Z',null,$6,'hash-b')`,
      [id(3), id(4), id(7), id(8), left, right]);
    const pool = { async connect() { return { query: (query, values) =>
      db.query(typeof query === 'string' ? query : query.text, values ?? query.values ?? []), release() {} }; }, async end() {} };
    database = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const service = new LiveSemanticProductionService({}, { database }, {});
    let calls = 0;
    const transport = { async generate() { calls += 1; return { output: { sameEvent: true, sameEventConfidence: 90,
      relation: 'NOT_COMPARABLE', ratioConflicting: 0, ratioComparable: 0 } }; } };
    const run = () => service.assessCurrentGroups(database,id(2),id(1),'2026-10-29',config,transport);
    assert.equal(await run(), 1);
    assert.equal(await run(), 0);
    assert.equal(calls, 1);
    const members = await db.query('select count(*)::int as count from live_semantic_event_group_members');
    const pairs = await db.query('select same_event,relation from live_semantic_pair_assessments');
    assert.equal(members.rows[0].count, 2);
    assert.deepEqual(pairs.rows, [{ same_event: true, relation: 'NOT_COMPARABLE' }]);
  } finally {
    if (database) await database.destroy();
    await db.close();
  }
});
