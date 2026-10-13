import type { Ulid } from '@dialektik/database';

export type SemanticDecisionStatus = 'MATCH' | 'DISTINCT' | 'UNKNOWN';
export type SemanticApplicability = 'APPLICABLE' | 'INAPPLICABLE' | 'UNKNOWN_APPLICABILITY';
export type SemanticMode = 'disabled' | 'fixture';
export interface SemanticState {
  readonly description: string;
  readonly decision: SemanticDecisionStatus;
  readonly applicability: SemanticApplicability;
}
export interface OccurrenceState extends SemanticState {
  readonly id: string;
  readonly revision: number;
  readonly previousStateId: string | null;
  readonly observedAt: string;
}
export type EventThreadState = OccurrenceState;
export interface SemanticObservation {
  readonly id: Ulid;
  readonly idempotencyKey: string;
  readonly provider: string;
  readonly providerVersion: string;
  readonly articleId: Ulid;
  readonly occurrenceId: Ulid;
  readonly threadId: Ulid;
  readonly occurrenceTitle: string;
  readonly threadTitle: string;
  readonly threadSummary: string;
  readonly eventAt: string | null;
  readonly observedAt: string;
  readonly occurrenceState: SemanticState;
  readonly threadState: SemanticState;
  readonly rationale: string;
  readonly relation: Readonly<{
    targetOccurrenceId: Ulid;
    decision: SemanticDecisionStatus;
    applicability: SemanticApplicability;
  }> | null;
}
export interface SemanticObservationProvider<
  Input = SafeSemanticArticle,
  Output = SemanticObservation,
> {
  readonly name: string;
  readonly version: string;
  observe(article: Input, signal?: AbortSignal): Promise<Output>;
}
export interface SafeSemanticArticle {
  readonly id: Ulid;
  readonly canonicalUrl: string;
  readonly originalText: string;
}
export interface SemanticSource {
  readonly id: string;
  readonly name: string;
  readonly canonicalDomain: string;
}
export interface SemanticArticle {
  readonly id: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly source: SemanticSource;
  readonly decision: SemanticDecisionStatus;
  readonly applicability: SemanticApplicability;
}
export interface SemanticMembership {
  readonly observationId: string;
  readonly threadId: string;
  readonly occurrenceId: string;
  readonly articleId: string;
  readonly decision: SemanticDecisionStatus;
  readonly applicability: SemanticApplicability;
  readonly observedAt: string;
}
export interface SemanticRelation {
  readonly id: string;
  readonly fromOccurrenceId: string;
  readonly toOccurrenceId: string;
  readonly fromTitle: string;
  readonly toTitle: string;
  readonly decision: SemanticDecisionStatus;
  readonly applicability: SemanticApplicability;
  readonly provenanceId: string;
}
export interface SemanticProvenance {
  readonly id: string;
  readonly article: SemanticArticle;
  readonly provider: string;
  readonly providerVersion: string;
  readonly observedAt: string;
  readonly rationale: string;
  readonly spanId: string | null;
  readonly assertionId: string | null;
}
export interface Occurrence {
  readonly id: string;
  readonly eventId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly title: string;
  readonly eventAt: string | null;
  readonly state: OccurrenceState;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly articles: readonly SemanticArticle[];
  readonly sources: readonly SemanticSource[];
  readonly provenance: readonly SemanticProvenance[];
  readonly relations: readonly SemanticRelation[];
}
export interface EventThread {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly mode: 'fixture';
  readonly state: EventThreadState;
  readonly occurrenceCount: number;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly firstObserved: string;
  readonly lastObserved: string;
}
export interface SemanticStateTransition {
  readonly id: string;
  readonly entityKind: 'occurrence' | 'thread';
  readonly occurrenceId: string | null;
  readonly previousState: SemanticState | null;
  readonly newState: SemanticState;
  readonly observedAt: string;
  readonly provenanceId: string;
}
export interface ThreadTimeline {
  readonly occurrences: readonly Occurrence[];
  readonly arrivals: readonly SemanticMembership[];
  readonly transitions: readonly SemanticStateTransition[];
}
export interface ThreadDetail extends EventThread {
  readonly occurrences: readonly Occurrence[];
  readonly sources: readonly SemanticSource[];
  readonly relations: readonly SemanticRelation[];
}
