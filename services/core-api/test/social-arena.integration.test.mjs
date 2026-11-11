import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { socialCommunitySql } from '../../../packages/database/dist/migration/083_social_community.js';
import { socialArenaSql } from '../../../packages/database/dist/migration/085_social_arena.js';

const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';

const baseSchema=`create schema auth; create table auth.users(id uuid primary key); create domain dialektik_ulid as text;
  create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
  create table public.events(id dialektik_ulid primary key);
  create table public.public_events(id dialektik_ulid primary key,analysis_state text);
  create table public.positions(id dialektik_ulid primary key,event_id dialektik_ulid,publication_state text);
  create table public.articles(id dialektik_ulid primary key,event_id dialektik_ulid,source_id dialektik_ulid,url_canonical text);
  insert into auth.users values('${a}'),('${b}'),('${c}');
  insert into public.events values('event1'),('event2'),('draft');
  insert into public.public_events values('event1','PUBLISHED'),('event2','PUBLISHED'),('draft','ANALYSIS_PENDING');
  insert into public.positions values('posA','event1','published'),('posB','event1','published'),
    ('posInternal','event1','internal'),('posOther','event2','published');
  insert into public.articles values('article1','event1','source1','https://example.cl/a'),('article2','event2','source2','https://example.cl/b');
  grant select on public.public_events,public.articles,public.positions to dialektik_core_app;`;

async function serviceOn(pg) {
  const { Kysely, PostgresDialect } = await import('kysely');
  const { SocialArenaService } = await import('../dist/public-api/social-arena.service.js');
  const pool={async connect(){return {query:(query,values)=>pg.query(typeof query==='string'?query:query.text,values??query.values??[]),release(){}}},async end(){}};
  const database=new Kysely({dialect:new PostgresDialect({pool})});
  return { database, service:new SocialArenaService({database}) };
}

test('row security binds posture votes, entries and usefulness votes to the reader', async () => {
  const db=new PGlite();
  try {
    await db.exec(baseSchema); await db.exec(socialCommunitySql); await db.exec(socialArenaSql);
    await db.exec(`set role dialektik_core_app; begin; select set_config('dialektik.social_user','${a}',true);
      insert into public.social_position_votes(event_id,user_id,position_id) values('event1','${a}','posA');
      insert into public.social_community_entries(event_id,user_id,channel,author_alias,body) values('event1','${a}','DEBATE','Lector-AAAA','Opino');
      commit;`);
    await db.exec(`begin; select set_config('dialektik.social_user','${b}',true);`);
    await assert.rejects(db.exec(`insert into public.social_position_votes(event_id,user_id,position_id) values('event2','${a}','posOther')`));
    await db.exec('rollback');
    await db.exec(`begin; select set_config('dialektik.social_user','${b}',true);`);
    assert.equal((await db.query(`update public.social_position_votes set position_id='posB' where user_id='${a}' returning *`)).rows.length,0);
    assert.equal((await db.query(`delete from public.social_position_votes where user_id='${a}' returning *`)).rows.length,0);
    await assert.rejects(db.exec(`insert into public.social_community_entries(event_id,user_id,channel,author_alias,body) values('event1','${a}','DEBATE','Otro','spoof')`));
    await db.exec('rollback');
    // A contribution or a note without any source is refused by the table itself.
    await db.exec(`begin; select set_config('dialektik.social_user','${b}',true);`);
    await assert.rejects(db.exec(`insert into public.social_community_entries(event_id,user_id,channel,author_alias,body) values('event1','${b}','NOTA','Lector-BBBB','sin fuente')`));
    await db.exec('rollback');
    await db.exec(`begin; select set_config('dialektik.social_user','${b}',true);`);
    await assert.rejects(db.exec(`insert into public.social_community_entries(event_id,user_id,channel,author_alias,body,link_url) values('event1','${b}','APORTE','Lector-BBBB','x','javascript:alert(1)')`));
    await db.exec('rollback');
    // Entries are append-only for the Core role.
    await assert.rejects(db.exec(`update public.social_community_entries set body='editado'`));
    await assert.rejects(db.exec(`delete from public.social_community_entries`));
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('posture votes are counted per side and a reader holds one vote per case', async () => {
  const pg=new PGlite(); let database;
  try {
    await pg.exec(baseSchema); await pg.exec(socialCommunitySql); await pg.exec(socialArenaSql);
    await pg.exec('set role dialektik_core_app');
    const built=await serviceOn(pg); database=built.database; const service=built.service;
    assert.deepEqual(await service.positionVotes(a,'event1'),{total:0,mine:null,positions:[]});
    await service.votePosition(a,'event1','posA');
    await service.votePosition(b,'event1','posA');
    await service.votePosition(c,'event1','posB');
    let votes=await service.positionVotes(c,'event1');
    assert.equal(votes.total,3); assert.equal(votes.mine,'posB');
    assert.deepEqual(votes.positions,[{position_id:'posA',votes:2},{position_id:'posB',votes:1}]);
    // Changing sides moves the single vote instead of adding one.
    await service.votePosition(c,'event1','posA');
    votes=await service.positionVotes(c,'event1');
    assert.equal(votes.total,3); assert.equal(votes.mine,'posA');
    assert.deepEqual(votes.positions,[{position_id:'posA',votes:3}]);
    await service.votePosition(c,'event1',null);
    votes=await service.positionVotes(c,'event1');
    assert.equal(votes.total,2); assert.equal(votes.mine,null);
    // Only a published posture of that same published event can be voted.
    await assert.rejects(service.votePosition(a,'event1','posOther'));
    await assert.rejects(service.votePosition(a,'event1','posInternal'));
    await assert.rejects(service.votePosition(a,'draft','posA'));
    assert.equal((await service.positionVotes(a,'event2')).total,0);
  } finally { if(database) await database.destroy(); await pg.close(); }
});

test('the three channels persist with author alias and shared usefulness counts', async () => {
  const { SocialService } = await import('../dist/public-api/social.service.js');
  const pg=new PGlite(); let database;
  try {
    await pg.exec(baseSchema); await pg.exec(socialCommunitySql); await pg.exec(socialArenaSql);
    await pg.exec('set role dialektik_core_app');
    const built=await serviceOn(pg); database=built.database; const service=built.service;
    // A contribution written through the earlier endpoint stays listed.
    await new SocialService({database}).comment(a,'event1','article1','Aporte anterior');
    await service.addEntry(a,'event1',{channel:'DEBATE',body:'Creo que falta contexto',alias:null,articleId:null,linkUrl:null});
    await service.addEntry(b,'event1',{channel:'APORTE',body:'Documento oficial',alias:'Ana P.',articleId:null,linkUrl:'https://example.cl/doc.pdf'});
    await service.addEntry(b,'event1',{channel:'NOTA',body:'La cifra es de 2025',alias:null,articleId:'article1',linkUrl:null});
    // Evidence from another event and unpublished events are refused.
    await assert.rejects(service.addEntry(a,'event1',{channel:'NOTA',body:'x',alias:null,articleId:'article2',linkUrl:null}));
    await assert.rejects(service.addEntry(a,'draft',{channel:'DEBATE',body:'x',alias:null,articleId:null,linkUrl:null}));

    let entries=(await service.community(a,'event1')).entries;
    assert.deepEqual(entries.map(e=>e.channel).sort(),['aporte','aporte','debate','nota']);
    const debate=entries.find(e=>e.channel==='debate');
    assert.match(debate.author,/^Lector-[0-9A-F]{4}$/); assert.equal(debate.mine,true); assert.equal(debate.url,null);
    const aporte=entries.find(e=>e.body==='Documento oficial');
    assert.equal(aporte.author,'Ana P.'); assert.equal(aporte.url,'https://example.cl/doc.pdf'); assert.equal(aporte.mine,false);
    const nota=entries.find(e=>e.channel==='nota');
    assert.equal(nota.url,'https://example.cl/a'); assert.equal(nota.article_id,'article1');
    const legacy=entries.find(e=>e.body==='Aporte anterior');
    assert.equal(legacy.channel,'aporte'); assert.match(legacy.author,/^Lector-[0-9A-F]{4}$/);
    // The same account always shows the same derived alias.
    assert.equal(legacy.author,debate.author);
    assert.equal(entries.some(e=>'user_id' in e),false);

    assert.equal(await service.voteEntry(a,aporte.id,1),'event1');
    await service.voteEntry(b,aporte.id,1);
    await service.voteEntry(c,aporte.id,-1);
    await service.voteEntry(c,legacy.id,1);
    entries=(await service.community(c,'event1')).entries;
    const voted=entries.find(e=>e.id===aporte.id);
    assert.equal(voted.upvotes,2); assert.equal(voted.downvotes,1); assert.equal(voted.my_vote,-1);
    assert.equal(entries.find(e=>e.id===legacy.id).upvotes,1);
    // Voting again replaces the reader's vote; null withdraws it.
    await service.voteEntry(c,aporte.id,1);
    await service.voteEntry(a,aporte.id,null);
    const again=(await service.community(a,'event1')).entries.find(e=>e.id===aporte.id);
    assert.equal(again.upvotes,2); assert.equal(again.downvotes,0); assert.equal(again.my_vote,null);
    await assert.rejects(service.voteEntry(a,'99999999-9999-4999-8999-999999999999',1));
    assert.equal((await service.community(a,'event2')).entries.length,0);
  } finally { if(database) await database.destroy(); await pg.close(); }
});

test('before migration 085 the new endpoints answer 503 and earlier ones keep working', async () => {
  const { SocialService } = await import('../dist/public-api/social.service.js');
  const pg=new PGlite(); let database;
  try {
    await pg.exec(baseSchema); await pg.exec(socialCommunitySql);
    await pg.exec('set role dialektik_core_app');
    const built=await serviceOn(pg); database=built.database; const service=built.service;
    for (const call of [()=>service.positionVotes(a,'event1'),()=>service.votePosition(a,'event1','posA'),
      ()=>service.community(a,'event1'),()=>service.voteEntry(a,'99999999-9999-4999-8999-999999999999',1),
      ()=>service.addEntry(a,'event1',{channel:'DEBATE',body:'x',alias:null,articleId:null,linkUrl:null})]) {
      await assert.rejects(call(),error=>error.getStatus?.()===503);
    }
    const legacy=new SocialService({database});
    await legacy.react(a,'event1','SOLID');
    assert.equal((await legacy.summary(a,'event1')).solid,1);
  } finally { if(database) await database.destroy(); await pg.close(); }
});
