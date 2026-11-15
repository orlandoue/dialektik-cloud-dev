import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLiveFeed, CITATION_EXCERPT_MAX_CHARACTERS } from '../dist/live/live.adapter.js';

const long = 'El Senado aprobó la reforma tras una sesión de doce horas. '.repeat(20);
const feed = (itemExtra = '') => `<?xml version="1.0"?><rss version="2.0"><channel>
<title>NYT &gt; Politics</title><copyright>Copyright 2026 The New York Times Company</copyright>
<item><title>Senate Passes the Budget Bill</title><link>https://www.nytimes.com/2026/11/15/us/politics/budget.html</link>
<pubDate>Sun, 15 Nov 2026 12:00:00 GMT</pubDate><description>${long}</description>${itemExtra}</item>
</channel></rss>`;
const policy = (extra = {}) => ({
  sourceId: '01M5MC0000000000000000TEST', registryKey: 'catalog-us-rss-the-new-york-times-v1', publisherName: 'The New York Times',
  canonicalDomain: 'nytimes.com', sourceType: 'daily_newspaper', publisherFamily: null, category: null, discoveryChannel: 'rss_atom',
  endpoint: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', rightsClass: 'LIVE_READY', storagePolicy: 'METADATA_AND_FEED_EXCERPT',
  active: true, rightsEvidenceUrl: 'https://www.copyright.gov/title17/92chap1.html#107', rightsVerifiedAt: '2026-11-15T00:00:00.000Z',
  attribution: 'The New York Times', language: 'en', allowedArticleDomains: ['nytimes.com', 'www.nytimes.com'], ...extra,
});

test('a feed-wide publisher notice still rejects items for ordinary sources', () => {
  assert.equal(parseLiveFeed(feed(), policy())[0].errorCode, 'THIRD_PARTY_OR_COPYRIGHT_MARKER');
});

test('headline_and_citation_only accepts the publisher notice and keeps a short excerpt', () => {
  const [item] = parseLiveFeed(feed(), policy({ ingestionMode: 'headline_and_citation_only', publisherCopyrightNotice: 'ACCEPTED' }));
  assert.equal(item.errorCode, null);
  assert.equal(item.headline, 'Senate Passes the Budget Bill');
  assert.ok(Array.from(item.excerpt).length <= CITATION_EXCERPT_MAX_CHARACTERS);
  assert.equal(item.canonicalUrl, 'https://www.nytimes.com/2026/11/15/us/politics/budget.html');
});

test('item-level credits and third-party rights are still rejected', () => {
  const citation = policy({ ingestionMode: 'headline_and_citation_only', publisherCopyrightNotice: 'ACCEPTED' });
  assert.equal(parseLiveFeed(feed('<dc:rights>© Associated Press</dc:rights>'), citation)[0].errorCode, 'THIRD_PARTY_OR_COPYRIGHT_MARKER');
  assert.equal(parseLiveFeed(feed('<source url="https://apnews.com">Associated Press</source>'), citation)[0].errorCode, 'THIRD_PARTY_OR_COPYRIGHT_MARKER');
  // Without the reviewed notice flag the mode alone does not lift the guard.
  assert.equal(parseLiveFeed(feed(), policy({ ingestionMode: 'headline_and_citation_only' }))[0].errorCode, 'THIRD_PARTY_OR_COPYRIGHT_MARKER');
});
