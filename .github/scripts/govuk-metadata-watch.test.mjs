import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeProjection } from './govuk-metadata-watch.mjs';
import { GOVUK_CURATED_ARTICLE_URLS } from '../../services/core-api/dist/live/govuk-content-api-parser.js';

function item(index, overrides={}) {
  return {
    contentId: 'item-'+index,
    canonicalUrl: GOVUK_CURATED_ARTICLE_URLS[index],
    title: 'Official statement '+index,
    publisher: 'Regulator of Social Housing',
    publishedAt: '2026-10-15T09:00:00.000Z',
    modifiedAt: null,
    attribution: 'OGL 3.0 attribution',
    rightsEvidenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    ...overrides,
  };
}
test('a bounded seven-publication record has no source body and no database authority', () => {
  const input=[item(1), item(0)];
  const first=safeProjection(input, new Date('2026-10-20T12:00:00Z'));
  const second=safeProjection([...input].reverse(),new Date('2026-10-20T16:00:00Z'));
  assert.equal(first.item_count,2);
  assert.equal(first.metadata_content_digest_sha256,second.metadata_content_digest_sha256);
  assert.equal(first.database_writes,0);
  assert.equal(first.persisted_article_count,0);
  assert.equal(first.discovering_new_urls,false);
  assert.equal(first.production_permission,false);
  assert.equal(first.full_text_saved,false);
  assert.equal(first.source_count,1);
  assert.equal(first.schema,'dialektik-readonly-source-watch-v1');
  assert.equal(first.robots_checked_live,true);
  assert.deepEqual(first.articles.map(x=>x.canonical_url),[GOVUK_CURATED_ARTICLE_URLS[0],GOVUK_CURATED_ARTICLE_URLS[1]].sort());
  assert.equal(JSON.stringify(first).includes('source_body'),false);
});
test('rejects unknown publishers, URLs and duplicate canonical items', () => {
  assert.throws(()=>safeProjection([item(0),item(1,{publisher:'Unapproved'})]),/OUT_OF_SCOPE/);
  assert.throws(()=>safeProjection([item(0),item(1,{canonicalUrl:'https://evil.example/'})]),/OUT_OF_SCOPE/);
  assert.throws(()=>safeProjection([item(0),item(0)]),/DUPLICATE/);
});
test('fails closed for zero, one, eight, malformed dates or title', () => {
  assert.throws(()=>safeProjection([]),/OUT_OF_SCOPE/);
  assert.throws(()=>safeProjection([item(0)]),/OUT_OF_SCOPE/);
  assert.throws(()=>safeProjection([item(0),item(1,{publishedAt:'nonsense'})]),/OUT_OF_SCOPE/);
  assert.throws(()=>safeProjection([item(0),item(1,{title:''})]),/OUT_OF_SCOPE/);
  assert.throws(()=>safeProjection(Array.from({length:8},(_,i)=>item(i))),/OUT_OF_SCOPE/);
});
