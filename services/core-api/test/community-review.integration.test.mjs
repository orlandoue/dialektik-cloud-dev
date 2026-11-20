// Migration 103: contributions state their version and sense, the first
// ones of an account wait for a moderator, a daily limit applies, and young
// accounts are left out of the public split.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { socialCommunitySql } from '../../../packages/database/dist/migration/083_social_community.js';
import { socialArenaSql } from '../../../packages/database/dist/migration/085_social_arena.js';
import { communityReviewSql } from '../../../packages/database/dist/migration/103_community_review.js';

const veteran = '11111111-1111-4111-8111-111111111111';
const reader = '22222222-2222-4222-8222-222222222222';
const newcomer = '33333333-3333-4333-8333-333333333333';
const moderator = '44444444-4444-4444-8444-444444444444';

const schema = `create schema auth; create table auth.users(id uuid primary key, created_at timestamptz not null);
  create domain dialektik_ulid as text;
  create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
  create table public.events(id dialektik_ulid primary key);
  create table public.public_events(id dialektik_ulid primary key, analysis_state text, title_descriptive text);
  create table public.positions(id dialektik_ulid primary key, event_id dialektik_ulid, publication_state text, title text);
  create table public.articles(id dialektik_ulid primary key, event_id dialektik_ulid, source_id dialektik_ulid, url_canonical text);
  insert into auth.users values ('${veteran}', now() - interval '30 days'), ('${reader}', now() - interval '30 days'),
    ('${newcomer}', now() - interval '2 hours'), ('${moderator}', now() - interval '90 days');
  insert into public.events values ('event1');
  insert into public.public_events values ('event1', 'PUBLISHED', 'Caso de prueba');
  insert into public.positions values ('posA', 'event1', 'published', 'Versión de un medio'), ('posB', 'event1', 'published', 'Otra');
  grant select on public.public_events, public.articles, public.positions to dialektik_core_app;`;

async function setup() {
  const pg = new PGlite();
  await pg.exec(schema);
  await pg.exec(socialCommunitySql);
  await pg.exec(socialArenaSql);
  await pg.exec(communityReviewSql);
  await pg.exec(communityReviewSql); // idempotent
  const { Kysely, PostgresDialect } = await import('kysely');
  const { SocialArenaService } = await import('../dist/public-api/social-arena.service.js');
  // Every statement runs as Core's role, so row security applies.
  const run = async (query, values) => {
    const text = typeof query === 'string' ? query : query.text;
    const params = values ?? query.values ?? [];
    await pg.exec('set role dialektik_core_app');
    try {
      if (params.length) return await pg.query(text, params);
      return (await pg.exec(text)).at(-1) ?? { rows: [] };
    } finally {
      await pg.exec('reset role');
    }
  };
  const pool = { async connect() { return { query: run, release() {} }; }, async end() {} };
  const database = new Kysely({ dialect: new PostgresDialect({ pool }) });
  const service = new SocialArenaService({ database }, { isModerator: (id) => id === moderator });
  return { pg, service };
}

const link = (n, extra = {}) => ({ channel: 'APORTE', body: `Documento ${n}`, alias: null, articleId: null,
  linkUrl: `https://example.cl/doc${n}.pdf`, positionId: 'posA', stance: 'supports', ...extra });

test('a first contribution waits for review, visible only to its author, with its version and sense', async () => {
  const { pg, service } = await setup();
  try {
    await service.addEntry(veteran, 'event1', link(1));
    const own = (await service.community(veteran, 'event1')).entries;
    assert.equal(own.length, 1);
    assert.deepEqual([own[0].status, own[0].position_id, own[0].stance], ['in_review', 'posA', 'supports']);
    assert.equal((await service.community(reader, 'event1')).entries.length, 0, 'others do not see it yet');
    // A debate opinion has no link and is published at once.
    await service.addEntry(veteran, 'event1', { channel: 'DEBATE', body: 'Opino', alias: null, articleId: null, linkUrl: null });
    assert.equal((await service.community(reader, 'event1')).entries.length, 1);

    await assert.rejects(service.reviewQueue(reader), { status: 403 });
    const [queued] = (await service.reviewQueue(moderator)).entries;
    assert.equal(queued.position_title, 'Versión de un medio');
    await service.reviewEntry(moderator, queued.id, true);
    assert.equal((await service.community(reader, 'event1')).entries.length, 2);
    // A position of another event is refused.
    await assert.rejects(service.addEntry(veteran, 'event1', link(2, { positionId: 'nope' })));
  } finally {
    await pg.close();
  }
});

test('three link contributions per day; a fourth is refused', async () => {
  const { pg, service } = await setup();
  try {
    for (const n of [1, 2, 3]) await service.addEntry(veteran, 'event1', link(n));
    await assert.rejects(service.addEntry(veteran, 'event1', link(4)), { status: 429 });
  } finally {
    await pg.close();
  }
});

test('an account younger than 72 h votes and sees its vote, but is not in the public split', async () => {
  const { pg, service } = await setup();
  try {
    await service.votePosition(veteran, 'event1', 'posA');
    await service.votePosition(newcomer, 'event1', 'posA');
    const publicView = await service.positionVotes(reader, 'event1');
    assert.equal(publicView.total, 1);
    const ownView = await service.positionVotes(newcomer, 'event1');
    assert.equal(ownView.mine, 'posA');
    assert.equal(ownView.total, 2, 'their own vote counts for themselves');
  } finally {
    await pg.close();
  }
});

test('without the moderator flag Core cannot publish a contribution in review', async () => {
  const { pg, service } = await setup();
  try {
    await service.addEntry(veteran, 'event1', link(1));
    await pg.exec('set role dialektik_core_app');
    const updated = await pg.query(`update public.social_community_entries set status = 'published' returning id`);
    await pg.exec('reset role');
    assert.equal(updated.rows.length, 0);
  } finally {
    await pg.close();
  }
});
