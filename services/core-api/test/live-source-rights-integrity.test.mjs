import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { LiveRepository } from '../dist/live/live.repository.js';

test('live headline, detail, source APIs require reviewed independent rights evidence', async () => {
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
  const database = new Kysely({ dialect: new PostgresDialect({ pool }) });
  try {
    const live = new LiveRepository(database);
    await live.list({ limit: 1, market: 'CL' });
    await live.article('01M4YDQK00CH1000000000EM01', 'CL');
    await live.sources(undefined, 'CL');
    assert.equal(queries.length, 3);
    for (const text of queries) {
      const sql = text.replace(/\s+/g, ' ').toLowerCase();
      assert.match(sql, /p\.policy->>'rightsreviewstatus' = 'approved'/);
      assert.match(sql, /p\.policy->>'authorizationreference'/);
      assert.match(sql, /p\.policy->>'rightsevidenceurl'/);
      assert.match(sql, /p\.policy->>'endpoint'/);
      assert.match(sql, /p\.policy->>'rightsevidenceurl' <> 'https:\/\/supabase\.com'/);
      assert.match(sql, /p\.policy->>'endpoint' <> 'https:\/\/supabase\.com'/);
    }
  } finally {
    await database.destroy();
  }
});
