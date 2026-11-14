import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCsv } from '../scripts/catalog-csv.mjs';
import { MEDIA_CATALOG_ENTRIES } from '../../../packages/database/dist/migration/087_multicountry_media_catalog.data.js';

const csv = parseCsv(readFileSync(new URL('../data/verified_multicountry_sources.csv', import.meta.url), 'utf8'));

test('the catalog keeps the 119 verified rows of the four countries', () => {
  assert.equal(csv.length, 119);
  const count = (code) => csv.filter((row) => row.country_code === code).length;
  assert.deepEqual([count('CL'), count('ES'), count('AR'), count('US')], [20, 35, 32, 32]);
  assert.equal(new Set(csv.map((row) => row.media_group_slug)).size, 72);
  assert.equal(csv.filter((row) => row.source_type === 'RSS').length, 53);
  assert.equal(csv.filter((row) => row.source_type === 'YOUTUBE').length, 66);
});

test('the generated migration data is current with the CSV and its verification', () => {
  execFileSync(process.execPath, [new URL('../scripts/build-multicountry-catalog-migration.mjs', import.meta.url).pathname, '--check']);
  assert.equal(MEDIA_CATALOG_ENTRIES.length, 119);
});

test('only verified rows are ingested, with HTTPS endpoints and unique identities', () => {
  const active = MEDIA_CATALOG_ENTRIES.filter((entry) => entry.status === 'ACTIVE');
  assert.equal(active.length, 67);
  for (const entry of active) {
    assert.match(entry.source_id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);
    if (entry.type === 'RSS') assert.match(entry.endpoint, /^https:\/\//u);
    else assert.match(entry.channel_id, /^UC[A-Za-z0-9_-]{22}$/u);
  }
  assert.equal(new Set(active.map((entry) => entry.source_id)).size, active.length);
  // A YouTube channel is ingested once even when two catalog groups list it.
  const channels = active.filter((entry) => entry.type === 'YOUTUBE').map((entry) => entry.channel_id);
  assert.equal(new Set(channels).size, channels.length);
  const lnMas = MEDIA_CATALOG_ENTRIES.find((entry) => entry.slug === 'ar-ln-mas');
  assert.equal(lnMas.status, 'DUPLICATE_CHANNEL');
  // CHV Noticias keeps the official active channel.
  const chv = MEDIA_CATALOG_ENTRIES.find((entry) => entry.slug === 'cl-chv-noticias');
  assert.equal(chv.channel_id, 'UCRsUoZYC1ULUspipMRnMhwg');
});
