import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { userFollowedSourcesSql } from '../../../packages/database/dist/migration/080_user_followed_sources.js';
import { PublicApiRepository } from '../dist/public-api/public-api.repository.js';

const userA='11111111-1111-4111-8111-111111111111';
const userB='22222222-2222-4222-8222-222222222222';
test('follow preferences are isolated by authenticated user and deletion is scoped', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create domain dialektik_ulid as text;
   create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
   create table public.sources(id dialektik_ulid primary key);
   insert into auth.users values('${userA}'),('${userB}'); insert into public.sources values('source-a'),('source-b');`);
  await db.exec(userFollowedSourcesSql);
  await db.exec(`set role dialektik_core_app; begin; select set_config('dialektik.follow_user','${userA}',true);
   insert into public.user_followed_sources(user_id,source_id) values('${userA}','source-a'); commit;`);
  await db.exec(`begin; select set_config('dialektik.follow_user','${userB}',true);`);
  assert.equal((await db.query('select * from public.user_followed_sources')).rows.length,0);
  await assert.rejects(db.exec(`insert into public.user_followed_sources(user_id,source_id) values('${userA}','source-b')`));
  await db.exec('rollback');
  await db.exec(`begin; select set_config('dialektik.follow_user','${userB}',true);
    insert into public.user_followed_sources(user_id,source_id) values('${userB}','source-b'); commit;`);
  await db.exec(`begin; select set_config('dialektik.follow_user','${userA}',true);`);
  assert.equal((await db.query('select * from public.user_followed_sources')).rows.length,1);
  const foreignDelete=await db.query(`delete from public.user_followed_sources where user_id='${userB}' returning *`);
  assert.equal(foreignDelete.rows.length,0);
  await db.exec('delete from public.user_followed_sources; commit;');
  await db.exec(`begin; select set_config('dialektik.follow_user','${userB}',true);`);
  assert.equal((await db.query('select * from public.user_followed_sources')).rows.length,1);
  await db.exec('commit;');
  await db.exec(`begin; select set_config('dialektik.follow_user','${userA}',true);`);
  assert.equal((await db.query('select * from public.user_followed_sources')).rows.length,0);
  await db.exec('rollback; reset role');
 } finally { await db.close(); }
});

test('followed events are ranked first without hiding others and blind spots exclude followed coverage', async () => {
 const db=new PGlite(); let database;
 try {
  await db.exec(`create domain dialektik_ulid as text;
   create table categories(id text,slug text,is_active boolean);
   create table events(id text,title_descriptive text,category_id text,detected_at timestamptz,analysis_state text,merged_into text);
   create table articles(id text,event_id text,source_id text,origin text,live_exposure_id text,url_canonical text,captured_at timestamptz);
   create table positions(id text,event_id text,publication_state text,status text,neutral_rank int,published_at timestamptz,published_by text,title_text text);
   create table assertions(id text,position_id text,claim_span_id text,lifecycle_state text,is_principal boolean,supersedes_id text);
   create table claim_spans(id text,article_id text,tombstone_id text);
   create table evidence(id text,scope_assertion_id text,anchor_span_id text,publication_state text,approved_by text,approved_at timestamptz,citable_source_url text);
   create table position_formed_by(position_id text,relationship_id text);
   create table relationships(id text,rel_type text,publication_state text,declared_by text,confirmed_by text,confirmed_at timestamptz);
   create table editorial_event_splits(original_event_id text);
   create table live_semantic_promotion_claims(group_id text,article_id text,claim_ordinal int,claim_span_id text,assertion_id text,evidence_id text,position_id text);
   create table live_semantic_promotion_positions(group_id text,event_id text,position_id text,editor_user_id text);
   create table live_semantic_editorial_decisions(group_id text,decision text,editor_user_id text,selected_claims jsonb);
   create table live_source_policies(id text,source_id text,active boolean,rights_class text,policy jsonb,recorded_at timestamptz);
   create table live_acquisition_receipts(exclusion_id text,source_id text,disposition text);
   create table contradiction_publications(id text,event_id text,publication_state text,confirmed_by text,confirmed_at timestamptz);
   insert into categories values('category','pais',true);
   insert into events select 'event-'||n,'Event '||n,'category',('2026-01-01T00:00:00Z'::timestamptz+n*interval '1 day'),'PUBLISHED',null from generate_series(1,3) n;
   insert into articles select 'article-'||n,'event-'||n,case when n=1 then 'followed' else 'other' end,'LIVE_REAL','ex-'||n,'https://example.test/'||n,now() from generate_series(1,3)n;
   insert into articles select 'article-extra-'||n,'event-'||n,'complement-'||n,'LIVE_REAL','ex-extra-'||n,'https://example.test/extra/'||n,now() from generate_series(1,3)n;
   insert into positions select 'position-'||n,'event-'||n,'published','active',1,now(),'editor','Claim' from generate_series(1,3)n;
   insert into assertions select 'assertion-'||n,'position-'||n,'span-'||n,'active',true,null from generate_series(1,3)n;
   insert into claim_spans select 'span-'||n,'article-'||n,null from generate_series(1,3)n;
   insert into evidence select 'evidence-'||n,'assertion-'||n,'span-'||n,'published','editor',now(),'https://example.test/'||n from generate_series(1,3)n;
   insert into relationships select 'relationship-'||n,'R01a','published','editor','editor',now() from generate_series(1,3)n;
   insert into position_formed_by select 'position-'||n,'relationship-'||n from generate_series(1,3)n;`);
  const pool={async connect(){return {query:(query,values)=>db.query(typeof query==='string'?query:query.text,values??query.values??[]),release(){}}},async end(){}};
  database=new Kysely({dialect:new PostgresDialect({pool})});
  const repository=new PublicApiRepository({database});
  const all=await repository.listFeed({cursor:null,limit:10,followedSourceIds:['followed']});
  assert.deepEqual(all.map(x=>x.id),['event-1','event-3','event-2']);
  assert.deepEqual(all.map(x=>x.is_followed_source_match),[true,false,false]);
  const second=await repository.listFeed({cursor:{id:'event-1',timestamp:all[0].detected_at},limit:10,followedSourceIds:['followed']});
  assert.deepEqual(second.map(x=>x.id),['event-3','event-2']);
  const blind=await repository.listFeed({cursor:null,limit:10,followedSourceIds:['followed'],blindspots:true});
  assert.deepEqual(blind.map(x=>x.id),['event-3','event-2']);
  assert.equal(await repository.countBlindspots(['followed']),2);
  await db.exec(`alter table contradiction_publications add column position_a_id text, add column position_b_id text,
     add column ratio_conflicting_at_publication integer, add column ratio_comparable_at_publication integer,
     add column threshold_rule_at_publication text;
    insert into positions select 'position-extra-'||n,'event-'||n,'published','active',2,now(),'editor','Other claim' from generate_series(1,3)n;
    insert into assertions select 'assertion-extra-'||n,'position-extra-'||n,'span-extra-'||n,'active',true,null from generate_series(1,3)n;
    insert into claim_spans select 'span-extra-'||n,'article-extra-'||n,null from generate_series(1,3)n;
    insert into evidence select 'evidence-extra-'||n,'assertion-extra-'||n,'span-extra-'||n,'published','editor',now(),'https://example.test/extra/'||n from generate_series(1,3)n;
    insert into position_formed_by select 'position-extra-'||n,'relationship-'||n from generate_series(1,3)n;
    insert into contradiction_publications(id,event_id,publication_state,confirmed_by,confirmed_at,position_a_id,position_b_id,ratio_conflicting_at_publication,ratio_comparable_at_publication,threshold_rule_at_publication)
      select 'publication-'||n,'event-'||n,'published','editor',('2026-01-01T00:00:00Z'::timestamptz+n*interval '1 day'),'position-'||n,'position-extra-'||n,0,100,'v1:editorial_focus_contrast' from generate_series(1,3)n;`);
  const contradictions=await repository.listContradictions({cursor:null,limit:10,followedSourceIds:['followed']});
  assert.deepEqual(contradictions.map(x=>x.id),['publication-1','publication-3','publication-2']);
  assert.deepEqual(contradictions.map(x=>x.is_followed_source_match),[true,false,false]);
  const remaining=await repository.listContradictions({cursor:{id:'publication-1',timestamp:contradictions[0].confirmed_at},limit:10,followedSourceIds:['followed']});
  assert.deepEqual(remaining.map(x=>x.id),['publication-3','publication-2']);
 } finally { if(database) await database.destroy(); await db.close(); }
});
