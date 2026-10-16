import { describe, expect, it } from 'vitest';
import {
  GOVUK_RSH_CANONICAL_URL,
  GOVUK_RSH_CONTENT_ID,
  GOVUK_RSH_RIGHTS_EVIDENCE_URL,
  GOVUK_RSH_RIGHTS_REVIEWED_AT,
  GOVUK_RSH_SOURCE_ID,
  GOVUK_RSH_CONTENT_API_URL,
  acquireGovUkRshMetadataOnce,
  govUkRobotsAllowsPath,
  projectGovUkRshMetadata,
} from '../src/live/govuk-product-acquisition.js';
import { GOVUK_ATTRIBUTION, parseGovUkContentMetadata } from '../src/live/govuk-content-api-parser.js';
import type { ParsedGovUkContentMetadata } from '../src/live/govuk-content-api-parser.js';

function parsedItem(
  overrides: Partial<ParsedGovUkContentMetadata> = {},
): ParsedGovUkContentMetadata {
  return {
    contentId: GOVUK_RSH_CONTENT_ID,
    basePath: new URL(GOVUK_RSH_CANONICAL_URL).pathname,
    documentType: 'press_release',
    schemaName: 'news_article',
    title: 'Social housing landlord downgraded by RSH',
    publisher: 'Regulator of Social Housing',
    firstPublishedAt: '2026-10-07T08:30:03.000Z',
    publicUpdatedAt: '2026-10-07T08:30:03.000Z',
    locale: 'en',
    contentBodyPresent: true,
    ...overrides,
  };
}

describe('GOV.UK RSH one-shot metadata boundary', () => {
  it('parses only approved metadata and discards the complete API response buffer', () => {
    const bodyText = 'third-party body text and full article content';
    const responseBytes = Buffer.from(JSON.stringify({
      content_id: GOVUK_RSH_CONTENT_ID,
      base_path: new URL(GOVUK_RSH_CANONICAL_URL).pathname,
      document_type: 'press_release',
      schema_name: 'news_article',
      title: 'Social housing landlord downgraded by RSH',
      first_published_at: '2026-10-07T08:30:03Z',
      public_updated_at: '2026-10-07T08:30:03Z',
      locale: 'en',
      details: { body: bodyText },
      links: { organisations: [{ title: 'Regulator of Social Housing' }] },
    }));
    const item = parseGovUkContentMetadata(responseBytes, GOVUK_RSH_CANONICAL_URL);
    const acquiredAt = new Date('2026-10-15T12:00:00.000Z');
    const metadata = projectGovUkRshMetadata(item, acquiredAt);

    expect(Object.keys(item)).not.toContain('body');
    expect(JSON.stringify(item)).not.toContain(bodyText);
    expect(responseBytes.every((byte) => byte === 0)).toBe(true);
    expect(metadata.sourceId).toBe(GOVUK_RSH_SOURCE_ID);
    expect(metadata.sourceItemId).toBe(GOVUK_RSH_CONTENT_ID);
    expect(metadata.canonicalUrl).toBe(GOVUK_RSH_CANONICAL_URL);
    expect(metadata.title).toBe('Social housing landlord downgraded by RSH');
    expect(metadata.attribution).toBe(GOVUK_ATTRIBUTION);
    expect(metadata.rightsEvidenceUrl).toBe(GOVUK_RSH_RIGHTS_EVIDENCE_URL);
    expect(metadata.rightsVerifiedAt).toBe(GOVUK_RSH_RIGHTS_REVIEWED_AT);
    expect(Object.keys(metadata)).not.toContain('body');
    expect(Object.keys(metadata)).not.toContain('excerpt');
    expect(Object.keys(metadata)).not.toContain('author');
  });

  it('rejects a changed publisher item identity', () => {
    const item = parsedItem({ contentId: '00000000-0000-4000-8000-000000000000' });

    expect(() =>
      projectGovUkRshMetadata(item, new Date('2026-10-15T12:00:00.000Z')),
    ).toThrow('GOVUK_RSH_ITEM_OUT_OF_SCOPE');
  });

  it('requires a current rights review before mapping metadata', () => {
    const item = parsedItem();

    expect(() =>
      projectGovUkRshMetadata(item, new Date('2026-11-20T00:00:00.000Z')),
    ).toThrow('GOVUK_RSH_RIGHTS_REVIEW_REQUIRED');
  });

  it('keeps the metadata identity hash stable across a later one-shot replay', () => {
    const first = projectGovUkRshMetadata(
      parsedItem(),
      new Date('2026-10-15T12:00:00.000Z'),
    );
    const replay = projectGovUkRshMetadata(
      parsedItem(),
      new Date('2026-10-16T12:00:00.000Z'),
    );
    expect(replay.metadataHash).toBe(first.metadataHash);
    expect(replay.contentHash).toBe(first.contentHash);
    expect(replay.nearDuplicateSignature).toBe(first.nearDuplicateSignature);
  });

  it('rejects an empty Content API body field without returning the response', () => {
    const bytes = Buffer.from(JSON.stringify({
      content_id: GOVUK_RSH_CONTENT_ID,
      base_path: new URL(GOVUK_RSH_CANONICAL_URL).pathname,
      document_type: 'press_release',
      schema_name: 'news_article',
      title: 'Social housing landlord downgraded by RSH',
      first_published_at: '2026-10-07T08:30:03Z',
      public_updated_at: '2026-10-07T08:30:03Z',
      locale: 'en',
      details: { body: '' },
      links: { organisations: [{ title: 'Regulator of Social Housing' }] },
    }));
    expect(() => parseGovUkContentMetadata(bytes, GOVUK_RSH_CANONICAL_URL)).toThrow(
      'GOVUK_CONTENT_ITEM_INVALID',
    );
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('applies longest-match robots rules for the exact Content API path', () => {
    const path = new URL(GOVUK_RSH_CONTENT_API_URL).pathname;
    const robots =
      'User-agent: *\nDisallow: /api/\nAllow: ' + path + '$\n';

    expect(govUkRobotsAllowsPath(robots, path)).toBe(true);
    expect(govUkRobotsAllowsPath('User-agent: *\nDisallow: /api/\n', path)).toBe(false);
    expect(govUkRobotsAllowsPath('User-agent: OtherBot\nAllow: /\n', path)).toBe(false);
  });

  it('makes one robots request and one exact Content API request without retaining the body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const path = new URL(GOVUK_RSH_CONTENT_API_URL).pathname;
    const payload = JSON.stringify({
      content_id: GOVUK_RSH_CONTENT_ID,
      base_path: new URL(GOVUK_RSH_CANONICAL_URL).pathname,
      document_type: 'press_release',
      schema_name: 'news_article',
      title: 'Social housing landlord downgraded by RSH',
      first_published_at: '2026-10-07T08:30:03Z',
      public_updated_at: '2026-10-07T08:30:03Z',
      locale: 'en',
      details: { body: 'body is not retained by the metadata product path' },
      links: { organisations: [{ title: 'Regulator of Social Housing' }] },
    });
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://www.gov.uk/robots.txt') {
        return new Response(`User-agent: DialektikProductMetadata\nAllow: ${path}$\n`, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    };

    const metadata = await acquireGovUkRshMetadataOnce({
      fetcher,
      recordedAt: new Date('2026-10-15T12:00:00.000Z'),
    });

    expect(calls.map((call) => call.url)).toEqual([
      'https://www.gov.uk/robots.txt',
      GOVUK_RSH_CONTENT_API_URL,
    ]);
    expect(calls.every((call) => call.init?.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.init?.redirect === 'error')).toBe(true);
    expect(calls.every((call) => call.init?.credentials === 'omit')).toBe(true);
    expect(metadata.title).toBe('Social housing landlord downgraded by RSH');
    expect(Object.keys(metadata)).not.toContain('body');
    expect(JSON.stringify(metadata)).not.toContain('body is not retained');
  });
});
