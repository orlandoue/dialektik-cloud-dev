import { afterEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';

import { chileTornadoEvidenceShadowPreview } from '../src/live/chile-evidence-shadow-preview.js';
import { chileTornadoEditorialPreview } from '../src/live/chile-tornado-evidence-preview.js';
import { PrivateBetaLiveController } from '../src/live/private-beta-live.controller.js';

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  SUPABASE_AUTH_ISSUER: process.env.SUPABASE_AUTH_ISSUER,
  DIALEKTIK_EVIDENCE_SHADOW_DEPLOYMENT: process.env.DIALEKTIK_EVIDENCE_SHADOW_DEPLOYMENT,
  DIALEKTIK_CHILE_EVENT_PREVIEW_ENABLED: process.env.DIALEKTIK_CHILE_EVENT_PREVIEW_ENABLED,
  DIALEKTIK_EVIDENCE_SHADOW_ENABLED: process.env.DIALEKTIK_EVIDENCE_SHADOW_ENABLED,
};
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Private beta shadow uses existing curated event without authorizing persistence', () => {
  it('projects exactly the same five verified editorial source URLs, not synthetic articles', () => {
    const original = chileTornadoEditorialPreview();
    const projected = chileTornadoEvidenceShadowPreview();
    expect(projected.preview_occurrence_key).toBe(original.id);
    expect(projected.occurrence_link_origin).toBe('HUMAN_REVIEWED_FIXED_OCCURRENCE');
    expect(projected.original_grouping_method).toBe(original.grouping_method);
    expect(projected.mode).toBe('CURATED_OCCURRENCE_EVIDENCE_SHADOW');
    expect(projected.evidence_engine).toBe('LEXICAL_SPAN_PROJECTION_NOT_ATTACK7_INFERENCE');
    expect(projected.source_count).toBe(5);
    expect(projected.articles.map(a => a.canonical_url)).toEqual(original.publications.map(a => a.canonical_url));
    expect(new Set(projected.articles.map(a => a.publisher)).size).toBe(5);
    expect(projected.nodes.filter(a => a.kind === 'PUBLICATION_METADATA')).toHaveLength(5);
    expect(projected.edges.filter(a => a.kind === 'EDITORIALLY_LINKED_TO_PREVIEW')).toHaveLength(5);
  });

  it('ties each lexical cue to the exact publisher headline with correct Unicode offsets', () => {
    const projected = chileTornadoEvidenceShadowPreview();
    expect(projected.articles.some(a => a.documentary_cues.some(c => c.kind === 'CONFIRMATION_CUE'))).toBe(true);
    expect(projected.articles.some(a => a.documentary_cues.some(c => c.kind === 'RESCUE_CUE'))).toBe(true);
    expect(projected.articles.some(a => a.documentary_cues.some(c => c.kind === 'DAMAGE_ASSESSMENT_CUE'))).toBe(true);
    for (const article of projected.articles) {
      for (const cue of article.documentary_cues) {
        expect(article.headline.slice(cue.start, cue.end)).toBe(cue.verbatim);
        expect(cue.field).toBe('headline');
        expect(cue.status).toBe('LEXICAL_HEADLINE_CUE_ONLY');
      }
    }
  });

  it('never infers a new occurrence, event time, numerical claim or contradiction', () => {
    const result = chileTornadoEvidenceShadowPreview();
    expect(result.source_text_acquired).toBe(false);
    expect(result.database_writes).toBe(0);
    expect(result.persisted).toBe(false);
    expect(result.semantic_engine_executed).toBe(false);
    expect(result.production_permission).toBe(false);
    expect(result.claim_extraction_performed).toBe(false);
    expect(result.contradictions_detected).toBe(0);
    expect(result.articles.every(a => a.event_time === null && !a.externally_verified_action)).toBe(true);
    expect(result.articles.every(a => a.extracted_claims.length === 0 &&
                                      a.inferred_contradictions.length === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/"source_body"|"article_id"|"event_id"|"fulltext"|"semantic_score"/u);
  });

  it('is fail-closed unless DEV issuer, explicit DEV deployment marker and both flags match', () => {
    const controller = new PrivateBetaLiveController({} as never);
    process.env.NODE_ENV = 'production'; // Render DEV runs compiled production Node.
    delete process.env.SUPABASE_AUTH_ISSUER;
    delete process.env.DIALEKTIK_EVIDENCE_SHADOW_DEPLOYMENT;
    delete process.env.DIALEKTIK_CHILE_EVENT_PREVIEW_ENABLED;
    delete process.env.DIALEKTIK_EVIDENCE_SHADOW_ENABLED;
    expect(() => controller.chileTornadoEvidenceShadow()).toThrow(NotFoundException);
    process.env.DIALEKTIK_CHILE_EVENT_PREVIEW_ENABLED = 'true';
    process.env.DIALEKTIK_EVIDENCE_SHADOW_ENABLED = 'true';
    expect(() => controller.chileTornadoEvidenceShadow()).toThrow(NotFoundException);
    process.env.DIALEKTIK_EVIDENCE_SHADOW_DEPLOYMENT = 'dev';
    expect(() => controller.chileTornadoEvidenceShadow()).toThrow(NotFoundException);
    process.env.SUPABASE_AUTH_ISSUER = 'https://some-production-project.supabase.co/auth/v1';
    expect(() => controller.chileTornadoEvidenceShadow()).toThrow(NotFoundException);
    process.env.SUPABASE_AUTH_ISSUER = 'https://vclsswwfhljczxgnsciq.supabase.co/auth/v1';
    expect(controller.chileTornadoEvidenceShadow().source_count).toBe(5);
    process.env.DIALEKTIK_EVIDENCE_SHADOW_DEPLOYMENT = 'production';
    expect(() => controller.chileTornadoEvidenceShadow()).toThrow(NotFoundException);
  });

  it('does not change the original endpoint contract, preview list, source links or flags', () => {
    const original = chileTornadoEditorialPreview();
    expect(original.mode).toBe('CURATED_REAL_EVENT_EVIDENCE_PREVIEW');
    expect(original.semantic_engine_executed).toBe(false);
    expect(original.persisted).toBe(false);
    expect(original.source_count).toBe(5);
    expect(original.publications.every(a => new URL(a.canonical_url).protocol === 'https:')).toBe(true);
  });
});
