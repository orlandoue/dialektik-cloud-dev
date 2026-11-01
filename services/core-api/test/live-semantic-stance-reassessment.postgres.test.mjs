import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { LiveSemanticProductionService } from '../dist/semantic/live-semantic-production.service.js';
import { liveStanceReassessmentDdl } from '../../../packages/database/dist/migration/076_live_stance_reassessment.js';

const id = (n) => `01M4YDQK00EVART${String(n).padStart(11, '0')}`;
const originalConfig = 'a'.repeat(64);
const stanceConfig = createHash('sha256').update(`${originalConfig}\nstance-pair-v1`).digest('hex');

test('reassesses a current literal pair once and retains the original classification', async () => {
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
      create table live_semantic_event_group_candidates(id dialektik_ulid primary key,target_day date,config_sha256 text);
      create table live_semantic_pair_assessments(id dialektik_ulid primary key);
      create table assertion_extraction_generations(id dialektik_ulid primary key,input_hash text,state text,proposal_payload jsonb);
      create table live_semantic_excerpt_inputs(article_id text,headline text,source_name text,text_original text,input_sha256 text);
      create table live_semantic_claim_pair_assessments(id dialektik_ulid primary key,run_id dialektik_ulid,group_id dialektik_ulid,
        left_article_id dialektik_ulid,left_claim_ordinal int,right_article_id dialektik_ulid,right_claim_ordinal int,
        left_extraction_generation_id dialektik_ulid,right_extraction_generation_id dialektik_ulid,
        same_event boolean,relation text,ratio_conflicting int,ratio_comparable int,same_event_confidence int,
        threshold_rule text,provider_type text,model_id text,config_sha256 text,created_at timestamptz);
    `);
    await db.exec(liveStanceReassessmentDdl.schema);
    const leftText = 'Titular. El fiscal sostuvo que recibió el aviso.';
    const rightText = 'Titular. La ministra negó haber recibido el aviso. Luego pidió revisar el caso.';
    const span = (text, quote) => ({ quoted_text: quote, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length });
    const left = span(leftText, 'El fiscal sostuvo que recibió el aviso.');
    const right = span(rightText, 'La ministra negó haber recibido el aviso.');
    const right2 = span(rightText, 'Luego pidió revisar el caso.');
    await db.query('insert into users values($1)', [id(1)]);
    await db.query('insert into live_semantic_production_runs values($1)', [id(2)]);
    await db.query("insert into live_semantic_event_group_candidates values($1,'2026-10-29',$2)", [id(3), originalConfig]);
    await db.query("insert into assertion_extraction_generations values($1,'hash-a','active',$3::jsonb),($2,'hash-b','active',$4::jsonb)",
      [id(4), id(5), JSON.stringify({ spans: [left] }), JSON.stringify({ spans: [right,right2] })]);
    await db.query("insert into live_semantic_excerpt_inputs values($1,'Titular','Fuente A',$3,'hash-a'),($2,'Titular','Fuente B',$4,'hash-b')",
      [id(6), id(7), leftText, rightText]);
    const insertOld = (pair, ordinal) => db.query(`insert into live_semantic_claim_pair_assessments values
      ($1,$2,$3,$4,1,$5,$6,$7,$8,true,'CONSISTENT',0,100,100,'original','llm_cloudflare_workers_ai',
       '@cf/meta/llama-3.1-8b-instruct',$9,now())`, [pair,id(2),id(3),id(6),id(7),ordinal,id(4),id(5),originalConfig]);
    await insertOld(id(8), 1);
    const pool = { async connect() { return { query: (query, values) =>
      db.query(typeof query === 'string' ? query : query.text, values ?? query.values ?? []), release() {} }; }, async end() {} };
    database = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const service = new LiveSemanticProductionService({}, { database }, {});
    let calls = 0;
    const transport = { async generate(_stage, input) {
      calls += 1;
      assert.equal(input.left.quote, left.quoted_text);
      return { output: { sameEvent: true, sameEventConfidence: 90, relation: 'CONTRADICTORY', ratioConflicting: 65, ratioComparable: 80 } };
    } };
    const run = () => service.reassessClaimPairs(database,id(2),id(1),'2026-10-29',originalConfig,transport);
    assert.deepEqual(await run(), { attempted: 1, validated: 1, invalid: 0, unavailable: 0 });
    assert.deepEqual(await run(), { attempted: 0, validated: 0, invalid: 0, unavailable: 0 });
    assert.equal(calls, 1);
    const rows = await db.query('select relation,config_sha256 from live_semantic_claim_pair_assessments order by config_sha256');
    assert.deepEqual(new Set(rows.rows.map((row) => `${row.relation}:${row.config_sha256}`)),
      new Set([`CONSISTENT:${originalConfig}`, `CONTRADICTORY:${stanceConfig}`]));
    await insertOld(id(9), 2);
    const invalidTransport = { async generate() { return { output: { sameEvent: true, sameEventConfidence: 90,
      relation: 'DIVERGENT', ratioConflicting: 80, ratioComparable: 90 } }; } };
    const invalid = () => service.reassessClaimPairs(database,id(2),id(1),'2026-10-29',originalConfig,invalidTransport);
    assert.equal((await invalid()).invalid, 1);
    assert.equal((await invalid()).attempted, 0);
    await insertOld(id(10), 1);
    await db.exec("update live_semantic_excerpt_inputs set input_sha256='changed' where source_name='Fuente A'");
    const unavailable = await run();
    assert.equal(unavailable.unavailable, 1);
    assert.equal(calls, 1);
    const outcomes = await db.query('select outcome,count(*)::int as count from live_semantic_stance_pair_outcomes group by outcome order by outcome');
    assert.deepEqual(outcomes.rows, [{ outcome: 'INPUT_UNAVAILABLE', count: 1 }, { outcome: 'INVALID_MODEL_RESPONSE', count: 1 }, { outcome: 'VALIDATED', count: 1 }]);
  } finally {
    if (database) await database.destroy();
    await db.close();
  }
});
