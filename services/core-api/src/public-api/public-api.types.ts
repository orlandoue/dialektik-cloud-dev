export type AnalysisState = 'ANALYSIS_PENDING' | 'PUBLISHED';

export interface PublicPage<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
}

export interface EventCardDto {
  readonly id: string;
  readonly title_descriptive: string;
  readonly category: string;
  readonly detected_at: string;
  readonly analysis_state: AnalysisState;
  readonly source_count: number;
  readonly position_count: number | null;
}

export interface EventDetailDto extends EventCardDto {
  readonly window: Readonly<{ from: string; to: string | null }>;
  readonly primary_fact: PrimaryFactDto | null;
  readonly merged_into: null;
  readonly positions?: readonly Readonly<{ id: string; title: string; assertions: readonly Readonly<{
    id: string; assertion_text: string; quoted_text: string; article_id: string; source_name: string;
  }>[] }>[];
  readonly articles?: readonly Readonly<{ id: string; title: string; source_name: string; published_at: string; url: string }>[];
  readonly contrasts?: readonly Readonly<{ id: string; position_a_id: string; position_b_id: string; kind: string }>[];
}

export interface PrimaryFactDto {
  readonly statement: string;
  readonly primary_publication_url: string;
  readonly primary_source: Readonly<{
    id: string;
    name: string;
  }>;
}

export type EvidenceAbsence = 'no_evidence_yet' | 'inconclusive' | null;

export interface PositionListItemDto {
  readonly id: string;
  readonly ordinal: number;
  readonly total: number;
  readonly neutral_rank: number;
  readonly title: string;
  readonly published_at: string;
  readonly assertion_count: number;
  readonly formed_by_count: number;
  readonly evidence_absence: EvidenceAbsence;
  readonly evidence_absence_reason: string | null;
}

export interface PositionDetailDto extends PositionListItemDto {
  readonly source_count: number;
  readonly assertions: readonly PublicAssertionDto[];
  readonly formed_by: readonly FormedByDto[];
}

export interface FormedByDto {
  readonly relationship_id: string;
  readonly declared_by_display: 'equipo editorial';
  readonly declared_at: string;
}

export interface PublicAssertionDto {
  readonly id: string;
  readonly ordinal_in_span: number;
  readonly is_principal: boolean;
  readonly span: ClaimSpanDto;
  readonly epistemic_class: 'not_evaluable' | null;
  readonly epistemic_reason: string | null;
  readonly evidence_by_stance_for_assertion: null;
  readonly my_evaluation: null;
}

export interface ClaimSpanDto {
  readonly id: string;
  readonly quoted_text: string;
  readonly location: 'headline' | 'lede' | 'body' | 'caption';
  readonly attribution_chain: readonly AttributionDto[];
  readonly article: Readonly<{
    id: string;
    url_canonical: string;
    published_at: string;
    source: Readonly<{
      id: string;
      name: string;
      source_type: string;
    }>;
  }>;
  readonly captured_at: string;
  readonly highlight_ranges: readonly HighlightRangeDto[];
  readonly rectified: null;
}

export interface AttributionDto {
  readonly order: number;
  readonly attributor: string;
  readonly attributor_type: string;
}

export interface HighlightRangeDto {
  readonly start: number;
  readonly end: number;
  readonly assertion_id: string;
}

export interface RelationshipDto {
  readonly id: string;
  readonly rel_type: 'R01a' | 'R05' | 'R06' | 'R07' | 'R11a' | 'R11b';
  readonly scope: 'intra_event' | 'cross_event' | 'intra_article';
  readonly endpoints: readonly RelationshipEndpointDto[];
  readonly non_comparable_reason: string | null;
  readonly triggering_evidence_id: string | null;
  readonly rectified_by: 'SOURCE' | 'MODERATION' | null;
  readonly confirmed_at: string;
}

export interface RelationshipEndpointDto {
  readonly assertion_id: string;
  readonly role: 'peer' | 'source' | 'target';
}

export interface ContradictionDto {
  readonly id: string;
  readonly event_id: string;
  readonly event_title: string;
  readonly position_a: PositionReferenceDto;
  readonly position_b: PositionReferenceDto;
  readonly ratio: Readonly<{ conflicting: number; comparable: number }>;
  readonly threshold_rule: string;
  readonly confirmed_at: string;
  readonly needs_review: boolean;
}

export interface PositionReferenceDto {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
}

export interface SourceDto {
  readonly id: string;
  readonly name: string;
  readonly source_type: string;
}

export interface TombstoneDto {
  readonly operation: 'split' | 'merge' | 'absorbed' | 'rectification';
  readonly successors: readonly Readonly<{
    type: 'Event' | 'Position' | 'ClaimSpan' | 'ContradictionPublication';
    id: string;
    title?: string;
  }>[];
  readonly occurred_at: string;
  readonly reason: string;
}

export interface PublicReadResult<T> {
  readonly body: T;
  readonly lastModified: Date;
}
