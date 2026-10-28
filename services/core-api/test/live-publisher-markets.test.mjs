import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';

import { LiveRepository } from '../dist/live/live.repository.js';
import { parsePublisherMarket, publisherMarketsStatus, publisherDomainsForMarket } from '../dist/live/live.publisher-market.js';

function fakeDatabase() {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(command, parameters) {
          queries.push(typeof command === 'string'
            ? { text: command, values: parameters ?? [] }
            : { text: command.text, values: command.values ?? [] });
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  return { database: new Kysely({ dialect: new PostgresDialect({ pool }) }), queries };
}

test('market selection is strictly validated and defaults to Chile', () => {
  assert.equal(parsePublisherMarket(undefined), 'CL');
  assert.equal(parsePublisherMarket('PE'), 'PE');
  assert.equal(parsePublisherMarket('ES'), 'ES');
  assert.equal(parsePublisherMarket('UK'), 'UK');
  for (const malformed of ['ZZ', 'cl', 'CL,PE', '', null, ['PE'], {}]) {
    assert.throws(() => parsePublisherMarket(malformed));
  }
  assert.deepEqual(publisherDomainsForMarket('PE'), []);
  assert.equal(publisherDomainsForMarket('CL').includes('gov.uk'), false);
  assert.deepEqual(publisherDomainsForMarket('UK'), ['gov.uk']);
  const status = publisherMarketsStatus();
  assert.equal(status.default_country, 'CL');
  assert.equal(status.markets.find((item) => item.country_code === 'PE').coverage_state, 'NOT_AVAILABLE');
});

test('Chile news and sources are filtered on SQL server before pagination', async () => {
  const { database, queries } = fakeDatabase();
  try {
    const repo = new LiveRepository(database);
    assert.deepEqual(await repo.list({ limit: 1, market: 'CL' }), []);
    assert.deepEqual(await repo.sources(undefined, 'CL'), []);
    assert.equal(queries.length, 2);
    for (const { text, values } of queries) {
      assert.match(text.toLowerCase(), /canonical_domain in \(/);
      assert.ok(values.includes('biobiochile.cl'));
      assert.ok(values.includes('gob.cl'));
      assert.ok(values.includes('diarioeldia.cl'));
      assert.ok(values.includes('www.diarioeldia.cl'));
      assert.ok(!values.includes('gov.uk'), 'no UK domain may appear in Chile scope');
    }
    const news = queries[0].text.toLowerCase();
    assert.match(news, /select a\.id, a\.event_id,/);
    assert.doesNotMatch(news, /a\.event_id\s+is\s+null/);
    assert.match(news, /a\.origin\s*=\s*'live_real'/);
    assert.match(news, /jsonb_typeof\(q\.policy->'quarantinedarticleids'\)\s*=\s*'array'/);
    assert.match(news, /not \(q\.policy->'quarantinedarticleids' @> jsonb_build_array\(a\.id::text\)\)/);
    assert.match(news, /order by q\.recorded_at desc, q\.id desc limit 1/);
    assert.ok(news.indexOf('canonical_domain in (') < news.indexOf('order by published_at'));
    assert.ok(news.indexOf('order by published_at') < news.lastIndexOf('limit '));
  } finally {
    await database.destroy();
  }
});

test('unlicensed new markets are empty without touching PostgreSQL', async () => {
  const { database, queries } = fakeDatabase();
  try {
    const repo = new LiveRepository(database);
    assert.deepEqual(await repo.list({ limit: 25, market: 'PE' }), []);
    assert.deepEqual(await repo.sources(undefined, 'ES'), []);
    assert.equal(await repo.article('01M4YDQK00WS344WW8RCPCEQHE', 'PE'), undefined);
    assert.equal(queries.length, 0);
  } finally {
    await database.destroy();
  }
});

test('UK preview scopes every query to the two selected GOV.UK sources', async () => {
  const { database, queries } = fakeDatabase();
  try {
    const repo = new LiveRepository(database);
    await repo.list({ limit: 25, market: 'UK' });
    await repo.article('01M4YDQK00WS344WW8RCPCEQHE', 'UK');
    await repo.sources(undefined, 'UK');
    await repo.registeredSources('UK');
    assert.equal(queries.length, 4);
    for (const { text, values } of queries) {
      assert.ok(values.includes('gov.uk'));
      assert.ok(values.includes('01M4YDQK00WS344WW8RCPCEQHE'));
      assert.ok(values.includes('01M4YDQK00WS344WW8RCPCEQHF'));
      assert.match(text, /(?:"source_id"|"s"\."id") in \(/);
    }
  } finally {
    await database.destroy();
  }
});

test('article detail and source detail obey Chile publisher scope', async () => {
  const { database, queries } = fakeDatabase();
  try {
    const repo = new LiveRepository(database);
    await repo.article('01M4YDQK00WS344WW8RCPCEQHE', 'CL');
    await repo.sources('01M4YDQK00WS344WW8RCPCEQHE', 'CL');
    assert.equal(queries.length, 2);
    assert.ok(queries.every(({ values }) => !values.includes('gov.uk')));
    assert.ok(queries.every(({ text }) => text.includes('canonical_domain in (')));
  } finally {
    await database.destroy();
  }
});
