import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./prepare.mjs', import.meta.url));
const source = {
  id: '01M4YDQK00CH1000C1PERCH11E', policy_id: 'a'.repeat(64),
  name: 'Synthetic publisher', canonical_domain: 'news.example.invalid',
  registry_key: 'fixture-only', endpoint: 'https://news.example.invalid/feed',
  discovery_channel: 'rss_atom', language: 'en', storage_policy: 'METADATA_ONLY',
};

function run(xml) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ source, xml }), encoding: 'utf8',
    env: { ...process.env, DIALEKTIK_RSS_PUBLICATION_DATE: date },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('prepares all of today’s RSS items without retaining excerpts under metadata-only policy', () => {
  const date = new Date().toUTCString();
  const body = Array.from({ length: 15 }, (_, index) => `<item>
    <title>Synthetic headline ${index}</title>
    <link>https://news.example.invalid/item/${index}</link>
    <guid>fixture-${index}</guid><pubDate>${date}</pubDate>
    <description><![CDATA[SECRET_FIXTURE_EXCERPT]]></description></item>`).join('');
  const result = run(`<rss><channel>${body}</channel></rss>`);
  assert.equal(result.items.length, 15);
  assert.ok(!JSON.stringify(result).includes('SECRET_FIXTURE_EXCERPT'));
  assert.equal(new Set(result.items.map((item) => item.canonicalUrl)).size, 15);
  for (const item of result.items) {
    assert.equal(item.excerpt, null);
    assert.equal(item.contentHash, createHash('sha256').update(item.articleText.normalize('NFC')).digest('hex'));
    assert.match(item.articleId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.notEqual(item.articleId, item.receiptId);
  }
});

test('retains a cleaned feed description only under an excerpt storage policy', () => {
  const date = new Date().toUTCString();
  const excerptSource = { ...source, storage_policy: 'METADATA_AND_FEED_EXCERPT' };
  const xml = `<rss><channel><item><title>Headline</title>
    <link>https://news.example.invalid/item/with-excerpt</link><guid>excerpt-1</guid>
    <pubDate>${date}</pubDate><description><![CDATA[<p>RSS-provided excerpt &amp; detail.</p>]]></description>
    </item></channel></rss>`;
  const result = runWith(excerptSource, xml);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].excerpt, 'RSS-provided excerpt & detail.');
  assert.equal(result.items[0].articleText, 'Headline. RSS-provided excerpt & detail.');
  assert.match(result.items[0].normalizedText, /^headline\. rss-provided excerpt/);
});

test('repackages sanitized YouTube feed metadata with fresh locally generated receipt IDs', () => {
  const youtubeSource = {
    ...source,
    id: '01M4YDQK00YT01MEGAN0T1C1AS',
    policy_id: 'b'.repeat(64),
    name: 'Meganoticias (YouTube)',
    canonical_domain: 'youtube.com',
    registry_key: 'chile-yt-meganoticias-v1',
    endpoint: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCkccyEbqhhM3uKOI6Shm-4Q',
    storage_policy: 'METADATA_AND_FEED_EXCERPT',
  };
  const description = 'Un resumen breve publicado por el canal.';
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"><entry>
      <id>yt:video:repack-1</id><title>Video reciente del canal</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=repack-1"/>
      <published>${new Date().toISOString()}</published>
      <media:group><media:description>${description}</media:description></media:group>
    </entry></feed>`;
  const fetched = runWith(youtubeSource, xml);
  assert.equal(fetched.items.length, 1);
  const repacked = runWithItems(youtubeSource, fetched.items);
  assert.equal(repacked.items.length, 1);
  assert.equal(repacked.items[0].excerpt, description);
  assert.equal(repacked.items[0].articleText, 'Video reciente del canal. ' + description);
  assert.equal(repacked.items[0].sourceItemId, fetched.items[0].sourceItemId);
  assert.notEqual(repacked.items[0].receiptId, fetched.items[0].receiptId);
  assert.notEqual(repacked.items[0].versionId, fetched.items[0].versionId);
});

test('prepares news-sitemap provenance as metadata only', () => {
  const sitemapSource = {
    ...source,
    id: '01M4YDQK00CH100E1M0STRAD0R',
    name: 'El Mostrador',
    canonical_domain: 'elmostrador.cl',
    registry_key: 'chile-rss-elmostrador-v1',
    endpoint: 'https://www.elmostrador.cl/sitemap_news.xml',
    discovery_channel: 'news_sitemap',
    language: 'es',
  };
  const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
    <url><loc>https://www.elmostrador.cl/noticias/nota-ejemplo/</loc><news:news>
      <news:publication><news:name>El Mostrador</news:name><news:language>es</news:language></news:publication>
      <news:publication_date>${new Date().toISOString()}</news:publication_date>
      <news:title>Titular de ejemplo</news:title></news:news></url></urlset>`;
  const result = runWith(sitemapSource, xml);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].discoveryChannel, 'news_sitemap');
  assert.equal(result.items[0].headline, 'Titular de ejemplo');
  assert.equal(result.items[0].canonicalUrl, 'https://www.elmostrador.cl/noticias/nota-ejemplo/');
  assert.equal(result.items[0].excerpt, null);
});

function runWith(inputSource, xml) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ source: inputSource, xml }), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runWithItems(inputSource, items) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ source: inputSource, items }), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('rejects marked third-party entries and ignores old articles', () => {
  const current = new Date().toUTCString();
  const old = new Date(Date.now() - 30 * 86400000).toUTCString();
  const xml = `<rss><channel><item><title>Copyrighted title</title>
    <link>https://news.example.invalid/1</link><guid>one</guid><pubDate>${current}</pubDate>
    <description>copyright other publisher</description></item>
    <item><title>Old title</title><link>https://news.example.invalid/2</link>
    <guid>two</guid><pubDate>${old}</pubDate></item></channel></rss>`;
  assert.deepEqual(run(xml).items, []);
});
