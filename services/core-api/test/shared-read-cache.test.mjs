// The 60 s shared cache of common reads (feed, duels, videos): it saves the
// database work and never carries anything personal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SharedReadCache } from '../dist/public-api/shared-read-cache.js';
import { PublicApiService } from '../dist/public-api/public-api.service.js';
import { LiveApplicationService } from '../dist/live/live.service.js';

const now = new Date('2026-11-18T12:00:00Z');
const page = { cursor: null, limit: 5, filterFingerprint: 'f' };
const card = (id, followedBy = []) => ({ id, title_descriptive: `Evento ${id}`, category: 'pais', detected_at: now,
  analysis_state: 'PUBLISHED', source_count: 2, position_count: 1, representation_updated_at: now, followedBy });

/** A repository that answers like the SQL: the match depends on the follows passed. */
function repository(calls) {
  const rows = [card('E1', ['S1']), card('E2', ['S2'])];
  const match = (row, follows) => follows !== undefined && row.followedBy.some((s) => follows.includes(s));
  return {
    async listFeed(input) {
      calls.push(input.followedSourceIds ?? null);
      return rows.map((row) => ({ ...row, is_followed_source_match: match(row, input.followedSourceIds) }));
    },
    async listContradictions(input) {
      calls.push(input.followedSourceIds ?? null);
      return rows.map((row, i) => ({ id: `C${i}`, event_id: row.id, event_title: row.title_descriptive, position_a_id: 'a',
        position_a_ordinal: 1, position_a_title: 'A', position_b_id: 'b', position_b_ordinal: 2, position_b_title: 'B',
        ratio_conflicting: 60, ratio_comparable: 70, threshold_rule: 'v1', confirmed_at: now, needs_review: false,
        is_followed_source_match: match(row, input.followedSourceIds) }));
    },
  };
}

test('one database read serves every common request for 60 s, including concurrent ones', async () => {
  let clock = 0;
  let loads = 0;
  const cache = new SharedReadCache(60_000, 10, () => clock);
  const load = async () => { loads += 1; return loads; };
  const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  clock = 59_999;
  assert.equal(await cache.get('k', load), 1);
  clock = 60_000;
  assert.equal(await cache.get('k', load), 2);
  // A failed read is not kept.
  await assert.rejects(cache.get('bad', async () => { throw new Error('db'); }));
  assert.equal(await cache.get('bad', async () => 'ok'), 'ok');
  // Bounded.
  for (let i = 0; i < 20; i++) await cache.get(`x${i}`, load);
  assert.ok(cache.size <= 11);
});

test('the common feed and duels are read once; personal pages always go to the database', async () => {
  const calls = [];
  const service = new PublicApiService(repository(calls));
  const first = await service.feed({ page });
  const second = await service.feed({ page });
  assert.equal(second, first);
  await service.contradictions(page);
  await service.contradictions(page);
  assert.deepEqual(calls, [null, null], 'one read for the feed and one for the duels');
  // Nothing personal in what the cache keeps.
  assert.ok(first.body.items.every((item) => !('is_followed_source_match' in item)));
});

test('two readers never see each other\'s follow state, before or after the cache is warm', async () => {
  const calls = [];
  const service = new PublicApiService(repository(calls));
  await service.feed({ page }); // warms the shared cache
  const ana = await service.feed({ page, followedSourceIds: ['S1'] });
  const ben = await service.feed({ page, followedSourceIds: ['S2'] });
  const flags = (result) => Object.fromEntries(result.body.items.map((item) => [item.id, item.is_followed_source_match]));
  assert.deepEqual(flags(ana), { E1: true, E2: false });
  assert.deepEqual(flags(ben), { E1: false, E2: true });
  // Asking again in the other order changes nothing: no state leaks through.
  assert.deepEqual(flags(await service.feed({ page, followedSourceIds: ['S2'] })), { E1: false, E2: true });
  assert.deepEqual(flags(await service.feed({ page, followedSourceIds: ['S1'] })), { E1: true, E2: false });
  const duels = async (follows) => Object.fromEntries((await service.contradictions(page, follows)).body.items
    .map((item) => [item.event_id, item.is_followed_source_match]));
  assert.deepEqual(await duels(['S1']), { E1: true, E2: false });
  assert.deepEqual(await duels(['S2']), { E1: false, E2: true });
  // The common page stays without any follow field.
  assert.ok((await service.feed({ page })).body.items.every((item) => !('is_followed_source_match' in item)));
  assert.equal(calls.filter((c) => c === null).length, 1, 'the common feed was read once');
});

test('videos: the common page is shared; a follow scope never is', async () => {
  const calls = [];
  const service = new LiveApplicationService({ async list(query) { calls.push(query.sourceScope ?? null); return []; } });
  await service.list({ limit: 6, market: 'CL', format: 'videos' });
  await service.list({ limit: 6, market: 'CL', format: 'videos' });
  await service.list({ limit: 6, market: 'CL', format: 'videos', sourceScope: 'following', followedSourceIds: ['S1'] });
  await service.list({ limit: 6, market: 'CL', format: 'videos', sourceScope: 'following', followedSourceIds: ['S2'] });
  assert.deepEqual(calls, [null, 'following', 'following']);
});
