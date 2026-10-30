import type {
  ArticleHashOnlyProjectionVersionTable,
  OfficialApiHashOnlyArticleTable,
  OfficialApiHashOnlyAcquisitionReceiptTable,
  OfficialApiHashOnlyArticleVersionTable,
  OfficialApiHashOnlyProjectionVersionTable,
  EventAnalystTitleOnlyShadowEnvelopeTable,
  LLMCloudflareProjectionRouteGrantTable,
  LLMCloudflareTitleOnlyAttemptReservationTable,
  LLMCloudflareTitleOnlyAttemptOutcomeTable,
  LLMProcessingRouteGrantTable,
  LLMShadowRunConfigurationTable,
  LLMShadowObservationTable,
  LLMShadowCallClaimTable,
  LLMShadowCallOutcomeTable,
  PersonalOwnerAuditEventTable,
  PersonalOwnerTestAuthorizationTable,
  PersonalOwnerTestJobEventTable,
  PersonalOwnerTestJobTable,
  PersonalOwnerTestJobRuntimeTable,
  PersonalOwnerTestJobLifecycleEventTable,
  PersonalOwnerTestShadowObservationTable,
} from './domain/llm-shadow.types';
import type {
  PersonalOwnerBudgetControlEventTable,
  PersonalOwnerBudgetControlTable,
  PersonalOwnerBudgetEventTable,
  PersonalOwnerBudgetReconciliationTable,
  PersonalOwnerNeuronReservationTable,
  PersonalOwnerNeuronEventTable,
  PersonalOwnerSourcePollStateTable,
  PersonalOwnerBudgetReservationTable,
  PersonalOwnerModelPriceTable,
  PersonalOwnerOperationalJobEventTable,
  PersonalOwnerOperationalJobTable,
  PersonalOwnerProviderAttemptTable,
  PersonalOwnerProviderAuthorizationTable,
  PersonalOwnerSourceConnectionTable,
  PersonalOwnerSourceRightsDecisionTable,
  PersonalOwnerOfficialVoteEvidenceTable,
  PersonalOwnerOfficialVoteOccurrenceTable,
  PersonalOwnerOfficialVoteObservationTable,
  PersonalOwnerOfficialVoteProvenanceTable,
} from './domain/personal-owner-operational.types';
import type { ColumnType } from 'kysely';

import type { Ulid } from './domain/ids';
import type {
  ProspectiveSemanticExperimentTable,
  ProspectiveSemanticReservationTable,
  ProspectiveSemanticOutcomeTable,
  ProspectiveContentRightsWriteGuardTable,
} from './domain/prospective-semantic.types';
import type {
  AcquisitionPacingReceiptTable,
  AcquisitionPacingObligationTable,
  AcquisitionRobotsObservationTable,
} from './domain/acquisition-pacing.types';
import type {
  ContentAccessPolicyTable,
  ObservedArticleContentVersionTable,
  SemanticProviderRunTable,
  SemanticProcessingRecordTable,
  SemanticProcessingFailureTable,
  SemanticEnvelopeTable,
  DerivedSemanticObservationTable,
  SemanticArticleProposalTable,
  SemanticCandidateApplicabilityTable,
  EvidenceFingerprintTable,
  SemanticRefetchVerificationTable,
  SemanticShadowGraphSnapshotTable,
  SemanticShadowGraphInputTable,
  SemanticShadowGraphOccurrenceTable,
  SemanticShadowGraphThreadTable,
  SemanticShadowGraphSealTable,
  SemanticContentWriteGuardTable,
  SemanticEvidenceQuoteReservationTable,
  SemanticNativeDiagnosticReceiptTable,
} from './domain/ephemeral-semantic.types';
import type {
  SemanticThreadTable,
  SemanticOccurrenceTable,
  SemanticObservationTable,
  SemanticMembershipTable,
  SemanticProvenanceTable,
  SemanticOccurrenceStateTable,
  SemanticThreadStateTable,
  SemanticRelationTable,
  SemanticTransitionTable,
} from './domain/semantic-shadow.types';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
export type ProductOrigin = 'FIXTURE' | 'STRESS_SYNTHETIC' | 'LIVE_REAL';
export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface TemporalScope {
  readonly from: JsonValue;
  readonly to: JsonValue;
  readonly granularity: JsonValue;
}

export type SourceType =
  | 'official_statistics'
  | 'wire_agency'
  | 'daily_newspaper'
  | 'digital_native'
  | 'radio'
  | 'tv'
  | 'other';
export type UserRole = 'user' | 'moderator' | 'editor' | 'system' | 'auditor';
export type AnalysisState = 'ANALYSIS_PENDING' | 'PUBLISHED';
export type ProcessingError = 'extraction_failed' | 'normalization_failed';

export type AssertionExtractionGenerationState = 'active' | 'superseded';
export type AssertionExtractionOutcome = 'proposed' | 'no_claim_worthy_content' | 'failed';
export type AssertionExtractionReprocessingStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed';
export type AssertionExtractionReprocessingJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';
export type SpanLocation = 'headline' | 'lede' | 'body' | 'caption';
export type AttributorType =
  | 'outlet'
  | 'person'
  | 'institution'
  | 'wire_agency'
  | 'automated_system';
export type AssertionType =
  | 'magnitude'
  | 'comparison'
  | 'temporal_sequence'
  | 'causal_claim'
  | 'valuation'
  | 'prediction'
  | 'attribution'
  | 'existence';
export type PersistedEpistemicClass = 'not_evaluable';
export type InterpretationCreator = 'system' | 'moderator';
export type PositionPublicationState = 'internal' | 'published' | 'superseded';
export type PositionLifecycleStatus = 'active' | 'merged' | 'split' | 'withdrawn';
export type AssertionLifecycleState = 'active' | 'invalidated' | 'withdrawn';
export type TopicStatus = 'active' | 'merged' | 'archived';
export type RelationshipType = 'R01a' | 'R01b' | 'R05' | 'R06' | 'R07' | 'R11a' | 'R11b';
export type RelationshipScope = 'intra_event' | 'cross_event' | 'intra_article';
export type RelationshipPublicationState = 'proposed' | 'published' | 'rejected';
export type RelationshipEndpointRole = 'source' | 'target' | 'peer';
export type RelationConfidence = 'low' | 'medium' | 'high';
export type SyndicationConfidence = 'low' | 'medium' | 'high';
export type IngestionProviderType = 'fixture' | 'rss_atom';
export type IngestionRunStatus = 'running' | 'succeeded' | 'partial' | 'failed';
export type IngestionItemStatus = 'discovered' | 'fetched' | 'persisted' | 'skipped' | 'failed';
export type IngestionErrorCategory =
  | 'provider_parse_error'
  | 'dns_error'
  | 'connect_timeout'
  | 'read_timeout'
  | 'http_client_error'
  | 'http_server_error'
  | 'blocked_or_disallowed'
  | 'unsupported_content_type'
  | 'response_too_large'
  | 'extraction_failed'
  | 'normalization_failed'
  | 'persistence_conflict'
  | 'unknown_internal_error';
export type SyndicationCandidateSignal = 'exact_content' | 'title_overlap' | 'declared_original';
export type SyndicationCandidateDirection = 'unknown' | 'a_to_b' | 'b_to_a';
export type SemanticEmbeddingStatus = 'succeeded' | 'failed';
export type SemanticProposalOutcome =
  | 'propose_existing_event'
  | 'propose_new_event'
  | 'ambiguous_review'
  | 'insufficient_signal'
  | 'defer_retry';
export type SemanticProposalState = 'active' | 'superseded' | 'retired';
export type SemanticReprocessingStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
export type SemanticReprocessingJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';
export type RectifiedBy = 'SOURCE' | 'MODERATION';
export type ContradictionPublicationState = 'published' | 'requires_review' | 'retracted';
export type EvidenceStance = 'supports' | 'contradicts' | 'contextualizes';
export type EvidencePublicationState = 'pending_review' | 'published' | 'rejected';
export type PositionEvidenceAbsence = 'no_evidence_yet' | 'inconclusive';
export type EvaluationClass =
  | 'well_supported'
  | 'insufficiently_supported'
  | 'challenged_by_evidence'
  | 'not_evaluable';
export type PositionTombstoneOperation = 'split' | 'merge' | 'absorbed';
export type ModerationTaskType =
  | 'equivalence_review'
  | 'relationship_confirmation'
  | 'projection_publication'
  | 'title_review'
  | 'evidence_approval'
  | 'merge_split_review'
  | 'projection_stale_review';
export type ModerationTaskState =
  | 'pending'
  | 'partially_accepted'
  | 'rejected'
  | 'escalated'
  | 'resolved';
export type ModerationReviewOutcome = 'accept_subset' | 'split';
export type ModerationReviewProposalState = 'submitted' | 'confirmed' | 'refused';
export type ModerationCommandType =
  | 'claim'
  | 'release'
  | 'reassign'
  | 'escalate'
  | 'submit_proposal'
  | 'confirm_proposal'
  | 'refuse_proposal';
export type ModerationTaskTargetType =
  | 'Event'
  | 'Position'
  | 'CandidateClass'
  | 'PositionRelationProjection';
export type CandidateClassState =
  | 'proposed'
  | 'partially_accepted'
  | 'accepted'
  | 'rejected'
  | 'superseded';
export type AssertionSimilarityInputProvenance = 'fixture_contract' | 'human_authored_contract';
export type AuditActorType = UserRole;
export type AuditActionType =
  | 'created'
  | 'metadata_updated'
  | 'confirmed'
  | 'dismissed'
  | 'published'
  | 'retracted'
  | 'merged'
  | 'split'
  | 'superseded'
  | 'invalidated'
  | 'membership_changed'
  | 'relationship_reclassified'
  | 'evidence_published'
  | 'evaluation_superseded'
  | 'moderation_decision'
  | 'withdrawn'
  | 'requires_review';

export interface UserTable {
  id: Ulid;
  role: UserRole;
  created_at: Timestamp;
}

export interface CategoryTable {
  id: Ulid;
  slug: string;
  sort_order: number;
  is_active: boolean;
  created_at: Timestamp;
}

export interface CategoryLocalizationTable {
  category_id: Ulid;
  locale: string;
  name: string;
}

export interface TopicTable {
  id: Ulid;
  canonical_slug: string;
  canonical_name: string;
  status: TopicStatus;
  merged_into_id: Ulid | null;
  created_at: Timestamp;
}

export interface SourceTable {
  origin: ColumnType<ProductOrigin, ProductOrigin | undefined, ProductOrigin>;
  id: Ulid;
  name: string;
  source_type: SourceType;
  is_issuing_entity: boolean;
  canonical_domain: string;
  created_at: Timestamp;
}

export interface EventTable {
  id: Ulid;
  origin: ColumnType<ProductOrigin | null, ProductOrigin | null | undefined, ProductOrigin | null>;
  title_descriptive: string;
  category_id: Ulid;
  window_from: Timestamp;
  window_to: NullableTimestamp;
  detected_at: Timestamp;
  analysis_state: AnalysisState;
  merged_into: Ulid | null;
  merged_by: Ulid | null;
  merged_at: NullableTimestamp;
}

export interface EventTopicTable {
  id: Ulid;
  event_id: Ulid;
  topic_id: Ulid;
  valid_from: Timestamp;
  valid_to: NullableTimestamp;
  reason_code: string;
  actor_id: Ulid | null;
  correlation_id: Ulid;
  recorded_at: Timestamp;
}

export interface ArticleTable {
  origin: ColumnType<ProductOrigin, ProductOrigin | undefined, ProductOrigin>;
  live_exposure_id: ColumnType<string | null, string | null | undefined, string | null>;
  id: Ulid;
  source_id: Ulid;
  event_id: Ulid | null;
  url_canonical: string;
  text_original: string;
  text_normalized: string;
  lang: string;
  published_at: Timestamp;
  captured_at: Timestamp;
  updated_at_source: NullableTimestamp;
  declares_wire: string | null;
  syndication_of: Ulid | null;
  syndication_confidence: SyndicationConfidence | null;
  clustering_score: number | null;
  processing_error: ProcessingError | null;
}

export interface ClaimSpanTable {
  id: Ulid;
  article_id: Ulid;
  text_offset_start: number;
  text_offset_end: number;
  quoted_text: string;
  location: SpanLocation;
  captured_at: Timestamp;
  primary_position_id: Ulid | null;
  tombstone_id: Ulid | null;
}

export interface AttributionChainTable {
  span_id: Ulid;
  order: number;
  attributor: string;
  attributor_type: AttributorType;
}

export interface AssertionTable {
  id: Ulid;
  claim_span_id: Ulid;
  ordinal: number;
  is_principal: boolean;
  assertion_type: AssertionType;
  subject_ref: string;
  temporal_scope: TemporalScope;
  population_scope: JsonValue | null;
  comparison_base: string | null;
  position_id: Ulid | null;
  epistemic_class: PersistedEpistemicClass | null;
  epistemic_reason: string | null;
  extraction_confidence: number;
  version: number;
  supersedes_id: Ulid | null;
  lineage_root_id: Ulid;
  lifecycle_state: AssertionLifecycleState;
}

export interface ClaimInterpretationTable {
  id: Ulid;
  assertion_id: Ulid;
  normalized_form: string;
  model_ref: string;
  model_version: string;
  content_hash: string;
  version: number;
  supersedes_id: Ulid | null;
  created_by: InterpretationCreator;
}

/**
 * Non-authoritative Phase 4 proposal snapshot. This is intentionally not a
 * second ClaimSpan/Assertion/ClaimInterpretation persistence model.
 */
export interface AssertionExtractionGenerationTable {
  id: Ulid;
  article_id: Ulid;
  input_hash: string;
  text_basis: 'article.text_original';
  offset_encoding: string;
  segmentation_version: string;
  provider_id: string;
  model_id: string;
  model_revision: string;
  config_version: string;
  schema_version: string;
  outcome: AssertionExtractionOutcome;
  failure_category: string | null;
  proposal_payload: JsonValue | null;
  proposal_hash: string | null;
  state: AssertionExtractionGenerationState;
  supersedes_id: Ulid | null;
  created_at: Timestamp;
  completed_at: Timestamp;
}

export interface AssertionExtractionReprocessingRunTable {
  id: Ulid;
  segmentation_version: string;
  provider_id: string;
  model_id: string;
  model_revision: string;
  config_version: string;
  schema_version: string;
  status: AssertionExtractionReprocessingStatus;
  completed_count: number;
  failed_count: number;
  created_at: Timestamp;
  started_at: NullableTimestamp;
  finished_at: NullableTimestamp;
}

export interface AssertionExtractionReprocessingJobTable {
  id: Ulid;
  run_id: Ulid;
  article_id: Ulid;
  state: AssertionExtractionReprocessingJobState;
  attempt_count: number;
  error_category: string | null;
  error_detail: string | null;
  queued_at: Timestamp;
  started_at: NullableTimestamp;
  finished_at: NullableTimestamp;
}

export interface PositionTable {
  id: Ulid;
  event_id: Ulid;
  neutral_rank: number | null;
  title_text: string;
  title_edited_by: Ulid | null;
  title_edited_at: NullableTimestamp;
  title_previous: string | null;
  publication_state: PositionPublicationState;
  published_at: NullableTimestamp;
  published_by: Ulid | null;
  tombstone_id: Ulid | null;
  status: PositionLifecycleStatus;
}

export interface PositionTitleGeneratedFromTable {
  position_id: Ulid;
  assertion_id: Ulid;
  ordinal: number;
}

export interface PositionFormedByTable {
  position_id: Ulid;
  relationship_id: Ulid;
  ordinal: number;
}

export interface RelationshipTable {
  id: Ulid;
  rel_type: RelationshipType;
  event_id: Ulid;
  scope: RelationshipScope;
  publication_state: RelationshipPublicationState;
  confidence: RelationConfidence | null;
  similarity_score: number | null;
  declared_by: Ulid | null;
  confirmed_by: Ulid | null;
  confirmed_at: NullableTimestamp;
  non_comparable_reason: string | null;
  triggering_evidence_id: Ulid | null;
  rectified_by: RectifiedBy | null;
  moderation_proposal_id: ColumnType<Ulid | null, Ulid | null | undefined, Ulid | null>;
}

export interface RelationshipEndpointTable {
  relationship_id: Ulid;
  assertion_id: Ulid;
  role: RelationshipEndpointRole;
  endpoint_order: 1 | 2;
}

export interface ContradictionPublicationTable {
  id: Ulid;
  event_id: Ulid;
  position_a_id: Ulid;
  position_b_id: Ulid;
  projection_hash: string;
  ratio_conflicting_at_publication: number;
  ratio_comparable_at_publication: number;
  threshold_rule_at_publication: string;
  confirmed_by: Ulid;
  confirmed_at: Timestamp;
  publication_state: ContradictionPublicationState;
  retracted_by: Ulid | null;
  retracted_at: NullableTimestamp;
  retraction_reason: string | null;
}

export interface PrimaryFactTable {
  id: Ulid;
  event_id: Ulid;
  statement: string;
  primary_publication_url: string;
  primary_source_id: Ulid;
  klass: 'observed';
}

export interface EvidenceTable {
  id: Ulid;
  anchor_span_id: Ulid;
  scope_assertion_id: Ulid;
  stance: EvidenceStance;
  summary: string;
  citable_source_url: string | null;
  citable_source_title: string | null;
  contributed_by: Ulid | null;
  publication_state: EvidencePublicationState;
  approved_by: Ulid | null;
  approved_at: NullableTimestamp;
  relevance: number;
  supersedes_id: Ulid | null;
}

export interface EvidenceAssessmentTable {
  id: Ulid;
  assertion_id: Ulid;
  assessment: 'inconclusive';
  rationale: string | null;
  confirmed_by: Ulid;
  confirmed_at: Timestamp;
  supersedes_id: Ulid | null;
  created_at: Timestamp;
}

export interface AssertionPositionMembershipHistoryTable {
  id: Ulid;
  assertion_id: Ulid;
  position_id: Ulid | null;
  valid_from: Timestamp;
  valid_to: NullableTimestamp;
  reason_code: string;
  actor_id: Ulid | null;
  correlation_id: Ulid;
  recorded_at: Timestamp;
}

export interface CandidateClassTable {
  id: Ulid;
  event_id: Ulid;
  model_ref: string;
  model_version: string;
  created_at: Timestamp;
  state: CandidateClassState;
  origin_proposal_id: ColumnType<Ulid | null, Ulid | null | undefined, Ulid | null>;
}

export interface CandidateClassMemberTable {
  candidate_class_id: Ulid;
  assertion_id: Ulid;
}

export interface AssertionSimilarityRunTable {
  id: Ulid;
  event_id: Ulid;
  input_fingerprint: string;
  input_provenance: AssertionSimilarityInputProvenance;
  embedding_provider_id: string;
  embedding_model_id: string;
  embedding_model_version: string;
  similarity_policy_version: string;
  candidate_policy_version: string;
  similarity_threshold: number;
  relation_confidence: RelationConfidence;
  interpretation_count: number;
  relationship_count: number;
  candidate_class_count: number;
  created_at: Timestamp;
}

export interface AssertionSimilarityRunRelationshipTable {
  run_id: Ulid;
  relationship_id: Ulid;
}

export interface AssertionSimilarityRunCandidateClassTable {
  run_id: Ulid;
  candidate_class_id: Ulid;
}

export interface UserEvaluationTable {
  id: Ulid;
  assertion_id: Ulid;
  user_id: Ulid;
  klass: EvaluationClass;
  attached_evidence_id: Ulid | null;
  created_at: Timestamp;
  supersedes_id: Ulid | null;
}

export interface PositionTombstoneTable {
  id: Ulid;
  position_id: Ulid;
  operation: PositionTombstoneOperation;
  reason: string;
  actor_id: Ulid;
  occurred_at: Timestamp;
}

export interface PositionTombstoneSuccessorTable {
  tombstone_id: Ulid;
  successor_position_id: Ulid;
  ordinal: number;
}

export interface SpanTombstoneTable {
  id: Ulid;
  span_id: Ulid;
  successor_span_id: Ulid;
  rectified_by: RectifiedBy;
  occurred_at: Timestamp;
}

export interface ModerationTaskTable {
  id: Ulid;
  task_type: ModerationTaskType;
  target_type: ModerationTaskTargetType;
  target_id: Ulid | null;
  state: ModerationTaskState;
  priority: number;
  assigned_to: Ulid | null;
  created_at: Timestamp;
  resolved_at: NullableTimestamp;
  resolution_reason: string | null;
  projection_event_id: Ulid | null;
  projection_position_a_id: Ulid | null;
  projection_position_b_id: Ulid | null;
  projection_hash: string | null;
  origin_proposal_id: ColumnType<Ulid | null, Ulid | null | undefined, Ulid | null>;
}

export interface ModerationAuthSessionTable {
  id: Ulid;
  user_id: Ulid;
  token_hash: string;
  created_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: NullableTimestamp;
}

export interface ModerationReviewProposalTable {
  id: Ulid;
  task_id: Ulid;
  candidate_class_id: Ulid;
  outcome: ModerationReviewOutcome;
  proposer_id: Ulid;
  single_editor_authorization_id: ColumnType<Ulid | null, Ulid | null | undefined, Ulid | null>;
  payload_hash: string;
  state: ModerationReviewProposalState;
  submitted_at: Timestamp;
  decided_by: Ulid | null;
  decided_at: NullableTimestamp;
  decision_reason: string | null;
}

export interface ModerationReviewProposalMemberTable {
  proposal_id: Ulid;
  assertion_id: Ulid;
  partition_ordinal: number | null;
}

export interface ModerationCommandReceiptTable {
  actor_id: Ulid;
  task_id: Ulid;
  command_id: Ulid;
  command_type: ModerationCommandType;
  payload_hash: string;
  response_payload: JsonValue;
  created_at: Timestamp;
}

export interface AuditEntryTable {
  id: Ulid;
  occurred_at: Timestamp;
  actor_type: AuditActorType;
  actor_id: Ulid | null;
  action_type: AuditActionType;
  entity_type: string;
  entity_id: string;
  correlation_id: Ulid;
  reason_code: string | null;
  before_hash: string | null;
  after_hash: string | null;
  metadata: JsonValue;
}

export interface IngestionSourceConfigTable {
  id: Ulid;
  source_id: Ulid;
  provider_type: IngestionProviderType;
  feed_url: string;
  config_metadata: JsonValue;
  is_enabled: boolean;
  poll_interval_seconds: number;
  cursor: string | null;
  cursor_updated_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface IngestionRunTable {
  id: Ulid;
  source_config_id: Ulid;
  status: IngestionRunStatus;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
  discovered_count: number;
  persisted_count: number;
  skipped_count: number;
  failed_count: number;
  candidate_count: number;
  error_category: IngestionErrorCategory | null;
}

export interface IngestionItemTable {
  id: Ulid;
  source_config_id: Ulid;
  identity_key: string;
  provider_item_id: string | null;
  discovered_url: string;
  canonical_url: string;
  title: string | null;
  author: string | null;
  published_at: NullableTimestamp;
  updated_at_source: NullableTimestamp;
  declares_wire: string | null;
  declared_original_url: string | null;
  provider_payload_hash: string;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  status: IngestionItemStatus;
  article_id: Ulid | null;
  error_category: IngestionErrorCategory | null;
}

export interface IngestionRunItemTable {
  run_id: Ulid;
  ingestion_item_id: Ulid;
  status: IngestionItemStatus;
  attempt_count: number;
  article_id: Ulid | null;
  error_category: IngestionErrorCategory | null;
}

export interface FetchAttemptTable {
  id: Ulid;
  run_id: Ulid;
  ingestion_item_id: Ulid;
  attempt_number: number;
  requested_url: string;
  final_url: string | null;
  fetched_at: Timestamp;
  http_status: number | null;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  response_bytes: number | null;
  response_body_hash: string | null;
  extraction_version: string | null;
  normalization_version: string | null;
  error_category: IngestionErrorCategory | null;
  error_detail: string | null;
}

export interface ArticleContentFingerprintTable {
  article_id: Ulid;
  normalized_content_hash: string;
  normalization_version: string;
  created_at: Timestamp;
}

export interface SyndicationCandidateTable {
  id: Ulid;
  article_a_id: Ulid;
  article_b_id: Ulid;
  signal: SyndicationCandidateSignal;
  direction: SyndicationCandidateDirection;
  confidence: SyndicationConfidence;
  created_at: Timestamp;
  metadata: JsonValue;
}

export interface ArticleRepresentationTable {
  id: Ulid;
  article_id: Ulid;
  representation_version: string;
  input_hash: string;
  title: string;
  body: string;
  language: string | null;
  published_at: NullableTimestamp;
  canonical_text: string;
  created_at: Timestamp;
}

export interface ArticleEmbeddingTable {
  id: Ulid;
  article_id: Ulid;
  representation_id: Ulid;
  representation_version: string;
  config_version: string;
  input_hash: string;
  provider_id: string;
  model_id: string;
  model_version: string;
  dimensions: number;
  vector: readonly number[] | null;
  status: SemanticEmbeddingStatus;
  error_category: string | null;
  error_detail: string | null;
  generated_at: Timestamp;
}

export interface EventIntelligenceProposalTable {
  id: Ulid;
  article_id: Ulid;
  representation_id: Ulid;
  embedding_id: Ulid | null;
  policy_version: string;
  feature_version: string;
  model_version: string | null;
  outcome: SemanticProposalOutcome;
  state: SemanticProposalState;
  candidate_event_id: Ulid | null;
  proposed_event_key: string | null;
  score_internal: number | null;
  reason_codes: JsonValue;
  feature_snapshot: JsonValue;
  supersedes_id: Ulid | null;
  correlation_id: Ulid | null;
  created_at: Timestamp;
}

export interface EventIntelligenceFeatureTable {
  id: Ulid;
  article_id: Ulid;
  event_id: Ulid;
  proposal_id: Ulid | null;
  representation_id: Ulid;
  embedding_id: Ulid | null;
  feature_version: string;
  embedding_cosine: number | null;
  title_lexical_similarity: number | null;
  body_lexical_similarity: number | null;
  entity_overlap: number;
  publication_delta_seconds: number | null;
  event_recency_seconds: number | null;
  active_window_compatibility: number;
  language_compatibility: number;
  syndication_relation: boolean;
  syndicated_signal_cap: number;
  embedding_error: string | null;
  representation_input_hash: string | null;
  embedding_input_hash: string | null;
  features: JsonValue;
  created_at: Timestamp;
}

export interface EventIntelligenceProposalCandidateTable {
  proposal_id: Ulid;
  event_id: Ulid;
  rank: number;
  internal_score: number | null;
  feature_id: Ulid | null;
  retrieval_metadata: JsonValue;
  created_at: Timestamp;
}

export interface SemanticReprocessingRunTable {
  id: Ulid;
  representation_version: string;
  representation_config_version: string | null;
  embedding_provider_id: string | null;
  embedding_model_id: string;
  embedding_model_version: string;
  embedding_config_version: string | null;
  clustering_config_version: string;
  status: SemanticReprocessingStatus;
  requested_count: number;
  completed_count: number;
  failed_count: number;
  requested_at: Timestamp;
  started_at: NullableTimestamp;
  finished_at: NullableTimestamp;
}

export interface SemanticReprocessingJobTable {
  id: Ulid;
  run_id: Ulid;
  article_id: Ulid;
  state: SemanticReprocessingJobState;
  attempt_count: number;
  error_category: string | null;
  error_detail: string | null;
  queued_at: Timestamp;
  started_at: NullableTimestamp;
  finished_at: NullableTimestamp;
}

export interface LiveSourcePolicyTable {
  id: string;
  source_id: Ulid;
  registry_key: string;
  rights_class: string;
  storage_policy: string;
  active: boolean;
  rights_evidence_url: string;
  rights_verified_at: Timestamp;
  policy: JsonValue;
  recorded_at: Timestamp;
}

export interface LiveExposureExclusionTable {
  id: string;
  registry_key: string;
  publisher_name: string;
  canonical_url: string | null;
  source_item_id: string | null;
  published_at: NullableTimestamp;
  first_seen_at: Timestamp;
  discovery_url: string | null;
  reason: string;
  content_hash: string | null;
  near_duplicate_signature: string | null;
  exclusion_status: ColumnType<string, string | undefined, string>;
}

export interface LiveAcquisitionReceiptTable {
  id: Ulid;
  source_id: Ulid;
  policy_id: string;
  exclusion_id: string;
  discovery_channel: string;
  discovery_channel_detail: string | null;
  discovery_url: string;
  discovered_url: string | null;
  canonical_url: string | null;
  source_item_id: string | null;
  published_at: NullableTimestamp;
  modified_at: NullableTimestamp;
  original_published_at: string | null;
  original_modified_at: string | null;
  seen_at: Timestamp;
  raw_payload_hash: string;
  adapter_version: string;
  disposition: 'PERSISTED' | 'QUARANTINED';
  error_code: string | null;
}

export interface LiveArticleVersionTable {
  id: Ulid;
  article_id: Ulid;
  receipt_id: Ulid;
  version_number: number;
  metadata_hash: string;
  headline: string;
  excerpt: string | null;
  author: string | null;
  published_at: Timestamp;
  modified_at: NullableTimestamp;
  declared_upstream: string | null;
  content_hash: string | null;
  near_duplicate_signature: string | null;
  recorded_at: Timestamp;
}

export interface Database {
  official_api_hash_only_acquisition_receipts: OfficialApiHashOnlyAcquisitionReceiptTable;
  official_api_hash_only_articles: OfficialApiHashOnlyArticleTable;
  official_api_hash_only_article_versions: OfficialApiHashOnlyArticleVersionTable;
  official_api_hash_only_projection_versions: OfficialApiHashOnlyProjectionVersionTable;
  article_hash_only_projection_versions: ArticleHashOnlyProjectionVersionTable;
  event_analyst_title_only_shadow_envelopes: EventAnalystTitleOnlyShadowEnvelopeTable;
  llm_cloudflare_projection_route_grants: LLMCloudflareProjectionRouteGrantTable;
  llm_cloudflare_title_only_attempt_reservations: LLMCloudflareTitleOnlyAttemptReservationTable;
  llm_cloudflare_title_only_attempt_outcomes: LLMCloudflareTitleOnlyAttemptOutcomeTable;
  llm_processing_route_grants: LLMProcessingRouteGrantTable;
  llm_shadow_run_configurations: LLMShadowRunConfigurationTable;
  llm_shadow_observations: LLMShadowObservationTable;
  llm_shadow_call_claims: LLMShadowCallClaimTable;
  llm_shadow_call_outcomes: LLMShadowCallOutcomeTable;
  personal_owner_audit_events: PersonalOwnerAuditEventTable;
  personal_owner_source_rights_decisions: PersonalOwnerSourceRightsDecisionTable;
  personal_owner_model_prices: PersonalOwnerModelPriceTable;
  personal_owner_budget_controls: PersonalOwnerBudgetControlTable;
  personal_owner_budget_control_events: PersonalOwnerBudgetControlEventTable;
  personal_owner_operational_jobs: PersonalOwnerOperationalJobTable;
  personal_owner_operational_job_events: PersonalOwnerOperationalJobEventTable;
  personal_owner_budget_reservations: PersonalOwnerBudgetReservationTable;
  personal_owner_budget_events: PersonalOwnerBudgetEventTable;
  personal_owner_budget_reconciliations: PersonalOwnerBudgetReconciliationTable;
  personal_owner_neuron_reservations: PersonalOwnerNeuronReservationTable;
  personal_owner_neuron_events: PersonalOwnerNeuronEventTable;
  personal_owner_source_poll_state: PersonalOwnerSourcePollStateTable;
  personal_owner_source_connections: PersonalOwnerSourceConnectionTable;
  personal_owner_official_vote_evidence: PersonalOwnerOfficialVoteEvidenceTable;
  personal_owner_official_vote_occurrences: PersonalOwnerOfficialVoteOccurrenceTable;
  personal_owner_official_vote_observations: PersonalOwnerOfficialVoteObservationTable;
  personal_owner_official_vote_provenance: PersonalOwnerOfficialVoteProvenanceTable;
  personal_owner_provider_authorizations: PersonalOwnerProviderAuthorizationTable;
  personal_owner_provider_attempts: PersonalOwnerProviderAttemptTable;
  personal_owner_test_authorizations: PersonalOwnerTestAuthorizationTable;
  personal_owner_test_jobs: PersonalOwnerTestJobTable;
  personal_owner_test_job_runtime: PersonalOwnerTestJobRuntimeTable;
  personal_owner_test_job_lifecycle_events: PersonalOwnerTestJobLifecycleEventTable;
  personal_owner_test_job_events: PersonalOwnerTestJobEventTable;
  personal_owner_test_shadow_observations: PersonalOwnerTestShadowObservationTable;
  acquisition_pacing_receipts: AcquisitionPacingReceiptTable;
  acquisition_pacing_obligations: AcquisitionPacingObligationTable;
  acquisition_robots_observations: AcquisitionRobotsObservationTable;
  semantic_native_diagnostic_receipts: SemanticNativeDiagnosticReceiptTable;
  content_access_policies: ContentAccessPolicyTable;
  prospective_semantic_experiments: ProspectiveSemanticExperimentTable;
  prospective_semantic_reservations: ProspectiveSemanticReservationTable;
  prospective_semantic_outcomes: ProspectiveSemanticOutcomeTable;
  prospective_content_rights_write_guards: ProspectiveContentRightsWriteGuardTable;
  observed_article_content_versions: ObservedArticleContentVersionTable;
  semantic_provider_runs: SemanticProviderRunTable;
  semantic_processing_records: SemanticProcessingRecordTable;
  semantic_processing_failures: SemanticProcessingFailureTable;
  semantic_envelopes: SemanticEnvelopeTable;
  derived_semantic_observations: DerivedSemanticObservationTable;
  semantic_article_proposals: SemanticArticleProposalTable;
  semantic_candidate_applicability: SemanticCandidateApplicabilityTable;
  evidence_fingerprints: EvidenceFingerprintTable;
  semantic_refetch_verifications: SemanticRefetchVerificationTable;
  semantic_shadow_graph_snapshots: SemanticShadowGraphSnapshotTable;
  semantic_shadow_graph_inputs: SemanticShadowGraphInputTable;
  semantic_shadow_graph_occurrences: SemanticShadowGraphOccurrenceTable;
  semantic_shadow_graph_threads: SemanticShadowGraphThreadTable;
  semantic_shadow_graph_seals: SemanticShadowGraphSealTable;
  semantic_content_write_guards: SemanticContentWriteGuardTable;
  semantic_evidence_quote_reservations: SemanticEvidenceQuoteReservationTable;
  live_source_policies: LiveSourcePolicyTable;
  live_exposure_exclusions: LiveExposureExclusionTable;
  live_acquisition_receipts: LiveAcquisitionReceiptTable;
  live_article_versions: LiveArticleVersionTable;
  semantic_event_threads: SemanticThreadTable;
  semantic_occurrences: SemanticOccurrenceTable;
  semantic_observations: SemanticObservationTable;
  semantic_memberships: SemanticMembershipTable;
  semantic_provenance: SemanticProvenanceTable;
  semantic_occurrence_states: SemanticOccurrenceStateTable;
  semantic_thread_states: SemanticThreadStateTable;
  semantic_relations: SemanticRelationTable;
  semantic_state_transitions: SemanticTransitionTable;
  users: UserTable;
  categories: CategoryTable;
  category_localizations: CategoryLocalizationTable;
  topics: TopicTable;
  sources: SourceTable;
  events: EventTable;
  event_topics: EventTopicTable;
  articles: ArticleTable;
  claim_spans: ClaimSpanTable;
  attribution_chain: AttributionChainTable;
  assertions: AssertionTable;
  claim_interpretations: ClaimInterpretationTable;
  assertion_extraction_generations: AssertionExtractionGenerationTable;
  assertion_extraction_reprocessing_runs: AssertionExtractionReprocessingRunTable;
  assertion_extraction_reprocessing_jobs: AssertionExtractionReprocessingJobTable;
  positions: PositionTable;
  position_title_generated_from: PositionTitleGeneratedFromTable;
  position_formed_by: PositionFormedByTable;
  relationships: RelationshipTable;
  relationship_endpoints: RelationshipEndpointTable;
  contradiction_publications: ContradictionPublicationTable;
  primary_facts: PrimaryFactTable;
  evidence: EvidenceTable;
  evidence_assessments: EvidenceAssessmentTable;
  assertion_position_membership_history: AssertionPositionMembershipHistoryTable;
  candidate_classes: CandidateClassTable;
  candidate_class_members: CandidateClassMemberTable;
  assertion_similarity_runs: AssertionSimilarityRunTable;
  assertion_similarity_run_relationships: AssertionSimilarityRunRelationshipTable;
  assertion_similarity_run_candidate_classes: AssertionSimilarityRunCandidateClassTable;
  user_evaluations: UserEvaluationTable;
  position_tombstones: PositionTombstoneTable;
  position_tombstone_successors: PositionTombstoneSuccessorTable;
  span_tombstones: SpanTombstoneTable;
  moderation_tasks: ModerationTaskTable;
  moderation_auth_sessions: ModerationAuthSessionTable;
  moderation_review_proposals: ModerationReviewProposalTable;
  moderation_review_proposal_members: ModerationReviewProposalMemberTable;
  moderation_command_receipts: ModerationCommandReceiptTable;
  audit_entries: AuditEntryTable;
  ingestion_source_configs: IngestionSourceConfigTable;
  ingestion_runs: IngestionRunTable;
  ingestion_items: IngestionItemTable;
  ingestion_run_items: IngestionRunItemTable;
  fetch_attempts: FetchAttemptTable;
  article_content_fingerprints: ArticleContentFingerprintTable;
  syndication_candidates: SyndicationCandidateTable;
  article_representations: ArticleRepresentationTable;
  article_embeddings: ArticleEmbeddingTable;
  event_intelligence_proposals: EventIntelligenceProposalTable;
  event_intelligence_features: EventIntelligenceFeatureTable;
  event_intelligence_proposal_candidates: EventIntelligenceProposalCandidateTable;
  semantic_reprocessing_runs: SemanticReprocessingRunTable;
  semantic_reprocessing_jobs: SemanticReprocessingJobTable;
}

export type DatabaseName = keyof Database;
