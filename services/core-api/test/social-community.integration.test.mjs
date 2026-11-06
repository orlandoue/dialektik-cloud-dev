import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { socialCommunitySql } from '../../../packages/database/dist/migration/083_social_community.js';

const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
test('community votes are shared but writes are bound to the authenticated user', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key); create domain dialektik_ulid as text;
      create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
      create table public.events(id dialektik_ulid primary key);
      create table public.articles(id dialektik_ulid primary key);
      insert into auth.users values('${a}'),('${b}'); insert into public.events values('event1'); insert into public.articles values('article1');`);
    await db.exec(socialCommunitySql);
    await db.exec(`set role dialektik_core_app; begin; select set_config('dialektik.social_user','${a}',true);
      insert into public.social_reactions(event_id,user_id,reaction) values('event1','${a}','SOLID'); commit;`);
    await db.exec(`begin; select set_config('dialektik.social_user','${b}',true);`);
    assert.equal((await db.query('select count(*)::int as n from public.social_reactions')).rows[0].n,1);
    assert.equal((await db.query(`update public.social_reactions set reaction='BIASED' where user_id='${a}' returning *`)).rows.length,0);
    await assert.rejects(db.exec(`insert into public.social_evidence_comments(event_id,user_id,article_id,body) values ('event1','${a}','article1','spoof')`));
    await db.exec('rollback');
    await db.exec(`begin; select set_config('dialektik.social_user','${b}',true);
      insert into public.social_reactions(event_id,user_id,reaction) values('event1','${b}','BIASED');
      insert into public.social_evidence_comments(event_id,user_id,article_id,body) values('event1','${b}','article1','Aporte con fuente'); commit;`);
    assert.equal((await db.query('select count(*)::int as n from public.social_reactions')).rows[0].n,2);
    assert.equal((await db.query('select body from public.social_evidence_comments')).rows[0].body,'Aporte con fuente');
  } finally { await db.close(); }
});

test('service aggregates shared votes and accepts only evidence from the published event', async () => {
  const { Kysely, PostgresDialect } = await import('kysely');
  const { SocialService } = await import('../dist/public-api/social.service.js');
  const pg=new PGlite(); let database;
  try {
    await pg.exec(`create schema auth; create table auth.users(id uuid primary key); create domain dialektik_ulid as text;
      create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
      create table public.events(id dialektik_ulid primary key);
      create table public.public_events(id dialektik_ulid primary key,analysis_state text);
      create table public.articles(id dialektik_ulid primary key,event_id dialektik_ulid,source_id dialektik_ulid,url_canonical text);
      insert into auth.users values('${a}'),('${b}');
      insert into public.events values('event1'),('event2');
      insert into public.public_events values('event1','PUBLISHED'),('event2','PUBLISHED');
      insert into public.articles values('article1','event1','source1','https://example.cl/a'),('article2','event2','source2','https://example.cl/b');
      grant select on public.public_events,public.articles to dialektik_core_app;`);
    await pg.exec(socialCommunitySql);
    await pg.exec('set role dialektik_core_app');
    const pool={async connect(){return {query:(query,values)=>pg.query(typeof query==='string'?query:query.text,values??query.values??[]),release(){}}},async end(){}};
    database=new Kysely({dialect:new PostgresDialect({pool})});
    const service=new SocialService({database});
    await service.react(a,'event1','SOLID');
    await service.react(b,'event1','BIASED');
    const summary=await service.summary(a,'event1');
    assert.equal(summary.solid,1); assert.equal(summary.biased,1); assert.equal(summary.mine,'SOLID');
    await assert.rejects(service.comment(a,'event1','article2','Sin vínculo'));
    await service.comment(a,'event1','article1','Cita y contexto');
    const updated=await service.summary(b,'event1');
    assert.equal(updated.comments.length,1);
    assert.equal(updated.comments[0].url,'https://example.cl/a');
    assert.equal(updated.comments[0].body,'Cita y contexto');
    assert.equal('user_id' in updated.comments[0],false);
    assert.equal((await service.summary(b,undefined,'source1')).solid,1);
    await service.react(a,'event1',null);
    assert.equal((await service.summary(a,'event1')).solid,0);
  } finally { if(database) await database.destroy(); await pg.close(); }
});
