import type { ColumnType } from 'kysely';

import type { NullableTimestamp, Timestamp } from '../database.types';
import type { Ulid } from './ids';
import type { ShadowApplicability, ShadowDecision } from './semantic-shadow.types';

export type ContentAccessMode =
  | 'METADATA_ONLY'
  | 'EXCERPT_EPHEMERAL'
  | 'FULLTEXT_EPHEMERAL'
  | 'FULLTEXT_PERSISTED';
export type SemanticProcessingState =
  | 'NOT_ELIGIBLE'
  | 'ELIGIBLE_UNPROCESSED'
  | 'PROCESSING'
  | 'PROCESSED_SHADOW'
  | 'PROCESSING_FAILED';
export type SemanticReproducibilityClass =
  | 'FULL_REPLAYABLE'
  | 'HASH_VERIFIABLE_REFETCH_REQUIRED'
  | 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE';
export type SemanticRefetchStatus = 'HASH_MATCH' | 'SOURCE_VERSION_CHANGED' | 'SOURCE_UNAVAILABLE';
export type SemanticProcessingErrorCode =
  | 'RIGHTS_DENIED'
  | 'ACQUISITION_FAILED'
  | 'PARSE_FAILED'
  | 'NORMALIZATION_FAILED'
  | 'INPUT_INVALID'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_FAILED'
  | 'MAPPING_FAILED'
  | 'PERSISTENCE_FAILED';

/** Each permission is independent. An absent grant is false, never inferred. */
export interface ContentAccessPolicyTable {
  id: string;
  source_id: Ulid;
  content_access_mode: ColumnType<
    ContentAccessMode,
    ContentAccessMode | undefined,
    ContentAccessMode
  >;
  metadata_storage: ColumnType<boolean, boolean | undefined, boolean>;
  excerpt_storage: ColumnType<boolean, boolean | undefined, boolean>;
  fulltext_acquisition: ColumnType<boolean, boolean | undefined, boolean>;
  fulltext_machine_processing: ColumnType<boolean, boolean | undefined, boolean>;
  fulltext_persistence: ColumnType<boolean, boolean | undefined, boolean>;
  derived_semantic_persistence: ColumnType<boolean, boolean | undefined, boolean>;
  minimal_evidence_fragment: ColumnType<boolean, boolean | undefined, boolean>;
  redisplay: ColumnType<boolean, boolean | undefined, boolean>;
  external_source_link: ColumnType<boolean, boolean | undefined, boolean>;
  local_processing: ColumnType<boolean, boolean | undefined, boolean>;
  external_ai_transmission: ColumnType<boolean, boolean | undefined, boolean>;
  rights_evidence_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  personal_owner_source_rights_decision_id: ColumnType<
    Ulid | null,
    Ulid | null | undefined,
    Ulid | null
  >;
  evidence_quote_max_codepoints: ColumnType<number, number | undefined, number>;
  rights_evidence_url: string;
  rights_verified_at: Timestamp;
  recorded_at: Timestamp;
}

/** Exact full-text observation; Article identity and RSS metadata history stay separate. */
export interface ObservedArticleContentVersionTable {
  id: Ulid;
  article_id: Ulid;
  source_id: Ulid;
  policy_id: string;
  previous_version_id: Ulid | null;
  version_number: number;
  canonical_url: string;
  publisher_item_id: string | null;
  original_title: string | null;
  published_at: Timestamp;
  available_at: Timestamp;
  modified_at: NullableTimestamp;
  acquired_at: Timestamp;
  language: string | null;
  content_encoding: 'utf-8';
  acquired_content_hash: string;
  normalized_input_hash: string;
  title_input_hash: string;
  normalization_version: string;
  input_codepoint_length: number;
  title_codepoint_length: number;
  persisted_body: string | null;
  recorded_at: Timestamp;
}

export interface SemanticProviderRunTable {
  id: Ulid;
  provider_type: string;
  provider_version: string;
  candidate_commit: ColumnType<string | null, string | null | undefined, string | null>;
  runtime_python: ColumnType<string | null, string | null | undefined, string | null>;
  runtime_model: ColumnType<string | null, string | null | undefined, string | null>;
  run_identity: string;
  input_provenance: 'AUTHORED_STUB' | 'LIVE_REAL';
  created_at: Timestamp;
}

export interface SemanticProcessingRecordTable {
  id: Ulid;
  article_version_id: Ulid;
  provider_run_id: Ulid;
  previous_record_id: Ulid | null;
  sequence_number: number;
  processing_state: SemanticProcessingState;
  error_code: SemanticProcessingErrorCode | null;
  recorded_at: Timestamp;
}

/** A failed attempt declaration is not a provider execution receipt. */
export interface SemanticProcessingFailureTable {
  id: Ulid;
  article_id: Ulid;
  source_id: Ulid;
  policy_id: string;
  provider_type: string;
  provider_version: string;
  run_identity: string;
  input_provenance: 'AUTHORED_STUB' | 'LIVE_REAL';
  error_code: SemanticProcessingErrorCode;
  acquired_content_hash: string | null;
  normalized_input_hash: string | null;
  title_input_hash: string | null;
  failed_at: Timestamp;
}

export interface SemanticEnvelopeTable {
  id: Ulid;
  article_version_id: Ulid;
  normalized_input_hash: string;
  normalization_version: string;
  provider_type: string;
  provider_version: string;
  provider_run_id: Ulid;
  reproducibility_class: SemanticReproducibilityClass;
  authority: 'SHADOW_NOT_AUTHORITATIVE';
  processed_at: Timestamp;
}

/** No arbitrary payload or inferred canonical entity. These remain shadow proposals. */
export interface DerivedSemanticObservationTable {
  id: Ulid;
  envelope_id: Ulid;
  observation_key: string;
  decision: ShadowDecision;
  applicability: ShadowApplicability;
  proposed_occurrence_key: string | null;
  proposed_thread_key: string | null;
}

export type SemanticArticleProposalAction =
  | 'update_occurrence'
  | 'new_occurrence_in_existing_thread'
  | 'new_thread'
  | 'ambiguous';
export type SemanticArticleProposalReason =
  | 'no_bounded_occurrence_observation'
  | 'multi_observation_article_requires_decomposition'
  | 'multiple_identity_matches'
  | 'occurrence_thread_incompatibility'
  | 'no_automatic_occurrence_reparent'
  | 'unique_occurrence_match'
  | 'thread_match_all_children_distinct'
  | 'occurrence_identity_unknown'
  | 'thread_identity_unknown'
  | 'unresolved_prior_thread_comparison'
  | 'unresolved_prior_occurrence_comparison'
  | 'grounded_process_distinct_from_all_prior'
  | 'llm_grounded_same_occurrence'
  | 'llm_grounded_same_thread'
  | 'llm_bounded_singleton'
  | 'llm_abstention';

export interface SemanticArticleProposalTable {
  id: Ulid;
  envelope_id: Ulid;
  article_version_id: Ulid;
  provider_run_id: Ulid;
  action: SemanticArticleProposalAction;
  reason_code: SemanticArticleProposalReason;
  proposed_occurrence_key: string | null;
  proposed_thread_key: string | null;
  partial_occurrence_creation: boolean;
}

/** Applicability can exist without any identity comparison or fabricated decision. */
export interface SemanticCandidateApplicabilityTable {
  id: Ulid;
  envelope_id: Ulid;
  article_version_id: Ulid;
  provider_run_id: Ulid;
  scope: 'OCCURRENCE' | 'THREAD';
  target_key: string;
  outcome: ShadowApplicability;
}

export interface EvidenceFingerprintTable {
  id: Ulid;
  envelope_id: Ulid;
  article_version_id: Ulid;
  provider_run_id: Ulid;
  /** Legacy SQL name; acquiredContentHash, SHA256 of whole response bytes. */
  input_hash: string;
  /** normalizedInputHash, SHA256 of the exact normalized original body field. */
  normalized_input_hash: string;
  normalization_version: string;
  field: 'title' | 'excerpt' | 'body';
  field_hash: string;
  span_start: number;
  span_end: number;
  span_hash: string;
  context_hash: string | null;
  retained_quote: string | null;
  /** Internal serialized quota slot; the trigger assigns it, never the provider. */
  quote_budget_start: ColumnType<number | null, number | null | undefined, number | null>;
}

/** Changes append a finding. Historical envelopes and locators are never rewritten. */
export interface SemanticRefetchVerificationTable {
  id: Ulid;
  article_version_id: Ulid;
  expected_input_hash: string;
  expected_title_hash: string;
  refetched_input_hash: string | null;
  refetched_title_hash: string | null;
  normalization_version: string;
  source_version_status: SemanticRefetchStatus;
  reproducibility_class: SemanticReproducibilityClass;
  verified_at: Timestamp;
}

/** Actual native graph output; memberships remain proposal identities. */
export interface SemanticShadowGraphSnapshotTable {
  id: Ulid;
  provider_run_id: Ulid;
  authority: 'SHADOW_NOT_AUTHORITATIVE';
  article_decisions_hash: string;
  occurrence_memberships_hash: string;
  thread_memberships_hash: string;
  occurrence_generations_hash: string;
  thread_generations_hash: string;
  candidate_applicability_hash: string;
  recorded_at: Timestamp;
}
export interface SemanticShadowGraphInputTable {
  snapshot_id: Ulid;
  article_version_id: Ulid;
  envelope_id: Ulid;
}
export interface SemanticShadowGraphOccurrenceTable {
  snapshot_id: Ulid;
  occurrence_key: string;
  thread_key: string | null;
  article_ids: Ulid[];
  generation_hash: string;
}
export interface SemanticShadowGraphThreadTable {
  snapshot_id: Ulid;
  thread_key: string;
  occurrence_keys: string[];
  article_ids: Ulid[];
  generation_hash: string;
}
export interface SemanticShadowGraphSealTable {
  snapshot_id: Ulid;
  sealed_at: Timestamp;
}
/** Internal technical row-version guards, independent of semantic processing state. */
export interface SemanticContentWriteGuardTable {
  scope_kind: 'ENVELOPE' | 'PROVIDER_RUN' | 'GRAPH';
  scope_id: Ulid;
  write_number: ColumnType<string, string | undefined, string>;
  sealed: ColumnType<boolean, boolean | undefined, boolean>;
}
/** Internal immutable quote-prefix reservation across identical body versions. */
export interface SemanticEvidenceQuoteReservationTable {
  fingerprint_id: Ulid;
  article_id: Ulid;
  normalized_input_hash: string;
  budget_start: number;
  codepoint_length: number;
}

/** Canonical rights-redacted native output accounting, prospectively append-only. */
export interface SemanticNativeDiagnosticReceiptTable {
  provider_run_id: Ulid;
  snapshot_id: Ulid;
  canonical_receipt: string;
  canonical_sha256: string;
  native_output_sha256: string;
  projection_sha256: string;
  recorded_at: Timestamp;
}
