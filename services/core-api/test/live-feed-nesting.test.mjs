import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLiveFeed } from '../dist/live/live.adapter.js';

const policy = {
  publisherName: 'Example',
  canonicalDomain: 'example.invalid',
  allowedArticleDomains: ['example.invalid'],
  storagePolicy: 'METADATA_ONLY',
};

test('RSS HTML in CDATA and comments does not count as XML nesting', () => {
  const html = '<br>'.repeat(40) + '<p>Metadata is not retained</p>';
  const comment = '<fake>'.repeat(40);
  const xml = `<?xml version="1.0"?><rss><channel><!--${comment}-->
    <item><title title-attribute="1 > 0">Example title</title>
    <link>https://example.invalid/article</link>
    <pubDate>Mon, 27 Oct 2025 15:00:00 GMT</pubDate>
    <description><![CDATA[${html}]]></description></item></channel></rss>`;
  const [item] = parseLiveFeed(xml, policy);
  assert.equal(item.errorCode, null);
  assert.equal(item.headline, 'Example title');
  assert.equal(item.excerpt, null);
});

test('genuinely nested XML and entity declarations remain rejected', () => {
  const deep = '<x>'.repeat(33) + 'value' + '</x>'.repeat(33);
  assert.throws(() => parseLiveFeed(`<rss><channel>${deep}</channel></rss>`, policy),
    /FEED_NESTING_TOO_DEEP/);
  assert.throws(() => parseLiveFeed('<!DOCTYPE rss [<!ENTITY a "text">]><rss/>', policy),
    /DTD_OR_ENTITY_DECLARATION_REJECTED/);
});
