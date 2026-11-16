import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';

import { LiveRepository } from '../dist/live/live.repository.js';

function scriptedDatabase(answers) {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(command, parameters) {
          queries.push({ text: typeof command === 'string' ? command : command.text, values: parameters ?? command.values ?? [] });
          return { rows: answers[queries.length - 1] ?? [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  return { database: new Kysely({ dialect: new PostgresDialect({ pool }) }), queries };
}

test('the projection runs only over a bounded, materialized window of the newest candidates', async () => {
  const { database, queries } = scriptedDatabase([[{ id: null, candidate_count: 3 }]]);
  try {
    assert.deepEqual(await new LiveRepository(database).list({ limit: 25, market: 'CL' }), []);
    assert.equal(queries.length, 1, 'fewer candidates than the window: no retry');
    const { text, values } = queries[0];
    assert.match(text, /^with candidates as materialized \(/u);
    assert.match(text, /order by v\.published_at desc, a\.id desc limit \$\d+\),\s+news as/u);
    assert.ok(values.includes(104), 'window = 4 × (limit + 1)');
    assert.match(text, /where a\.origin = 'LIVE_REAL' and a\.id in \(select candidates\.id from candidates\)/u);
  } finally {
    await database.destroy();
  }
});

test('a short page with a full window widens the window until candidates run out', async () => {
  const row = (id) => ({ id, candidate_count: 104 });
  const { database, queries } = scriptedDatabase([
    [row('A'), row('B')],
    [{ id: 'A', candidate_count: 300 }, { id: 'B', candidate_count: 300 }, { id: 'C', candidate_count: 300 }],
  ]);
  try {
    const rows = await new LiveRepository(database).list({ limit: 25, market: 'CL' });
    assert.equal(queries.length, 2);
    assert.ok(queries[1].values.includes(416));
    assert.deepEqual(rows.map((item) => item.id), ['A', 'B', 'C']);
    assert.ok(rows.every((item) => !('candidate_count' in item)));
  } finally {
    await database.destroy();
  }
});
