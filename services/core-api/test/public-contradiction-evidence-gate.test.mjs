import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { PublicApiRepository } from '../dist/public-api/public-api.repository.js';
import { PublicApiService } from '../dist/public-api/public-api.service.js';

test('unsubstantiated publications cannot appear in contradictions list', async () => {
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
    const repository = new PublicApiRepository({ database });
    assert.deepEqual(await repository.listContradictions({ cursor: null, limit: 10 }), []);
    assert.equal(queries.length, 1);
    const statement = queries[0].replace(/\s+/g, ' ').toLowerCase();
    assert.match(statement, /position_a\.publication_state = 'published'/);
    assert.match(statement, /position_b\.publication_state = 'published'/);
    assert.match(statement, /position_a\.event_id = event_row\.id/);
    assert.match(statement, /position_b\.event_id = event_row\.id/);
    assert.match(statement, /position_a\.id <> position_b\.id/);
    assert.match(statement, /event_row\.analysis_state = 'published'/);
    assert.match(statement, /publication\.confirmed_by is not null/);
    assert.match(statement, /publication\.confirmed_at is not null/);
    assert.match(statement, /grounded_article\.origin = 'live_real'/);
    assert.match(statement, /formed_relation\.rel_type = 'r01a'/);
    assert.match(statement, /formed_relation\.confirmed_at is not null/);
    assert.match(statement, /approved_evidence\.publication_state = 'published'/);
    assert.match(statement, /approved_evidence\.approved_at is not null/);
    assert.match(statement, /formation\.position_id = position_a\.id/);
    assert.match(statement, /formation\.position_id = position_b\.id/);
    assert.match(statement, /assertion_row\.position_id = position_a\.id/);
    assert.match(statement, /assertion_row\.position_id = position_b\.id/);
    assert.match(statement, /join relationships relationship_row/);
    assert.match(statement, /join claim_spans claim/);
    assert.ok(statement.indexOf('assertion_row.position_id = position_b.id') < statement.indexOf('order by publication.confirmed_at'));
  } finally {
    await database.destroy();
  }
});

test('no credible contradiction evidence means zero published contradictions', async () => {
  const svc = new PublicApiService({ async listContradictions() { return []; } });
  const page = await svc.contradictions({ cursor: null, filterFingerprint: 'test', limit: 1 });
  assert.deepEqual(page.body, { items: [], next_cursor: null });
});
