// Stories (migration 102) against a real PostgreSQL server, connected as
// dialektik_core_app: Core proposes, only a moderator approves or rejects,
// and approved stories list their events and outlets.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { storyGroupsSql } from '../../../packages/database/dist/migration/102_story_groups.js';

const ownerUrl = process.env.SCIENCE_TEST_DATABASE_URL;
if (!ownerUrl && process.env.CI) throw new Error('CI must provide SCIENCE_TEST_DATABASE_URL.');
const skip = ownerUrl ? false : 'SCIENCE_TEST_DATABASE_URL is not set';
const moderator = '44444444-4444-4444-8444-444444444444';
const reader = '11111111-1111-4111-8111-111111111111';
const password = `core-${randomBytes(8).toString('hex')}`;
const database = `stories_${randomBytes(4).toString('hex')}`;
let admin;
let owner;
let coreUrl;

before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  for (const role of ['anon', 'authenticated']) {
    await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    create role dialektik_core_app login; end if; end $$`);
  await admin.query(`alter role dialektik_core_app login nosuperuser nobypassrls password '${password}'`);
  await admin.query(`create database ${database}`);
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  await owner.query(`create domain dialektik_ulid as text;
    create table public.sources(id dialektik_ulid primary key, name text not null);
    create table public.public_events(id dialektik_ulid primary key, title_descriptive text not null,
      analysis_state text not null, detected_at timestamptz not null default now(), merged_into dialektik_ulid);
    create table public.articles(id dialektik_ulid primary key, event_id dialektik_ulid, source_id dialektik_ulid,
      origin text not null, published_at timestamptz not null);
    create table public.live_article_versions(article_id dialektik_ulid, version_number int, headline text, published_at timestamptz);
    grant select on public.sources, public.public_events, public.articles, public.live_article_versions to dialektik_core_app;
    insert into public.sources values ('S1','Cooperativa.cl'),('S2','Meganoticias'),('S3','La Tercera'),('S4','CHV');
    insert into public.public_events(id, title_descriptive, analysis_state) values
      ('E1','Presidente Kast inicia viaje a Asia','PUBLISHED'),
      ('E2','Gira por Asia de Presidente Kast en Vietnam','PUBLISHED'),
      ('E3','Incendio en Maipú','PUBLISHED');
    insert into public.articles values
      ('A1','E1','S1','LIVE_REAL', now() - interval '30 hours'),('A2','E1','S2','LIVE_REAL', now() - interval '29 hours'),
      ('A3','E2','S3','LIVE_REAL', now() - interval '20 hours'),('A4','E2','S2','LIVE_REAL', now() - interval '19 hours'),
      ('A5','E3','S4','LIVE_REAL', now() - interval '10 hours'),('A6','E3','S1','LIVE_REAL', now() - interval '9 hours');
    insert into public.live_article_versions select id, 1, h, published_at from (values
      ('A1','Presidente Kast inició viaje a Asia: Su primera parada es Vietnam'),
      ('A2','Presidente Kast inicia gira oficial por Asia: las claves y agenda de la visita oficial'),
      ('A3','Presidente Kast inicia gira por Asia en Vietnam con foco en comercio'),
      ('A4','Con foco en las relaciones comerciales: Presidente Kast da inicio a su gira por Asia en Vietnam'),
      ('A5','Incendio en Maipú deja una persona fallecida'),('A6','Incendio en Maipú deja un fallecido')) h(aid, h)
      join public.articles a on a.id = h.aid;`);
  await owner.query(storyGroupsSql);
  await owner.query(storyGroupsSql); // idempotent
  url.username = 'dialektik_core_app';
  url.password = password;
  coreUrl = url.toString();
});

after(async () => {
  if (skip) return;
  await owner?.end();
  await admin?.query(`drop database if exists ${database} with (force)`);
  await admin?.end();
});

test('Core proposes; only a moderator approves, with a title; the story lists its outlets', { skip }, async () => {
  const { Kysely, PostgresDialect, sql } = await import('kysely');
  const { StoryGroupsService } = await import('../dist/stories/story-groups.service.js');
  const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: coreUrl, max: 2 }) }) });
  const service = new StoryGroupsService({ database: db }, { isModerator: (id) => id === moderator });
  try {
    assert.equal(await service.propose(), 1);
    assert.equal(await service.propose(), 1, 'a second run refreshes the same proposal');
    assert.equal((await owner.query('select count(*)::int as n from public.story_group_proposals')).rows[0].n, 1);

    await assert.rejects(service.proposals(reader), { status: 403 });
    const { proposals } = await service.proposals(moderator);
    assert.equal(proposals.length, 1);
    assert.deepEqual(proposals[0].events.map((e) => e.id), ['E1', 'E2']);
    assert.deepEqual(proposals[0].events[0].outlets.sort(), ['Cooperativa.cl', 'Meganoticias']);

    await assert.rejects(service.decide(reader, proposals[0].id, true, 'Gira de Kast'), { status: 403 });
    const { group_id } = await service.decide(moderator, proposals[0].id, true, 'Gira de Kast por Asia');
    assert.ok(group_id);
    const stories = await service.stories();
    assert.equal(stories.length, 1);
    assert.equal(stories[0].title, 'Gira de Kast por Asia');
    assert.deepEqual(stories[0].event_ids.sort(), ['E1', 'E2']);
    assert.equal(stories[0].source_count, 3);
    // Decided: no longer open, and its events are never proposed again.
    assert.equal((await service.proposals(moderator)).proposals.length, 0);
    assert.equal(await service.propose(), 0);
  } finally {
    await db.destroy();
  }
});

test('without the moderator flag Core cannot create or decide stories', { skip }, async () => {
  const core = new pg.Client({ connectionString: coreUrl });
  await core.connect();
  try {
    await assert.rejects(core.query(`insert into public.story_groups(title, decided_by) values ('Intento', '${reader}')`), { code: '42501' });
    const updated = await core.query(`update public.story_group_proposals set status = 'approved', decided_at = now() returning id`);
    assert.equal(updated.rowCount, 0);
    await assert.rejects(core.query(`insert into public.story_group_proposals(signature, event_ids, suggested_title, status, decided_at)
      values ('${'a'.repeat(32)}', '{E3}', 'x', 'approved', now())`), { code: '42501' });
    const grants = await owner.query(`select has_table_privilege('anon', 'public.story_groups', 'select') as anon`);
    assert.equal(grants.rows[0].anon, false);
  } finally {
    await core.end();
  }
});

test('a rejected proposal is not proposed again', { skip }, async () => {
  const { Kysely, PostgresDialect } = await import('kysely');
  const { StoryGroupsService } = await import('../dist/stories/story-groups.service.js');
  await owner.query(`insert into public.public_events(id, title_descriptive, analysis_state) values
    ('E4','Agresión a Luis Slimming en Arica','PUBLISHED'),('E5','Agresión a Luis Slimming en show en Arica','PUBLISHED');
    insert into public.articles values ('A7','E4','S1','LIVE_REAL', now() - interval '5 hours'),('A8','E4','S3','LIVE_REAL', now() - interval '5 hours'),
      ('A9','E5','S1','LIVE_REAL', now() - interval '4 hours'),('A10','E5','S3','LIVE_REAL', now() - interval '4 hours');
    insert into public.live_article_versions select id, 1, 'Luis Slimming fue agredido en el escenario durante show en Arica', published_at
      from public.articles where id in ('A7','A8','A9','A10');`);
  const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: coreUrl, max: 2 }) }) });
  const service = new StoryGroupsService({ database: db }, { isModerator: (id) => id === moderator });
  try {
    assert.equal(await service.propose(), 1);
    const [proposal] = (await service.proposals(moderator)).proposals;
    await service.decide(moderator, proposal.id, false, null);
    assert.equal(await service.propose(), 0);
  } finally {
    await db.destroy();
  }
});
