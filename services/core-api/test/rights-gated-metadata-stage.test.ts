import { describe, expect, it } from 'vitest';
import {
  planRightsGatedMetadata,
  type MetadataSourcePolicy,
  type ProposedMetadataItem,
  type PreviouslyStagedMetadata,
} from '../src/live/rights-gated-metadata-stage.js';

const CLOCK = new Date('2026-10-20T20:00:00.000Z');
const base = {
  rightsDecisionId: 'operator-review-20261019',
  rightsEvidenceUrl: 'https://official.example/rights',
  rightsReviewedAt: '2026-10-19T00:00:00.000Z',
  robotsCheckedAt: '2026-10-19T12:00:00.000Z',
  acquisitionApproved: true,
  metadataRetentionApproved: true,
  robotsAllowsPlannedPath: true,
  maxItemsPerBatch: 5,
} as const;
const sources: readonly MetadataSourcePolicy[] = [
  {
    ...base,
    sourceId: 'example_agency_a',
    publisherId: 'official_publisher_a',
    canonicalOrigin: 'https://agency-a.example',
  },
  {
    ...base,
    sourceId: 'example_agency_b',
    publisherId: 'official_publisher_b',
    canonicalOrigin: 'https://agency-b.example',
  },
];

const a: ProposedMetadataItem = {
  sourceId: 'example_agency_a',
  sourceItemId: 'news-20261019-1',
  canonicalUrl: 'https://agency-a.example/news/2026/10/item',
  title: 'Observaciones de un suceso local',
  publishedAt: '2026-10-19T12:00:00.000Z',
  modifiedAt: null,
};
const b: ProposedMetadataItem = {
  sourceId: 'example_agency_b',
  sourceItemId: 'news-20261019-1',
  canonicalUrl: 'https://agency-b.example/noticias/2026/10/item',
  title: 'Observaciones de un suceso local',
  publishedAt: '2026-10-19T15:00:00.000Z',
  modifiedAt: null,
};
const decide = (
  policies: readonly MetadataSourcePolicy[] = sources,
  batch: readonly ProposedMetadataItem[] = [a, b],
  previous: readonly PreviouslyStagedMetadata[] = [],
  at: Date = CLOCK,
) => planRightsGatedMetadata(policies, batch, previous, at);

describe('source-policy gated, deterministic pre-write Article metadata staging', () => {
  it('plans TWO independent approved publishers, never produces Events or contradictions', () => {
    const result = decide();
    expect(result.schema).toBe('dialektik-metadata-prewrite-plan-v1');
    expect(result.distinctPublishers).toBe(2);
    expect(result.counts).toEqual({ new: 2, updated: 0, unchanged: 0 });
    expect(result.items).toHaveLength(2);
    expect(result.databaseWrites).toBe(0);
    expect(result.acquisitionPerformed).toBe(false);
    expect(result.writesAuthorized).toBe(false);
    expect(result.realWorldOccurrenceInferred).toBe(false);
    expect(result.eventsGenerated).toBe(false);
    expect(result.contradictionsGenerated).toBe(false);
    expect(result.publicReleaseAuthority).toBe(false);
  });

  it('the same headline in two newsrooms is NEVER a machine-linked occurrence', () => {
    const result = decide();
    expect(result.items[0]?.metadataHash).not.toBe(result.items[1]?.metadataHash);
    expect(result.items[0]?.deduplicationKey).not.toBe(result.items[1]?.deduplicationKey);
    expect(JSON.stringify(result)).not.toContain('SAME_OCCURRENCE');
    expect(result.realWorldOccurrenceInferred).toBe(false);
  });

  it('same authorized source replay is idempotent and explicitly UNCHANGED', () => {
    const first = decide();
    const history = first.items.map((item) => ({
      sourceId: item.sourceId,
      sourceItemId: item.sourceItemId,
      canonicalUrl: item.canonicalUrl,
      metadataHash: item.metadataHash,
    }));
    const second = decide(sources, [b, a], history);
    expect(second.counts).toEqual({ new: 0, updated: 0, unchanged: 2 });
    expect(second.items.map((item) => item.metadataHash)).toEqual(
      first.items.map((item) => item.metadataHash),
    );
    expect(second.items.map((item) => item.canonicalUrl)).toEqual(
      first.items.map((item) => item.canonicalUrl),
    );
  });

  it('publisher correction is an UPDATE with stable identity key', () => {
    const original = decide();
    const previous = original.items.map((item) => ({
      sourceId: item.sourceId,
      sourceItemId: item.sourceItemId,
      canonicalUrl: item.canonicalUrl,
      metadataHash: item.metadataHash,
    }));
    const corrected = { ...a, title: 'Información posteriormente corregida', modifiedAt: '2026-10-20T10:00:00.000Z' };
    const result = decide(sources, [corrected, b], previous);
    expect(result.counts).toEqual({ new: 0, updated: 1, unchanged: 1 });
    const old = original.items.find((item) => item.sourceId === a.sourceId);
    const changed = result.items.find((item) => item.sourceId === a.sourceId);
    expect(changed?.deduplicationKey).toBe(old?.deduplicationKey);
    expect(changed?.metadataHash).not.toBe(old?.metadataHash);
    expect(result.contradictionsGenerated).toBe(false);
  });

  it('does not permit changing the canonical URL for the same publisher item identity', () => {
    const known = decide();
    const old = known.items[0]!;
    expect(() => decide(sources, [{ ...a, canonicalUrl: a.canonicalUrl + '-different' }], [{
      sourceId: old.sourceId,
      sourceItemId: old.sourceItemId,
      canonicalUrl: old.canonicalUrl,
      metadataHash: old.metadataHash,
    }])).toThrow('METADATA_SOURCE_ID_URL_REASSIGNMENT_NEEDS_REVIEW');
  });

  it('requires explicit prior review, retention permission and robots approval', () => {
    expect(() => decide([{ ...sources[0]!, acquisitionApproved: false }], [a]))
      .toThrow('METADATA_SOURCE_POLICY_NOT_AUTHORIZED');
    expect(() => decide([{ ...sources[0]!, metadataRetentionApproved: false }], [a]))
      .toThrow('METADATA_SOURCE_POLICY_NOT_AUTHORIZED');
    expect(() => decide([{ ...sources[0]!, robotsAllowsPlannedPath: false }], [a]))
      .toThrow('METADATA_SOURCE_POLICY_NOT_AUTHORIZED');
  });

  it('fails closed when rights and robots reviews are stale, future or unverifiable', () => {
    expect(() => decide([{ ...sources[0]!, rightsReviewedAt: '2026-09-01T00:00:00.000Z' }], [a]))
      .toThrow('METADATA_POLICY_REVIEW_EXPIRED');
    expect(() => decide([{ ...sources[0]!, robotsCheckedAt: '2026-11-01T00:00:00.000Z' }], [a]))
      .toThrow('METADATA_POLICY_REVIEW_EXPIRED');
    expect(() => decide([{ ...sources[0]!, rightsEvidenceUrl: 'http://fake.example/policy' }], [a]))
      .toThrow('METADATA_RIGHTS_EVIDENCE_INVALID');
  });

  it('blocks SSRF-shaped policy origins and source-crossing URLs, no network call made', () => {
    expect(() => decide([{ ...sources[0]!, canonicalOrigin: 'https://127.0.0.1' }], [a]))
      .toThrow('METADATA_SOURCE_ORIGIN_INVALID');
    expect(() => decide([{ ...sources[0]!, canonicalOrigin: 'https://localhost' }], [a]))
      .toThrow('METADATA_SOURCE_ORIGIN_INVALID');
    expect(() => decide(sources, [{ ...a, canonicalUrl: 'https://agency-b.example/news/other' }]))
      .toThrow('METADATA_SOURCE_BOUNDARY_VIOLATION');
    expect(() => decide(sources, [{ ...a, canonicalUrl: 'https://agency-a.example@evil.example/news' }]))
      .toThrow('METADATA_CANONICAL_URL_INVALID');
  });

  it('rejects canonical query strings, anchors, credentials and unnormalized URLs', () => {
    for (const url of [
      a.canonicalUrl + '?utm_source=newsletter',
      a.canonicalUrl + '#story',
      'http://agency-a.example/news/article',
      'https://username:password@agency-a.example/news/article',
      'https://AGENCY-A.EXAMPLE/news/article',
    ]) {
      expect(() => decide(sources, [{ ...a, canonicalUrl: url }]))
        .toThrow('METADATA_CANONICAL_URL_INVALID');
    }
  });

  it('rejects duplicate items and duplicate canonical urls in a batch', () => {
    expect(() => decide(sources, [a, a])).toThrow('METADATA_ITEM_DUPLICATED_IN_BATCH');
    expect(() => decide(sources, [a, { ...a, sourceItemId: 'another-id' }]))
      .toThrow('METADATA_ITEM_DUPLICATED_IN_BATCH');
    expect(() => decide(sources, [a], [
      { sourceId: a.sourceId, sourceItemId: a.sourceItemId, canonicalUrl: a.canonicalUrl, metadataHash: '0'.repeat(64) },
      { sourceId: a.sourceId, sourceItemId: a.sourceItemId, canonicalUrl: a.canonicalUrl, metadataHash: '0'.repeat(64) },
    ])).toThrow('METADATA_PREVIOUS_STATE_DUPLICATE');
  });

  it('caps each source, the overall batch and policy count', () => {
    expect(() => decide([{ ...sources[0]!, maxItemsPerBatch: 1 }], [
      a, { ...a, sourceItemId: 'second', canonicalUrl: 'https://agency-a.example/news/second' },
    ])).toThrow('METADATA_SOURCE_BATCH_CAP_EXCEEDED');
    expect(() => decide(sources, Array.from({ length: 61 }, (_, i) => ({
      ...a, sourceItemId: 'item-' + i, canonicalUrl: 'https://agency-a.example/news/' + i,
    })))).toThrow('METADATA_STAGE_SCOPE_INVALID');
    expect(() => decide([...sources, sources[0]!], [a]))
      .toThrow('METADATA_DUPLICATE_SOURCE_POLICY');
  });

  it('rejects future or inconsistent timestamps and invalid headline text', () => {
    expect(() => decide(sources, [{ ...a, publishedAt: '2026-10-21T00:00:00.000Z' }]))
      .toThrow('METADATA_ITEM_DATE_OUT_OF_SCOPE');
    expect(() => decide(sources, [{ ...a, modifiedAt: '2026-10-18T00:00:00.000Z' }]))
      .toThrow('METADATA_ITEM_DATE_OUT_OF_SCOPE');
    expect(() => decide(sources, [{ ...a, publishedAt: '2026-10-19' }]))
      .toThrow('METADATA_PUBLICATION_DATE_INVALID');
    expect(() => decide(sources, [{ ...a, title: 'Noticia\nInyectada' }]))
      .toThrow('METADATA_ITEM_OUT_OF_SCOPE');
    expect(() => decide(sources, [{ ...a, title: '' }]))
      .toThrow('METADATA_ITEM_OUT_OF_SCOPE');
  });

  it('blocks unregistered sources, even when a candidate claims official provenance', () => {
    expect(() => decide([sources[0]!], [b])).toThrow('METADATA_ITEM_OUT_OF_SCOPE');
  });

  it('accepts two distinct publisher IDs only as a count, never as independently verified rights', () => {
    const result = decide();
    expect(result.distinctPublishers).toBe(2);
    expect(Object.keys(result)).not.toContain('legallyVerifiedSourceCount');
    expect(Object.keys(result)).not.toContain('validatedPublisherIndependence');
    expect(result.publicReleaseAuthority).toBe(false);
  });

  it('deterministic output is independent of input order at the same clock', () => {
    expect(decide(sources, [a, b])).toEqual(decide(sources, [b, a]));
  });
});
