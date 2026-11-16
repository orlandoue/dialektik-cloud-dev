import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';

import { LiveRepository } from '../dist/live/live.repository.js';
import { publisherMarketsStatus } from '../dist/live/live.publisher-market.js';
import { PublicApiRepository } from '../dist/public-api/public-api.repository.js';
import { parsePublicCountry, setSourceProfilesAvailable } from '../dist/public-api/source-profiles.js';

function fakeDatabase(rows = []) {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(command, parameters) {
          queries.push(typeof command === 'string' ? { text: command, values: parameters ?? [] } : { text: command.text, values: command.values ?? [] });
          return { rows };
        },
        release() {},
      };
    },
    async end() {},
  };
  return { database: new Kysely({ dialect: new PostgresDialect({ pool }) }), queries };
}

test('country parameter: CL by default, only the four catalog countries', () => {
  assert.equal(parsePublicCountry(undefined), 'CL');
  for (const code of ['CL', 'ES', 'AR', 'US']) assert.equal(parsePublicCountry(code), code);
  for (const bad of ['UK', 'es', 'CL,ES', '', null]) assert.throws(() => parsePublicCountry(bad));
  const status = publisherMarketsStatus();
  for (const code of ['ES', 'AR', 'US']) {
    assert.equal(status.markets.find((item) => item.country_code === code).coverage_state, 'BETA_AUTHORIZED_SOURCES_ONLY');
  }
});

test('before migration 087 only Chile answers, with the original domain filter', async () => {
  setSourceProfilesAvailable(false);
  const { database, queries } = fakeDatabase();
  try {
    const live = new LiveRepository(database);
    assert.deepEqual(await live.list({ limit: 5, market: 'ES' }), []);
    assert.equal(queries.length, 0, 'no profiles: Spain is empty without touching PostgreSQL');
    const repo = new PublicApiRepository({ database });
    assert.equal(await repo.listMediaGroups('AR'), null);
    await repo.listFeed({ cursor: null, limit: 5, country: 'ES' });
    assert.match(queries.at(-1).text, /and false/u);
  } finally {
    await database.destroy();
  }
});

test('with profiles, the catalog country scopes live news, sources, feed and contrasts', async () => {
  setSourceProfilesAvailable(true);
  const { database, queries } = fakeDatabase();
  try {
    const live = new LiveRepository(database);
    await live.list({ limit: 5, market: 'US' });
    await live.sources(undefined, 'CL');
    const [news, sources] = queries;
    assert.match(news.text, /market_profile\.country_code = \$\d+/u);
    assert.ok(news.values.includes('US'));
    assert.match(news.text, /media_group_slug/u);
    // Columns must be qualified: inside the profile subqueries an unqualified
    // source_id is the profile table's own column (SQLSTATE 21000 in production).
    assert.match(news.text, /market_profile\.source_id = news\.source_id/u);
    assert.match(news.text, /where source_id = news\.source_id/u);
    assert.doesNotMatch(news.text, /market_profile\.source_id = source_id\b/u);
    // Chilean sources without a profile keep their domain mapping.
    assert.match(sources.text, /not exists\(select 1 from media_source_profiles market_profile/u);
    assert.ok(sources.values.includes('biobiochile.cl'));

    const repo = new PublicApiRepository({ database });
    await repo.listFeed({ cursor: null, limit: 5, country: 'ES' });
    assert.match(queries.at(-1).text, /media_source_profiles country_profile/u);
    assert.ok(queries.at(-1).values.includes('ES'));
    await repo.listContradictions({ cursor: null, limit: 5, country: 'AR' });
    assert.ok(queries.at(-1).values.includes('AR'));
    // One event's own contrasts are listed whatever the selected country.
    await repo.listContradictions({ cursor: null, limit: 5, eventId: '01M5MC0000000000000000TEST', country: 'AR' });
    assert.ok(!queries.at(-1).values.includes('AR'));
    await repo.listMediaGroups('US');
    assert.match(queries.at(-1).text, /group by profile\.media_group_slug/u);
  } finally {
    setSourceProfilesAvailable(false);
    await database.destroy();
  }
});
