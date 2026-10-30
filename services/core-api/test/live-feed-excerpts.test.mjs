import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLiveFeed } from '../dist/live/live.adapter.js';

const policy = {
  sourceId: '01M4YDQK00CH1000C1PERCH11E',
  registryKey: 'chile-rss-ciperchile-v1',
  publisherName: 'CIPER Chile',
  canonicalDomain: 'ciperchile.cl',
  discoveryChannel: 'rss_atom',
  endpoint: 'https://www.ciperchile.cl/feed/',
  rightsClass: 'LIVE_READY',
  active: true,
  rightsEvidenceUrl: 'https://www.bcn.cl/leychile/navegar?idNorma=28933',
  rightsVerifiedAt: '2026-10-29T00:00:00.000Z',
  attribution: 'CIPER Chile; feed excerpt with source title, author and link.',
  language: 'es',
  allowedArticleDomains: ['ciperchile.cl', 'www.ciperchile.cl'],
  storagePolicy: 'METADATA_AND_FEED_EXCERPT',
};

const feed = (item, root = 'rss') =>
  root === 'atom'
    ? `<feed xmlns="http://www.w3.org/2005/Atom">${item}</feed>`
    : `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${item}</channel></rss>`;

test('cleans the publisher RSS description and decodes HTML entities', () => {
  const xml = feed(`<item><title>Informe del Fondo E</title>
    <link>https://www.ciperchile.cl/2026/10/29/informe/</link><guid>ciper-1</guid>
    <pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Las AFP informaron que &#34;el fondo no cambia&#34; &amp; mantienen la estrategia.</p>]]></description>
    </item>`);
  const [item] = parseLiveFeed(xml, policy);
  assert.equal(item.headline, 'Informe del Fondo E');
  assert.equal(item.excerpt, 'Las AFP informaron que "el fondo no cambia" & mantienen la estrategia.');
});

test('uses content:encoded when description is empty or repeats the headline', () => {
  const xml = feed(`<item><title>Informe del Fondo E</title>
    <link>https://www.ciperchile.cl/2026/10/29/informe/</link><guid>ciper-2</guid>
    <pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate>
    <description>Informe del Fondo E.</description>
    <content:encoded><![CDATA[<p>El documento registra pérdidas y especifica la fecha de publicación.</p>]]></content:encoded>
    </item>`);
  const [item] = parseLiveFeed(xml, policy);
  assert.equal(item.excerpt, 'El documento registra pérdidas y especifica la fecha de publicación.');
});

test('limits a long feed-provided excerpt to 700 Unicode characters', () => {
  const summary = 'Resumen relevante con un emoji 📰 y datos publicados. '.repeat(40);
  const xml = feed(`<item><title>Informe del Fondo E</title>
    <link>https://www.ciperchile.cl/2026/10/29/informe/</link><guid>ciper-3</guid>
    <pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate><description>${summary}</description></item>`);
  const [item] = parseLiveFeed(xml, policy);
  assert.ok(Array.from(item.excerpt).length <= 700);
  assert.ok(!item.excerpt.endsWith('\uD83D'));
});

test('allows Atom summary fallback and never stores excerpts under metadata-only policy', () => {
  const atomPolicy = { ...policy, discoveryChannel: 'rss_atom' };
  const atomXml = feed(`<entry><title>Informe del Fondo E</title>
    <link href="https://www.ciperchile.cl/2026/10/29/informe/" rel="alternate"/>
    <id>ciper-4</id><updated>2026-10-29T10:00:00Z</updated>
    <content type="html">&lt;p&gt;Contenido principal del informe.&lt;/p&gt;</content></entry>`, 'atom');
  const [atomItem] = parseLiveFeed(atomXml, atomPolicy);
  assert.equal(atomItem.excerpt, 'Contenido principal del informe.');

  const rssXml = feed(`<item><title>Solo titular</title><link>https://www.ciperchile.cl/2026/10/29/solo/</link>
    <guid>ciper-5</guid><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate>
    <description>Un resumen que el permiso actual no retiene.</description></item>`);
  const [metadataOnlyItem] = parseLiveFeed(rssXml, { ...policy, storagePolicy: 'METADATA_ONLY' });
  assert.equal(metadataOnlyItem.excerpt, null);
});

test('reads the nested YouTube Atom media:description as a bounded feed excerpt', () => {
  const youtubePolicy = {
    ...policy,
    sourceId: '01M4YDQK00YT01MEGAN0T1C1AS',
    registryKey: 'chile-yt-meganoticias-v1',
    publisherName: 'Meganoticias (YouTube)',
    canonicalDomain: 'youtube.com',
    endpoint: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCkccyEbqhhM3uKOI6Shm-4Q',
    allowedArticleDomains: ['youtube.com', 'www.youtube.com'],
  };
  const description = 'La reportera explica los antecedentes y entrega cifras del anuncio oficial.';
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/">
    <entry><id>yt:video:abc123</id><title>Actualización sobre el anuncio</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
      <published>2026-10-29T10:00:00Z</published>
      <media:group><media:description>${description}</media:description></media:group>
    </entry></feed>`;
  const [item] = parseLiveFeed(xml, youtubePolicy);
  assert.equal(item.canonicalUrl, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(item.excerpt, description);
});
