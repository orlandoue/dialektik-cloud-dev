import type { Timestamp, NullableTimestamp } from '../database.types';
import type { Ulid } from './ids';

export type ShadowDecision = 'MATCH' | 'DISTINCT' | 'UNKNOWN';
export type ShadowApplicability = 'APPLICABLE' | 'INAPPLICABLE' | 'UNKNOWN_APPLICABILITY';
export interface SemanticThreadTable {
  id: Ulid;
  title: string;
  summary: string;
  mode: 'fixture';
  created_at: Timestamp;
}
export interface SemanticOccurrenceTable {
  id: Ulid;
  event_id: Ulid;
  thread_id: Ulid;
  title: string;
  event_at: NullableTimestamp;
  created_at: Timestamp;
}
export interface SemanticObservationTable {
  id: Ulid;
  provider: 'fixture';
  provider_version: string;
  idempotency_key: string;
  payload_hash: string;
  article_id: Ulid;
  occurrence_id: Ulid;
  thread_id: Ulid;
  decision: ShadowDecision;
  applicability: ShadowApplicability;
  rationale: string;
  observed_at: Timestamp;
}
export interface SemanticMembershipTable {
  id: Ulid;
  observation_id: Ulid;
  article_id: Ulid;
  occurrence_id: Ulid;
  thread_id: Ulid;
  decision: ShadowDecision;
  applicability: ShadowApplicability;
  observed_at: Timestamp;
}
export interface SemanticProvenanceTable {
  id: Ulid;
  observation_id: Ulid;
  article_id: Ulid;
  source_id: Ulid;
  span_id: Ulid | null;
  assertion_id: Ulid | null;
}
export interface SemanticStateTable {
  id: Ulid;
  revision: number;
  previous_state_id: Ulid | null;
  description: string;
  decision: ShadowDecision;
  applicability: ShadowApplicability;
  observation_id: Ulid;
  observed_at: Timestamp;
}
export interface SemanticOccurrenceStateTable extends SemanticStateTable {
  occurrence_id: Ulid;
}
export interface SemanticThreadStateTable extends SemanticStateTable {
  thread_id: Ulid;
}
export interface SemanticRelationTable {
  id: Ulid;
  observation_id: Ulid;
  from_occurrence_id: Ulid;
  to_occurrence_id: Ulid;
  decision: ShadowDecision;
  applicability: ShadowApplicability;
}
export interface SemanticTransitionTable {
  id: Ulid;
  entity_kind: 'occurrence' | 'thread';
  occurrence_state_id: Ulid | null;
  thread_state_id: Ulid | null;
  observation_id: Ulid;
  observed_at: Timestamp;
}
