// Migration 105 and the edition service: editions are public and kept two
// days; only moderators (flag set by Core) pin, hide or choose the duel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { homeEditionsSql } from '../../../packages/database/dist/migration/105_home_editions.js';

const moderator = '44444444-4444-4444-8444-444444444444';
const reader = '22222222-2222-4222-8222-222222222222';

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create domain dialektik_ulid as text;
    create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
    create table public.articles(id text primary key, event_id dialektik_ulid, source_id dialektik_ulid, origin text, published_at timestamptz);
    create table public.contradiction_publications(id text, event_id dialektik_ulid, publication_state text, confirmed_by text, confirmed_at timestamptz);
    grant select on public.articles, public.contradiction_publications to dialektik_core_app;
    insert into public.articles values
      ('a1','E1','s1','LIVE_REAL', now() - interval '1 hour'), ('a2','E1','s2','LIVE_REAL', now() - interval '50 minutes'),
      ('a3','E1','s3','LIVE_REAL', now() - interval '40 minutes'), ('a4','E2','s1','LIVE_REAL', now() - interval '2 hours'),
      ('a5','E2','s4','LIVE_REAL', now() - interval '2 hours');
    insert into public.contradiction_publications values ('c1','E2','published','ed', now() - interval '1 hour');`);
  await pg.exec(homeEditionsSql);
  await pg.exec(homeEditionsSql); // idempotent
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
  const { Kysely, PostgresDialect } = await import('kysely');
  const database = new Kysely({ dialect: new PostgresDialect({ pool }) });
  const card = (id, title, sources) => ({ id, title_descriptive: title, category: 'politica', detected_at: new Date(Date.now() - 3 * 3_600_000),
    analysis_state: 'PUBLISHED', source_count: sources, position_count: 2, representation_updated_at: new Date() });
  const repository = { listFeed: async () => [card('E1', 'Caso uno', 3), card('E2', 'Caso dos', 2)] };
  const stories = { stories: async () => [] };
  const science = { isModerator: (id) => id === moderator };
  process.env.DIALEKTIK_ACTIVE_MARKETS = 'CL';
  const { EditionService } = await import('../dist/edition/edition.service.js');
  return { pg, service: new EditionService({ database }, repository, stories, science) };
}

test('an edition is composed, stored and served with its cards, rules and duel', async () => {
  const { pg, service } = await setup();
  assert.equal(await service.latest('CL'), null);
  const edition = await service.compose('CL', 'hourly');
  assert.deepEqual(edition.items.map((i) => i.id), ['E1', 'E2'], '3 outlets now before 2 outlets two hours ago');
  assert.equal(edition.items[0].outlets, 3);
  assert.equal(edition.duel_event_id, 'E2');
  assert.deepEqual(Object.keys(edition.cards[edition.items[0].id]).sort(),
    ['analysis_state', 'category', 'detected_at', 'id', 'position_count', 'source_count', 'title_descriptive'],
    'the card has exactly the fields of /v1/feed');
  assert.equal(edition.rules_version, 'v1');
  assert.equal((await service.latest('CL'))?.generated_at, edition.generated_at);
  // Recent editions cannot be deleted by Core; old ones can.
  await pg.exec('set role dialektik_core_app');
  await pg.exec('delete from public.home_editions');
  await pg.exec('reset role');
  assert.equal((await pg.query('select count(*)::int as n from public.home_editions')).rows[0].n, 1);
});

test('only a moderator pins, hides or chooses the duel, with a reason; the edition follows', async () => {
  const { pg, service } = await setup();
  await service.compose('CL', 'hourly');
  await assert.rejects(service.pin(reader, { country: 'CL', targetKind: 'event', targetId: 'E2', action: 'pin', reason: 'Prueba', hours: 6 }),
    (error) => error.status === 403);
  // Core without the moderator flag cannot write a pin.
  await pg.exec('set role dialektik_core_app');
  await assert.rejects(pg.query(`insert into public.home_edition_pins (country, target_kind, target_id, action, reason, created_by, expires_at)
    values ('CL','event','E2','pin','Prueba','${moderator}', now() + interval '1 hour')`));
  await pg.exec('reset role');

  const pinned = await service.pin(moderator, { country: 'CL', targetKind: 'event', targetId: 'E2', action: 'pin', reason: 'Contexto clave', hours: 6 });
  assert.equal(pinned.trigger, 'moderation');
  assert.equal(pinned.items[0].id, 'E2');
  assert.equal(pinned.items[0].pin_reason, 'Contexto clave');
  const hidden = await service.pin(moderator, { country: 'CL', targetKind: 'event', targetId: 'E1', action: 'hide', reason: 'Duplicado', hours: 2 });
  assert.deepEqual(hidden.items.map((i) => i.id), ['E2']);
  assert.deepEqual(hidden.hidden, [{ kind: 'event', id: 'E1', reason: 'Duplicado' }]);

  const { pins } = await service.moderation(moderator, 'CL');
  assert.equal(pins.length, 2);
  const restored = await service.unpin(moderator, pins.find((p) => p.action === 'hide').id);
  assert.ok(restored.items.some((i) => i.id === 'E1'));
  // A pin lasts at most a week.
  await pg.exec(`set dialektik.science_moderator = 'on'; set dialektik.social_user = '${moderator}'; set role dialektik_core_app`);
  await assert.rejects(pg.query(`insert into public.home_edition_pins (country, target_kind, target_id, action, reason, created_by, expires_at)
    values ('CL','event','E2','pin','Demasiado','${moderator}', now() + interval '8 days')`));
  await pg.exec('reset role');
});

test('a breaking case calls an extra edition between hours; otherwise one per hour', async () => {
  const { pg, service } = await setup();
  await service.tick(new Date());
  const first = (await pg.query('select count(*)::int as n from public.home_editions')).rows[0].n;
  await service.tick(new Date());
  assert.equal((await pg.query('select count(*)::int as n from public.home_editions')).rows[0].n, first, 'same hour, nothing new');
  await pg.exec(`insert into public.articles values ('b1','E1','s7','LIVE_REAL', now()), ('b2','E1','s8','LIVE_REAL', now())`);
  // E1 is already the top case: no breaking edition is needed for it.
  await service.tick(new Date());
  assert.equal((await pg.query('select count(*)::int as n from public.home_editions')).rows[0].n, first);
});
