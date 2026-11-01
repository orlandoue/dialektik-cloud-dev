import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {Kysely,PostgresDialect} from 'kysely';
import {LiveSemanticProductionService} from '../dist/semantic/live-semantic-production.service.js';
import {liveJointScopeReviewDdl} from '../../../packages/database/dist/migration/078_live_joint_scope_review.js';
import {jointClaimProvenanceDdl} from '../../../packages/database/dist/migration/079_joint_claim_provenance.js';
const id=n=>`01M4YDQK00EVART${String(n).padStart(11,'0')}`;
test('joint review checks both grants, saves grounded result, and never resends same inputs',async()=>{
 const db=new PGlite();let database;
 try {
  await db.exec(`create domain dialektik_ulid as text;
    create role anon;create role authenticated;create role service_role;create role dialektik_core_app;create role dialektik_headline_ai_writer;
    create table users(id dialektik_ulid primary key);create table articles(id dialektik_ulid primary key,text_original text);
    create schema extensions; create function extensions.digest(bytea,text) returns bytea language sql as $$ select decode(repeat('aa',32),'hex') $$;
    create table live_semantic_production_runs(id dialektik_ulid primary key);
    create table live_semantic_event_group_candidates(id dialektik_ulid primary key,target_day date,config_sha256 text);
    create table live_semantic_event_group_members(group_id dialektik_ulid,article_id dialektik_ulid,source_id dialektik_ulid);
    create table live_semantic_pair_assessments(group_id dialektik_ulid,left_article_id dialektik_ulid,right_article_id dialektik_ulid,same_event boolean,same_event_confidence int);
    create table live_semantic_excerpt_inputs(article_id text,input_sha256 text,text_original text,headline text,source_name text);
    create function public.dialektik_live_semantic_route_allowed(dialektik_ulid,text,text,text) returns boolean language sql as $$ select true $$;`);
  await db.exec(liveJointScopeReviewDdl);
  await db.exec(jointClaimProvenanceDdl);
  const hash='a'.repeat(64),left='Atacama 2026: el MOP informó 115 millones.',right='Atacama 2026: el MOP informó 130 millones.';
  await db.query('insert into users values($1);',[id(1)]);await db.query('insert into live_semantic_production_runs values($1)',[id(2)]);
  await db.query('insert into articles values($1,$3),($2,$4)',[id(3),id(4),left,right]);
  await db.query("insert into live_semantic_event_group_candidates values($1,'2026-10-31',$2)",[id(5),hash]);
  await db.query('insert into live_semantic_event_group_members values($1,$2,$4),($1,$3,$5)',[id(5),id(3),id(4),id(6),id(7)]);
  await db.query('insert into live_semantic_pair_assessments values($1,$2,$3,true,90)',[id(5),id(3),id(4)]);
  await db.query("insert into live_semantic_excerpt_inputs values($1,$3,$4,'Titular A','Fuente A'),($2,$3,$5,'Titular B','Fuente B')",[id(3),id(4),hash,left,right]);
  const pool={async connect(){return {query:(q,v)=>db.query(typeof q==='string'?q:q.text,v??q.values??[]),release(){}}},async end(){}};
  database=new Kysely({dialect:new PostgresDialect({pool})});const service=new LiveSemanticProductionService({}, {database}, {});let calls=0;
  const transport={async generate(_stage,input){calls++;assert.equal(input.left.textOriginal,left);assert.equal(input.right.textOriginal,right);return {output:{status:'ALIGNED',sharedSubject:'MOP',sharedPeriod:'2026',sharedScope:'Atacama',left:{quotedText:'el MOP informó 115 millones.',subject:'MOP',period:'2026',scope:'Atacama',assertionText:'El MOP informó 115 millones.'},right:{quotedText:'el MOP informó 130 millones.',subject:'MOP',period:'2026',scope:'Atacama',assertionText:'El MOP informó 130 millones.'},relation:'CONTRADICTORY',ratioConflicting:75,ratioComparable:90}}}};
  const run=()=>service.assessJointScope(database,id(2),id(1),'2026-10-31',hash,transport);
  const first=await run();assert.equal(first.attempted,1);assert.equal(first.aligned,1);assert.equal((await run()).attempted,0);assert.equal(calls,1);
  const citations=await db.query('select side,quoted_text,char_start,char_end from public.live_semantic_joint_claims order by side');
  assert.equal(citations.rows.length,2);assert.equal(citations.rows[0].quoted_text,'el MOP informó 115 millones.');
  await assert.rejects(db.query("update public.live_semantic_joint_claims set quoted_text='alterada'"), /JOINT_CLAIM_PROVENANCE_IMMUTABLE/);
  await assert.rejects(db.query(`insert into public.live_semantic_joint_claims
    (id,attempt_id,article_id,side,input_sha256,quoted_text,char_start,char_end,assertion_text,created_at)
    select $1,attempt_id,article_id,side,input_sha256,'cita alterada',char_start,char_end,assertion_text,now()
    from public.live_semantic_joint_claims where side='left'`,[id(90)]),/JOINT_CLAIM_PROVENANCE_INVALID/);
  const saved=await db.query('select outcome,result from public.live_semantic_joint_scope_outcomes');assert.equal(saved.rows[0].outcome,'VALIDATED');assert.equal(saved.rows[0].result.scopeAligned,true);
 } finally {if(database)await database.destroy();await db.close()}
});
