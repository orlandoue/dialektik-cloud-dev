import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { PublicApiRepository } from '../dist/public-api/public-api.repository.js';
import { PublicApiService } from '../dist/public-api/public-api.service.js';

function fakeDatabase() {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(command) {
          queries.push(typeof command === 'string' ? command : command.text);
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  return { queries, database: new Kysely({ dialect: new PostgresDialect({ pool }) }) };
}

test('feed AND direct Event details require linked real Articles and approved evidence', async () => {
  const { queries, database } = fakeDatabase();
  try {
    const repository = new PublicApiRepository({ database });
    await repository.listFeed({ cursor: null, limit: 10 });
    assert.equal(await repository.findEvent('01M4YDQK00NMT7J1EESGF3M8N1'), undefined);
    assert.equal(queries.length, 2);
    for (const text of queries) {
      const sql = text.replace(/\s+/g, ' ').toLowerCase();
      assert.match(sql, /grounded_article\.origin = 'live_real'/);
      assert.match(sql, /not exists \( select 1 from positions invalid_position/);
      assert.match(sql, /formed_relation\.rel_type = 'r01a'/);
      assert.match(sql, /formed_relation\.publication_state = 'published'/);
      assert.match(sql, /formed_relation\.confirmed_at is not null/);
      assert.match(sql, /grounded_assertion\.lifecycle_state = 'active'/);
      assert.match(sql, /grounded_span\.tombstone_id is null/);
      assert.match(sql, /grounded_source_article\.event_id = event_row\.id/);
      assert.match(sql, /approved_evidence\.publication_state = 'published'/);
      assert.match(sql, /approved_evidence\.approved_at is not null/);
    }
  } finally {
    await database.destroy();
  }
});

test('invalid published Event is 404, never an unsupported published analysis', async () => {
  const { database } = fakeDatabase();
  try {
    const repo = new PublicApiRepository({ database });
    const service = new PublicApiService(repo);
    await assert.rejects(service.event('01M4YDQK00NMT7J1EESGF3M8N1'), (error) => {
      assert.equal(error.status, 404);
      return true;
    });
  } finally {
    await database.destroy();
  }
});
