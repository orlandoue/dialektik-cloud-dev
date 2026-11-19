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
    assert.match(text, /^with approved_sources as materialized \(/u);
    assert.match(text, /candidates as materialized \(\s+select a\.id from recent v/u);
    assert.match(text, /exists \(select 1 from approved_sources where approved_sources\.source_id = a\.source_id\)/u);
    assert.match(text, /order by v\.published_at desc, v\.article_id desc limit \$\d+\),\s+news as/u);
    assert.ok(values.includes(104), 'window = 4 × (limit + 1)');
    assert.match(text, /where a\.origin = 'LIVE_REAL' and a\.id in \(select candidates\.id from candidates\)/u);
  } finally {
    await database.destroy();
  }
});

test('a short page with a full window widens the window until candidates run out', async () => {
  const row = (id) => ({ id, candidate_count: 104, scanned_count: 1664 });
  const { database, queries } = scriptedDatabase([
    [row('A'), row('B')],
    [{ id: 'A', candidate_count: 300 }, { id: 'B', candidate_count: 300 }, { id: 'C', candidate_count: 300 }],
  ]);
  try {
    const rows = await new LiveRepository(database).list({ limit: 25, market: 'CL' });
    assert.equal(queries.length, 2);
    assert.ok(queries[1].values.includes(416));
    assert.match(queries[1].text, /candidates as materialized \(\s+select a\.id from articles a/u);
    assert.deepEqual(rows.map((item) => item.id), ['A', 'B', 'C']);
    assert.ok(rows.every((item) => !('candidate_count' in item)));
  } finally {
    await database.destroy();
  }
});

test('the candidates come from a bounded walk of the newest versions', async () => {
  const { database, queries } = scriptedDatabase([[{ id: null, candidate_count: 3, scanned_count: 40 }]]);
  try {
    await new LiveRepository(database).list({ limit: 25, market: 'CL', format: 'videos' });
    const { text, values } = queries[0];
    assert.match(text, /recent as materialized \(\s+select v\.article_id, v\.version_number, v\.published_at, v\.headline, v\.excerpt from live_article_versions v/u);
    assert.match(text, /order by v\.published_at desc, v\.article_id desc limit \$\d+\),[^]*?candidates as materialized \(\s+select a\.id from recent v/u);
    assert.ok(values.includes(104 * 16), 'scan = 16 versions per candidate wanted');
    assert.match(text, /\(select count\(\*\)::int from recent\) as scanned_count/u);
  } finally {
    await database.destroy();
  }
});

test('a short page from a full walk falls back to the full read', async () => {
  const { database, queries } = scriptedDatabase([
    // 10 candidates (< window) but the walk of 1664 versions was full: older
    // versions may still hold candidates, so it must look further.
    [{ id: 'A', candidate_count: 10, scanned_count: 1664 }],
    [{ id: 'A', candidate_count: 30, scanned_count: 2000 }, { id: 'B', candidate_count: 30, scanned_count: 2000 }],
  ]);
  try {
    const rows = await new LiveRepository(database).list({ limit: 25, market: 'CL', format: 'videos' });
    assert.equal(queries.length, 2);
    // The second round reads every article (no second, wider walk).
    assert.match(queries[1].text, /candidates as materialized \(\s+select a\.id from articles a/u);
    assert.ok(queries[1].values.includes(104), 'same window, full read');
    assert.deepEqual(rows.map((item) => item.id), ['A', 'B']);
    assert.ok(rows.every((item) => !('scanned_count' in item)));
  } finally {
    await database.destroy();
  }
});

test('searches and single-source pages read every article at once, without a bounded walk', async () => {
  const { database, queries } = scriptedDatabase([[{ id: null, candidate_count: 0, scanned_count: 0 }]]);
  try {
    await new LiveRepository(database).list({ limit: 10, market: 'CL', q: 'boric' });
    assert.equal(queries.length, 1, 'no extra rounds');
    assert.match(queries[0].text, /recent as materialized \(select null::text as article_id where false\)/u);
    assert.match(queries[0].text, /candidates as materialized \(\s+select a\.id from articles a/u);
  } finally {
    await database.destroy();
  }
});
