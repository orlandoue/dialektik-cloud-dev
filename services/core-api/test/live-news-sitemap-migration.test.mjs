import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(new URL('../../../packages/database/src/migration/052_live_news_sitemap_channel.ts', import.meta.url), 'utf8');
const sourceMigration = readFileSync(new URL('../../../packages/database/src/migration/053_chile_verified_metadata_routes.ts', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../../../packages/database/src/migration/provider.ts', import.meta.url), 'utf8');

test('registers news sitemap acquisition provenance without relabeling it RSS', () => {
  assert.match(migration, /discovery_channel_detail text/);
  assert.match(migration, /'rss_atom','official_api','govuk_content_api','news_sitemap'/);
  assert.doesNotMatch(migration, /drop constraint/i);
  assert.match(sourceMigration, /https:\/\/www\.biobiochile\.cl\/static\/feed-rss/);
  assert.match(sourceMigration, /https:\/\/www\.elmostrador\.cl\/sitemap_news\.xml/);
  assert.match(sourceMigration, /"externalAiTransmissionAllowed":false/);
  assert.doesNotMatch(sourceMigration, /https:\/\/supabase\.com/);
  assert.doesNotMatch(sourceMigration, /\b(?:update|delete|drop)\s+public\./i);
  assert.match(provider, /'052_live_news_sitemap_channel': liveNewsSitemapChannelMigration/);
  assert.match(provider, /'053_chile_verified_metadata_routes': chileVerifiedMetadataRoutesMigration/);
});
