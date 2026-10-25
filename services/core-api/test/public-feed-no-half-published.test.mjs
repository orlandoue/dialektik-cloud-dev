import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';

import { PublicApiRepository } from '../dist/public-api/public-api.repository.js';
import { PublicApiService } from '../dist/public-api/public-api.service.js';

test('feed excludes invalid published Events before pagination and projection', async () => {
  const statements = [];
  const fakePool = {
    async connect() {
      return {
        async query(command) {
          statements.push(typeof command === 'string' ? command : command.text);
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  const database = new Kysely({ dialect: new PostgresDialect({ pool: fakePool }) });
  try {
    const repository = new PublicApiRepository({ database });
    const rows = await repository.listFeed({ cursor: null, limit: 1 });
    assert.deepEqual(rows, []);
    assert.equal(statements.length, 1);
    const sql = statements[0].replace(/\s+/g, ' ').toLowerCase();
    assert.match(sql, /event_row\.analysis_state = 'analysis_pending'/);
    assert.match(sql, /event_row\.analysis_state = 'published'/);
    assert.match(sql, /and exists \( select 1 from positions integrity_position/);
    assert.match(sql, /integrity_position\.publication_state = 'published'/);
    assert.match(sql, /integrity_position\.status = 'active'/);
    assert.ok(sql.indexOf('and exists ( select 1 from positions integrity_position') < sql.indexOf('order by'));
    assert.ok(sql.indexOf('order by') < sql.indexOf('limit'));
  } finally {
    await database.destroy();
  }
});

test('broken published Event still fails closed if erroneously returned by repository', async () => {
  const fakeRepository = {
    async listFeed() {
      return [{
        id: '01M4YDQK00NMT7J1EESGF3M8N1',
        title_descriptive: 'broken publication',
        category: 'society',
        detected_at: new Date('2026-10-25T04:33:27.822Z'),
        analysis_state: 'PUBLISHED',
        source_count: 0,
        position_count: 0,
        representation_updated_at: new Date('2026-10-25T04:33:27.822Z'),
      }];
    },
  };
  const service = new PublicApiService(fakeRepository);
  await assert.rejects(
    service.feed({ page: { cursor: null, filterFingerprint: 'test', limit: 1 } }),
    /Published Event has no published Position/
  );
});

test('zero authorized renderable Events returns a valid empty page', async () => {
  const service = new PublicApiService({ async listFeed() { return []; } });
  const result = await service.feed({
    page: { cursor: null, filterFingerprint: 'test', limit: 1 },
  });
  assert.deepEqual(result.body, { items: [], next_cursor: null });
  assert.equal(result.lastModified.toISOString(), '1970-01-01T00:00:00.000Z');
});
