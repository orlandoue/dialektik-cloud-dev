// Receipts are written only when an item's evidence changes. The evidence
// hash is the item's own, not the whole feed's (24 Nov 2026: 26,785 receipts
// for 1,388 items in a day because every feed change touched every item).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLiveFeed } from '../dist/live/live.adapter.js';
import { ITEM_HASH_PREFIX, itemEvidenceHash } from '../dist/live/live-item-hash.js';
import { receiptNeeded } from '../dist/live/live-sightings.js';

const policy = {
  sourceId: '01M4YDQK00CH1000C1PERCH11E', registryKey: 'chile-rss-ciperchile-v1', publisherName: 'CIPER Chile',
  canonicalDomain: 'ciperchile.cl', discoveryChannel: 'rss_atom', endpoint: 'https://www.ciperchile.cl/feed/',
  rightsClass: 'LIVE_READY', active: true, rightsEvidenceUrl: 'https://www.bcn.cl/leychile/navegar?idNorma=28933',
  rightsVerifiedAt: '2026-10-29T00:00:00.000Z', attribution: 'CIPER Chile', language: 'es',
  allowedArticleDomains: ['ciperchile.cl', 'www.ciperchile.cl'], storagePolicy: 'METADATA_AND_FEED_EXCERPT',
};
const item = (title, extra = '') => `<item><title>${title}</title>
  <link>https://www.ciperchile.cl/2026/10/29/${encodeURIComponent(title)}/?utm_source=rss</link><guid>${title}</guid>
  <pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate><description>Resumen de ${title}</description>${extra}</item>`;
const feed = (items, build) => `<rss><channel><lastBuildDate>${build}</lastBuildDate>${items.join('')}</channel></rss>`;
const hashOf = (xml, title) => parseLiveFeed(xml, policy).find((i) => i.headline === title).rawPayloadHash;

test('a feed that changes around an item leaves the item\'s hash alone', () => {
  const before = feed([item('Uno'), item('Dos')], 'Thu, 29 Oct 2026 10:00:00 GMT');
  const after = feed([item('Tres'), item('Dos'), item('Uno')], 'Thu, 29 Oct 2026 10:05:00 GMT');
  assert.equal(hashOf(before, 'Uno'), hashOf(after, 'Uno'));
  assert.notEqual(hashOf(before, 'Uno'), hashOf(before, 'Dos'), 'each item has its own hash');
  assert.ok(hashOf(before, 'Uno').startsWith(ITEM_HASH_PREFIX));
});

test('a real edit of the item changes it; pubDate rewrites and markup do not', () => {
  const base = { sourceItemId: 'g1', canonicalUrl: 'https://medio.cl/a', headline: 'Titular', excerpt: 'Resumen', originalModifiedAt: null };
  const h = itemEvidenceHash(base);
  assert.equal(itemEvidenceHash({ ...base, excerpt: '  <p>Resumen</p> ' }), h);
  assert.notEqual(itemEvidenceHash({ ...base, headline: 'Titular corregido' }), h);
  assert.notEqual(itemEvidenceHash({ ...base, originalModifiedAt: '2026-10-29T11:00:00Z' }), h);
  assert.notEqual(itemEvidenceHash({ ...base, canonicalUrl: 'https://medio.cl/b' }), h);
});

const evidence = (hash, extra = {}) => ({ policy_id: 'p1', discovery_url: 'https://medio.cl/feed', discovered_url: 'https://medio.cl/a',
  canonical_url: 'https://medio.cl/a', source_item_id: 'g1', raw_payload_hash: hash, adapter_version: 'v4',
  disposition: 'PERSISTED', error_code: null, ...extra });

test('switching from feed hashes to item hashes writes no burst of receipts', () => {
  const legacy = evidence('a'.repeat(64));
  const next = evidence(`${ITEM_HASH_PREFIX}${'b'.repeat(64)}`);
  assert.equal(receiptNeeded(legacy, next), false, 'only the hash rule changed');
  assert.equal(receiptNeeded(legacy, { ...next, canonical_url: 'https://medio.cl/otra' }), true, 'other evidence still counts');
  assert.equal(receiptNeeded(next, evidence(`${ITEM_HASH_PREFIX}${'c'.repeat(64)}`)), true, 'after the switch, item hashes compare');
  assert.equal(receiptNeeded(next, next), false);
  assert.equal(receiptNeeded(undefined, next), true);
});
