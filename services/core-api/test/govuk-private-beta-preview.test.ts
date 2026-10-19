import { describe, expect, it } from 'vitest';
import { toGovUkReadOnlyPreview, toGovUkReadOnlyPreviewItems } from '../src/live/private-beta-live.controller.js';
import {
  GOVUK_RSH_CANONICAL_URL,
  GOVUK_RSH_CONTENT_ID,
  GOVUK_RSH_RIGHTS_EVIDENCE_URL,
  GOVUK_RSH_SOURCE_ID,
  GOVUK_RSH_RIGHTS_REVIEWED_AT,
  acquireGovUkRshPreviewBatch,
} from '../src/live/govuk-product-acquisition.js';
import { GOVUK_ATTRIBUTION, GOVUK_CURATED_ARTICLE_URLS } from '../src/live/govuk-content-api-parser.js';


describe('Curated multi-article official preview', () => {
  const time = new Date('2026-10-19T19:00:00.000Z');
  function syntheticFetcher(denyRobots = false): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response(
        denyRobots ? 'User-agent: *\nDisallow: /api/content/\n' :
        'User-agent: *\nAllow: /api/content/\n',
        { status: 200, headers: { 'content-type': 'text/plain' } },
      );
      const path = new URL(url).pathname.slice('/api/content'.length);
      const index = GOVUK_CURATED_ARTICLE_URLS.findIndex((u) => new URL(u).pathname === path);
      if (index < 0) return new Response('Not found', { status: 404 });
      const id = index === 0 ? GOVUK_RSH_CONTENT_ID :
        '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
      return new Response(JSON.stringify({
        content_id: id,
        base_path: path,
        document_type: 'press_release',
        schema_name: 'news_article',
        title: 'Official publication ' + String(index),
        first_published_at: index === 0 ? '2026-10-07T08:30:03Z' : '2026-10-15T09:00:00Z',
        public_updated_at: index === 0 ? '2026-10-07T08:30:03Z' : '2026-10-15T09:00:00Z',
        locale: 'en',
        details: { body: 'Must never be returned by preview.' },
        links: { organisations: [{ title: 'Regulator of Social Housing' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  }
  it('retrieves only seven verified official items, sorted, with no fulltext', async () => {
    const items = await acquireGovUkRshPreviewBatch({ fetcher: syntheticFetcher(), recordedAt: time });
    expect(items).toHaveLength(7);
    expect(items[0]?.publishedAt).toBe('2026-10-15T09:00:00.000Z');
    expect(items.some((x) => x.canonicalUrl === GOVUK_RSH_CANONICAL_URL)).toBe(true);
    const dto = toGovUkReadOnlyPreviewItems(items);
    expect(dto.items).toHaveLength(7);
    expect(JSON.stringify(dto)).not.toContain('Must never be returned');
    expect(dto.persisted).toBe(false);
    expect(new Set(dto.items.map((x) => x.canonical_url)).size).toBe(7);
  });
  it('fails closed on robots disallow', async () => {
    await expect(acquireGovUkRshPreviewBatch({
      fetcher: syntheticFetcher(true),
      recordedAt: time,
    })).rejects.toThrow('GOVUK_ROBOTS_DISALLOWS_API');
  });
  it('rejects duplicate or empty preview scope', () => {
    expect(() => toGovUkReadOnlyPreviewItems([])).toThrow();
  });
});

describe('GOV.UK read-only preview DTO boundary', () => {
  it('returns exactly verified metadata without excerpts, body or persisted identity', () => {
    const dto = toGovUkReadOnlyPreview({
      sourceId: GOVUK_RSH_SOURCE_ID,
      sourceItemId: GOVUK_RSH_CONTENT_ID,
      canonicalUrl: GOVUK_RSH_CANONICAL_URL,
      title: 'Verified RSH news title',
      publishedAt: '2026-10-07T08:30:03.000Z',
      modifiedAt: null,
      locale: 'en',
      acquiredAt: '2026-10-19T19:00:00.000Z',
      metadataHash: '0'.repeat(64),
      contentHash: '1'.repeat(64),
      nearDuplicateSignature: '2'.repeat(64),
      attribution: GOVUK_ATTRIBUTION,
      rightsEvidenceUrl: GOVUK_RSH_RIGHTS_EVIDENCE_URL,
      rightsVerifiedAt: GOVUK_RSH_RIGHTS_REVIEWED_AT,
    });
    expect(dto.mode).toBe('OFFICIAL_READ_ONLY_PREVIEW');
    expect(dto.persisted).toBe(false);
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]?.headline).toBe('Verified RSH news title');
    expect(dto.items[0]?.canonical_url).toBe(GOVUK_RSH_CANONICAL_URL);
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toMatch(/"body"|"excerpt"|"article_id"|"event_id"|"near_duplicate_signature"|"metadata_hash"/);
    expect(serialized).toContain(GOVUK_RSH_CONTENT_ID);
  });
});
