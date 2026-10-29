import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLiveFeed } from '../dist/live/live.adapter.js';

const policy = {
  sourceId: '01M4YDQK00CH100E1M0STRAD0R',
  registryKey: 'chile-rss-elmostrador-v1',
  publisherName: 'El Mostrador',
  canonicalDomain: 'elmostrador.cl',
  sourceType: 'news',
  publisherFamily: 'El Mostrador',
  category: null,
  discoveryChannel: 'news_sitemap',
  endpoint: 'https://www.elmostrador.cl/sitemap_news.xml',
  rightsClass: 'LIVE_READY',
  storagePolicy: 'METADATA_ONLY',
  active: true,
  rightsEvidenceUrl: 'https://www.elmostrador.cl/',
  rightsVerifiedAt: '2026-10-29T00:00:00.000Z',
  attribution: 'El Mostrador; título, fecha y enlace canónico solamente.',
  language: 'es',
  allowedArticleDomains: ['www.elmostrador.cl', 'elmostrador.cl'],
};

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
 xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
 <url><loc>https://www.elmostrador.cl/noticias/pais/2026/10/29/actualidad/</loc>
  <news:news><news:publication><news:name>El Mostrador</news:name><news:language>es</news:language></news:publication>
   <news:publication_date>2026-10-29T09:15:00+00:00</news:publication_date>
   <news:title>Ejemplo de noticia</news:title></news:news></url>
</urlset>`;

test('parses El Mostrador news sitemap as title, date and canonical link only', () => {
  const [item] = parseLiveFeed(sitemap, policy);
  assert.equal(item.headline, 'Ejemplo de noticia');
  assert.equal(item.canonicalUrl, 'https://www.elmostrador.cl/noticias/pais/2026/10/29/actualidad/');
  assert.equal(item.publishedAt?.toISOString(), '2026-10-29T09:15:00.000Z');
  assert.equal(item.excerpt, null);
  assert.equal(item.author, null);
  assert.equal(item.errorCode, null);
});

test('rejects sitemap entries attributed to a different publisher or language', () => {
  assert.throws(() => parseLiveFeed(sitemap.replace('El Mostrador', 'Otro medio'), policy),
    /NEWS_SITEMAP_PUBLICATION_IDENTITY_MISMATCH/);
  assert.throws(() => parseLiveFeed(sitemap.replace('<news:language>es</news:language>', '<news:language>en</news:language>'), policy),
    /NEWS_SITEMAP_PUBLICATION_IDENTITY_MISMATCH/);
});
