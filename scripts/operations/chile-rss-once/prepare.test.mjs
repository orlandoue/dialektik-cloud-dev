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
  discovery_channel: 'rss_atom', language: 'en',
};

function run(xml) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ source, xml }), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('prepares bounded RSS metadata without retaining a feed excerpt', () => {
  const date = new Date().toUTCString();
  const body = Array.from({ length: 15 }, (_, index) => `<item>
    <title>Synthetic headline ${index}</title>
    <link>https://news.example.invalid/item/${index}</link>
    <guid>fixture-${index}</guid><pubDate>${date}</pubDate>
    <description><![CDATA[SECRET_FIXTURE_EXCERPT]]></description></item>`).join('');
  const result = run(`<rss><channel>${body}</channel></rss>`);
  assert.equal(result.items.length, 12);
  assert.ok(!JSON.stringify(result).includes('SECRET_FIXTURE_EXCERPT'));
  assert.equal(new Set(result.items.map((item) => item.canonicalUrl)).size, 12);
  for (const item of result.items) {
    assert.equal(item.contentHash, createHash('sha256').update(item.headline.normalize('NFC')).digest('hex'));
    assert.match(item.articleId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.notEqual(item.articleId, item.receiptId);
  }
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
  assert.equal(result.items[0].excerpt, undefined);
});

function runWith(inputSource, xml) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ source: inputSource, xml }), encoding: 'utf8',
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
