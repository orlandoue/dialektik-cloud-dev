import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capNewestFeedBlocks, filterYouTubeAtom, isoDurationSeconds, fetchYouTubeVideoDetails } from '../dist/live/feed-entry-filter.js';
import { trimCorporatePayload, MAX_CATALOG_ITEMS_PER_POLL } from '../dist/live/corporate-live-acquisition.service.js';
import { resolveYouTubeHandle } from '../dist/live/youtube-handle-resolver.js';
import { parseLiveFeed } from '../dist/live/live.adapter.js';

const entry = (id, title, link, published = '2026-11-14T10:00:00+00:00') => `
 <entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><title>${title}</title>
  <link rel="alternate" href="${link}"/><published>${published}</published>
  <media:group><media:description>Descripción del medio sobre ${title}</media:description></media:group></entry>`;
const atom = (entries) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Canal</title>${entries.join('')}
</feed>`;

test('YouTube Atom feeds drop Shorts and live streams and stay parseable', () => {
  const payload = atom([
    entry('aaaaaaaaaaa', 'Senado aprueba reforma de pensiones', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'),
    entry('bbbbbbbbbbb', 'Clip vertical', 'https://www.youtube.com/shorts/bbbbbbbbbbb'),
    entry('ccccccccccc', '🔴 EN VIVO | Noticias 24/7', 'https://www.youtube.com/watch?v=ccccccccccc'),
  ]);
  const result = filterYouTubeAtom(payload);
  assert.equal(result.shorts, 1);
  assert.equal(result.live, 1);
  const items = parseLiveFeed(result.payload, {
    sourceId: '01M5MC0000000000000000TEST', registryKey: 't', publisherName: 'Canal', canonicalDomain: 'youtube.com',
    sourceType: 'tv', publisherFamily: null, category: null, discoveryChannel: 'rss_atom', endpoint: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC',
    rightsClass: 'LIVE_READY', storagePolicy: 'METADATA_AND_FEED_EXCERPT', active: true, rightsEvidenceUrl: 'https://example.org',
    rightsVerifiedAt: '2026-11-14T00:00:00.000Z', attribution: 'Canal', language: 'es', allowedArticleDomains: ['youtube.com', 'www.youtube.com'],
  });
  assert.deepEqual(items.map((item) => item.headline), ['Senado aprueba reforma de pensiones']);
  assert.equal(items[0].errorCode, null);
});

test('with Data API details, only VOD pieces of 90 s to 45 min remain', async () => {
  assert.equal(isoDurationSeconds('PT1H2M3S'), 3723);
  assert.equal(isoDurationSeconds('PT45S'), 45);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ items: [
      { id: 'aaaaaaaaaaa', contentDetails: { duration: 'PT5M' }, snippet: { liveBroadcastContent: 'none' } },
      { id: 'ddddddddddd', contentDetails: { duration: 'PT59S' }, snippet: { liveBroadcastContent: 'none' } },
      { id: 'eeeeeeeeeee', contentDetails: { duration: 'PT2H' }, snippet: { liveBroadcastContent: 'none' } },
      { id: 'fffffffffff', contentDetails: { duration: 'P0D' }, snippet: { liveBroadcastContent: 'upcoming' } },
    ] }), { headers: { 'content-type': 'application/json' } });
  };
  const payload = atom(['aaaaaaaaaaa', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff']
    .map((id) => entry(id, `Pieza ${id}`, `https://www.youtube.com/watch?v=${id}`)));
  const kept = await trimCorporatePayload(payload, { canonicalDomain: 'youtube.com', discoveryChannel: 'rss_atom', registryKey: 'catalog-es-yt-el-pais-v1' }, 'key', fetchImpl);
  assert.equal(calls.length, 1, 'one videos.list call (1 quota unit) for the whole feed');
  assert.match(kept, /aaaaaaaaaaa/u);
  for (const id of ['ddddddddddd', 'eeeeeeeeeee', 'fffffffffff']) assert.doesNotMatch(kept, new RegExp(id, 'u'));
  assert.equal((await fetchYouTubeVideoDetails(['aaaaaaaaaaa'], null, fetchImpl)).size, 0, 'no key: no API call');
});

test('catalog sources keep only their newest items per poll; others are untouched', async () => {
  const items = Array.from({ length: 30 }, (_, i) => `<item><title>Nota ${i}</title><link>https://www.infobae.com/n/${i}</link>
    <pubDate>${new Date(Date.UTC(2026, 10, 14, 0, i)).toUTCString()}</pubDate></item>`);
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>${items.join('')}</channel></rss>`;
  const capped = await trimCorporatePayload(rss, { canonicalDomain: 'infobae.com', discoveryChannel: 'rss_atom', registryKey: 'catalog-ar-rss-infobae-v1' }, null);
  assert.equal((capped.match(/<item>/gu) ?? []).length, MAX_CATALOG_ITEMS_PER_POLL);
  assert.match(capped, /Nota 29/u);
  assert.doesNotMatch(capped, /Nota 9</u);
  const chile = await trimCorporatePayload(rss, { canonicalDomain: 'latercera.com', discoveryChannel: 'rss_atom', registryKey: 'chile-rss-latercera-v1' }, null);
  assert.equal(chile, rss);
  assert.equal(capNewestFeedBlocks(rss, 100).removed, 0);
});

test('an @handle resolves once through forHandle or the channel page', async () => {
  const api = async (url) => new Response(JSON.stringify({ items: [{ id: 'UCabcdefghijklmnopqrstuv' }] }), { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await resolveYouTubeHandle('@medio', 'key', api), { channelId: 'UCabcdefghijklmnopqrstuv', status: 'RESOLVED_API' });
  const page = async () => new Response('<link rel="canonical" href="https://www.youtube.com/channel/UCzyxwvutsrqponmlkjihgfe">', { status: 200 });
  assert.deepEqual(await resolveYouTubeHandle('@medio', null, page), { channelId: 'UCzyxwvutsrqponmlkjihgfe', status: 'RESOLVED_PAGE' });
  const missing = async () => new Response('', { status: 404 });
  assert.equal((await resolveYouTubeHandle('@nadie', null, missing)).status, 'HANDLE_NOT_FOUND');
  assert.equal((await resolveYouTubeHandle('no handle', null, missing)).status, 'HANDLE_INVALID');
});
