import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCsv } from '../scripts/catalog-csv.mjs';
import { CATALOG_REPAIRS, catalogRepairsSql } from '../../../packages/database/dist/migration/089_catalog_repairs_and_citation_feeds.js';

const csv = parseCsv(readFileSync(new URL('../data/verified_multicountry_sources.csv', import.meta.url), 'utf8'));
const verification = JSON.parse(readFileSync(new URL('../data/verified_multicountry_sources.verification.json', import.meta.url), 'utf8'));
const statusOf = (slug, type) => verification.rows.find((row) => row.media_group_slug === slug && row.source_type === type)?.status;

test('every repair targets a catalog row that was not ingested', () => {
  assert.equal(CATALOG_REPAIRS.length, 18);
  for (const repair of CATALOG_REPAIRS) {
    assert.ok(csv.some((row) => row.media_group_slug === repair.slug && row.source_type === repair.type), repair.slug);
    assert.notEqual(statusOf(repair.slug, repair.type), 'ACTIVE', repair.slug);
    if (repair.endpoint) assert.match(repair.endpoint, /^https:\/\//u);
    if (repair.channel) assert.match(repair.channel, /^UC[A-Za-z0-9_-]{22}$/u);
  }
});

test('citation-only covers the seven feeds whose only marker is the publisher notice', () => {
  const citation = CATALOG_REPAIRS.filter((repair) => repair.citation).map((repair) => repair.slug).sort();
  assert.deepEqual(citation, ['ar-clarin', 'ar-perfil', 'es-eldiario-es', 'us-fox-news', 'us-pbs-newshour', 'us-propublica', 'us-the-new-york-times']);
  // NPR declares «For Personal Use Only» and CNN's feed is frozen: not unlocked.
  assert.ok(!CATALOG_REPAIRS.some((repair) => ['us-npr', 'us-cnn'].includes(repair.slug) && repair.type === 'RSS'));
  assert.match(catalogRepairsSql, /'excerptMaximumCharacters', 300/u);
  assert.match(catalogRepairsSql, /MIGRATION_089_REGISTER_FUNCTION_CHANGED/u);
});
