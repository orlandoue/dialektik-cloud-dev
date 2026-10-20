import { chileTornadoEditorialPreview } from './chile-tornado-evidence-preview.js';

/**
 * Read-only bridge between an EXISTING editorial occurrence preview and the
 * proposed typed evidence graph. This is deliberately NOT the Python ATTACK 7
 * predictor, and does not infer new occurrence identity or contradictions.
 */
type EditorialPreview = ReturnType<typeof chileTornadoEditorialPreview>;
type PreviewPublication = EditorialPreview['publications'][number];

type MentionKind =
  | 'CONFIRMATION_CUE'
  | 'RESCUE_CUE'
  | 'DAMAGE_ASSESSMENT_CUE'
  | 'PHYSICAL_PHENOMENON_CUE';

interface HeadlineMention {
  readonly evidence_id: string;
  readonly field: 'headline';
  readonly start: number;
  readonly end: number;
  readonly verbatim: string;
  readonly kind: MentionKind;
  readonly status: 'LEXICAL_HEADLINE_CUE_ONLY';
}

const CUES: readonly { readonly kind: MentionKind; readonly pattern: RegExp }[] = [
  { kind: 'CONFIRMATION_CUE', pattern: /confirma(?:n|do|ron)?|confirmó|confirmo/iu },
  { kind: 'RESCUE_CUE', pattern: /rescat(?:an|ar|e|ó|o)|atrapada/iu },
  { kind: 'DAMAGE_ASSESSMENT_CUE', pattern: /catastro|viviendas afectadas/iu },
  { kind: 'PHYSICAL_PHENOMENON_CUE', pattern: /tornado|tornádico|tornadico/iu },
];

function cuesForHeadline(
  publication: PreviewPublication,
  articleIndex: number,
): readonly HeadlineMention[] {
  const result: HeadlineMention[] = [];
  for (const cue of CUES) {
    const match = cue.pattern.exec(publication.headline);
    if (match === null || match.index < 0) continue;
    const start = match.index;
    const end = start + match[0].length;
    result.push(Object.freeze({
      evidence_id: `preview:${articleIndex}:${cue.kind}:${start}-${end}`,
      field: 'headline' as const,
      start,
      end,
      verbatim: publication.headline.slice(start, end),
      kind: cue.kind,
      status: 'LEXICAL_HEADLINE_CUE_ONLY' as const,
    }));
  }
  return Object.freeze(result.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind)));
}

export function chileTornadoEvidenceShadowPreview() {
  const editorial = chileTornadoEditorialPreview();
  // The source allowlist and occurrence editorial evidence were already
  // validated by chileTornadoEditorialPreview() and remain the ONLY input.
  const articles = editorial.publications.map((publication, index) => {
    const headlineCues = cuesForHeadline(publication, index);
    return Object.freeze({
      article_key: `editorial-source:${index}`,
      publisher: publication.publisher,
      publisher_kind: publication.publisher_kind,
      headline: publication.headline,
      canonical_url: publication.canonical_url,
      published_on: publication.published_on,
      event_time: null,
      event_time_status: 'NOT_INFERRED_FROM_PUBLICATION_DATE' as const,
      documentary_cues: headlineCues,
      extracted_claims: [] as readonly never[],
      inferred_contradictions: [] as readonly never[],
      externally_verified_action: false as const,
    });
  });

  return Object.freeze({
    mode: 'CURATED_OCCURRENCE_EVIDENCE_SHADOW' as const,
    linked_to_existing_event_preview: true as const,
    source_preview_mode: editorial.mode,
    original_grouping_method: editorial.grouping_method,
    preview_occurrence_key: editorial.id,
    occurred_on_editorial_only: editorial.occurred_on,
    occurrence_link_origin: 'HUMAN_REVIEWED_FIXED_OCCURRENCE' as const,
    evidence_engine: 'LEXICAL_SPAN_PROJECTION_NOT_ATTACK7_INFERENCE' as const,
    source_count: editorial.source_count,
    articles: Object.freeze(articles),
    nodes: Object.freeze([
      Object.freeze({
        id: editorial.id,
        kind: 'EDITORIAL_OCCURRENCE_PREVIEW' as const,
        authoritative_persisted_event: false as const,
      }),
      ...articles.flatMap((a) => [
        Object.freeze({
          id: a.article_key,
          kind: 'PUBLICATION_METADATA' as const,
          headline: a.headline,
          canonical_url: a.canonical_url,
          publisher: a.publisher,
        }),
        ...a.documentary_cues.map((cue) => Object.freeze({
          id: cue.evidence_id,
          kind: 'HEADLINE_DOCUMENTARY_CUE' as const,
          evidence: cue,
          verified_world_action: false as const,
        })),
      ]),
    ]),
    edges: Object.freeze(articles.flatMap((a) => [
      Object.freeze({
        from: a.article_key,
        to: editorial.id,
        kind: 'EDITORIALLY_LINKED_TO_PREVIEW' as const,
        semantic_model_link: false as const,
      }),
      ...a.documentary_cues.map((cue) => Object.freeze({
        from: a.article_key,
        to: cue.evidence_id,
        kind: 'HAS_HEADLINE_CUE' as const,
      })),
    ])),
    source_text_acquired: false as const,
    database_writes: 0 as const,
    persisted: false as const,
    semantic_engine_executed: false as const,
    production_permission: false as const,
    claim_extraction_performed: false as const,
    contradictions_detected: 0 as const,
    limitations: Object.freeze([
      'Existing occurrence membership was manually verified and is not newly inferred.',
      'Documentary cues are title matches only; a report about a rescue is not proof that a rescue occurred.',
      'Event-time and claim observation-as-of are not inferable from article publication dates.',
      'This endpoint is opt-in, authenticated, DEV/shadow only and never writes Article/Event/Claim.',
    ]),
  });
}
