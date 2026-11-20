// Comment counts of the duel cards: published comments only, one query for
// every visible card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { socialCommunitySql } from '../../../packages/database/dist/migration/083_social_community.js';
import { socialArenaSql } from '../../../packages/database/dist/migration/085_social_arena.js';

const a = '11111111-1111-4111-8111-111111111111';

test('counts published comments per case, zero for a case without any', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create schema auth; create table auth.users(id uuid primary key); create domain dialektik_ulid as text;
      create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
      create table public.events(id dialektik_ulid primary key);
      create table public.public_events(id dialektik_ulid primary key, analysis_state text);
      create table public.positions(id dialektik_ulid primary key, event_id dialektik_ulid, publication_state text);
      create table public.articles(id dialektik_ulid primary key, event_id dialektik_ulid, source_id dialektik_ulid, url_canonical text);
      insert into auth.users values ('${a}'); insert into public.events values ('E1'), ('E2');
      insert into public.public_events values ('E1', 'PUBLISHED'), ('E2', 'PUBLISHED');`);
    await pg.exec(socialCommunitySql);
    await pg.exec(socialArenaSql);
    await pg.exec(`insert into public.social_community_entries(event_id, user_id, channel, author_alias, body)
      values ('E1', '${a}', 'DEBATE', 'Lector-1', 'Uno'), ('E1', '${a}', 'DEBATE', 'Lector-1', 'Dos');`);
    const { Kysely, PostgresDialect } = await import('kysely');
    const { SocialArenaService } = await import('../dist/public-api/social-arena.service.js');
    const run = async (query, values) => {
      const text = typeof query === 'string' ? query : query.text;
      const params = values ?? query.values ?? [];
      if (params.length) return pg.query(text, params);
      return (await pg.exec(text)).at(-1) ?? { rows: [] };
    };
    const database = new Kysely({ dialect: new PostgresDialect({ pool: { async connect() { return { query: run, release() {} }; }, async end() {} } }) });
    const service = new SocialArenaService({ database });
    assert.deepEqual(await service.commentCounts(['E1', 'E2']), { E1: 2, E2: 0 });
    assert.deepEqual(await service.commentCounts([]), {});
  } finally {
    await pg.close();
  }
});
