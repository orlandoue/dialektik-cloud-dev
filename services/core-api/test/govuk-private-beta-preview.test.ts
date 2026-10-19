import { describe, expect, it } from 'vitest';
import { toGovUkReadOnlyPreview } from '../src/live/private-beta-live.controller.js';
import {
  GOVUK_RSH_CANONICAL_URL,
  GOVUK_RSH_CONTENT_ID,
  GOVUK_RSH_RIGHTS_EVIDENCE_URL,
  GOVUK_RSH_SOURCE_ID,
  GOVUK_RSH_RIGHTS_REVIEWED_AT,
} from '../src/live/govuk-product-acquisition.js';
import { GOVUK_ATTRIBUTION } from '../src/live/govuk-content-api-parser.js';

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
