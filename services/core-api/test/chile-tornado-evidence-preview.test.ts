import { describe, expect, it } from 'vitest';
import {
  CHILE_TORNADO_PREVIEW_KEY,
  chileTornadoEditorialPreview,
  editoriallyLinkTornadoDocuments,
  type CuratedEventEvidence,
} from '../src/live/chile-tornado-evidence-preview.js';

describe('Chile real-world multi-publisher occurrence: bounded editorial evidence', () => {
  const approved = chileTornadoEditorialPreview();
  it('connects exactly one location+date occurrence through four independent newsrooms and primary authority', () => {
    expect(approved.mode).toBe('CURATED_REAL_EVENT_EVIDENCE_PREVIEW');
    expect(approved.persisted).toBe(false);
    expect(approved.semantic_engine_executed).toBe(false);
    expect(approved.grouping_method).toBe('HUMAN_REVIEWED_FIXED_OCCURRENCE');
    expect(approved.category).toBe('País');
    expect(approved.source_count).toBe(5);
    expect(approved.independent_newsroom_count).toBe(4);
    expect(new Set(approved.publications.map((p) => p.publisher)).size).toBe(5);
    expect(new Set(approved.publications.map((p) => p.canonical_url)).size).toBe(5);
    expect(approved.publications.every((p) => new URL(p.canonical_url).protocol === 'https:')).toBe(true);
    expect(approved.publications.map((p) => p.published_on)).toEqual([
      '2026-10-14','2026-10-14','2026-10-13','2026-10-13','2026-10-13',
    ]);
  });
  it('rejects same-kind tornado from a different city or event date (negative pair)', () => {
    const documents = approved.publications.map((p) => ({
      publisher: p.publisher,
      publisherKind: p.publisher_kind,
      headline: p.headline,
      canonicalUrl: p.canonical_url,
      publishedOn: p.published_on,
      occurrenceKey: CHILE_TORNADO_PREVIEW_KEY,
    } satisfies CuratedEventEvidence));
    expect(() => editoriallyLinkTornadoDocuments([
      {...documents[0]!, canonicalUrl:'https://www.biobiochile.cl/noticias/nacional/region-del-bio-bio/2026/10/03/confirman-que-fenomeno-que-afecto-a-sector-de-mulchen-fue-un-tornado-alcanzo-hasta-los-137-km-h.shtml'},
      ...documents.slice(1),
    ])).toThrow('CURATED_PREVIEW_EVIDENCE_OUT_OF_SCOPE');
    expect(() => editoriallyLinkTornadoDocuments([
      {...documents[0]!, publishedOn:'2026-09-27'},
      ...documents.slice(1),
    ])).toThrow('CURATED_PREVIEW_EVIDENCE_OUT_OF_SCOPE');
  });
  it('rejects duplicated publisher; omitting government; invalid origin or unrelated event key', () => {
    const documents = approved.publications.map((p) => ({
      publisher:p.publisher, publisherKind:p.publisher_kind, headline:p.headline,
      canonicalUrl:p.canonical_url, publishedOn:p.published_on,
      occurrenceKey:CHILE_TORNADO_PREVIEW_KEY,
    } satisfies CuratedEventEvidence));
    expect(() => editoriallyLinkTornadoDocuments([documents[0]!,documents[0]!,documents[1]!]))
      .toThrow('CURATED_PREVIEW_EVIDENCE_OUT_OF_SCOPE');
    expect(() => editoriallyLinkTornadoDocuments(documents.filter(p=>p.publisherKind!=='PRIMARY_GOVERNMENT_SOURCE')))
      .toThrow('CURATED_PREVIEW_INDEPENDENCE_NOT_MET');
    expect(() => editoriallyLinkTornadoDocuments([
      {...documents[0]!, canonicalUrl:'http://www.t13.cl/noticia/nacional/not-real'},
      ...documents.slice(1),
    ])).toThrow('CURATED_PREVIEW_EVIDENCE_OUT_OF_SCOPE');
    expect(() => editoriallyLinkTornadoDocuments([
      {...documents[0]!, occurrenceKey:'editorial-preview:cl:mulchen:2026-09-27:ef0' as typeof CHILE_TORNADO_PREVIEW_KEY},
      ...documents.slice(1),
    ])).toThrow('CURATED_PREVIEW_EVIDENCE_OUT_OF_SCOPE');
  });
  it('keeps the response free from remote acquired Article, Event, body and inference artifacts', () => {
    const payload=JSON.stringify(approved);
    expect(payload).not.toMatch(/"body"|"article_id"|"event_id"|"semantic_score"|"fulltext"|"source_body"/);
    expect(payload).toContain('HUMAN_REVIEWED_FIXED_OCCURRENCE');
    expect(payload).toContain('No es un Event almacenado');
  });
});
