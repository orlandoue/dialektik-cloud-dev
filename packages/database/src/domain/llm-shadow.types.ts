import type { ColumnType } from 'kysely';
import type { Ulid } from './ids';
type Json = ColumnType<unknown, unknown, unknown>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
export interface LLMProcessingRouteGrantTable {
  id: Ulid;
  source_id: Ulid;
  article_id: Ulid | null;
  policy_id: string;
  provider_type: 'llm_gemini' | 'llm_cloudflare_workers_ai' | 'authored_stub';
  processing_route: 'EXTERNAL_LLM_PROCESSING_ALLOWED' | 'LOCAL_ONLY_PROCESSING' | 'NOT_ALLOWED';
  fulltext_acquisition: boolean;
  machine_processing: boolean;
  derived_persistence: boolean;
  fulltext_persistence: boolean;
  evidence_fragments: boolean;
  rights_receipt_sha256: string;
  recorded_at: Timestamp;
}
export interface ArticleHashOnlyProjectionVersionTable {
  id: Ulid;
  source_id: Ulid;
  article_id: Ulid;
  policy_id: string;
  previous_version_id: Ulid | null;
  version_number: number;
  acquired_content_sha256: string;
  source_body_sha256: string;
  normalized_body_sha256: string;
  title_sha256: string;
  normalization_version: string;
  projection_policy_version: string;
  projection_sha256: string;
  evidence_manifest_sha256: string;
  acquisition_receipt_sha256: string;
  rights_receipt_sha256: string;
  local_authorization_receipt_sha256: string;
  attribution_sha256: string;
  recorded_at: Timestamp;
}
export interface OfficialApiHashOnlyArticleTable {
  article_id: Ulid;
  source_id: Ulid;
  receipt_id: Ulid;
  exclusion_id: string;
  content_policy_id: string;
  recorded_at: Timestamp;
}
export interface OfficialApiHashOnlyAcquisitionReceiptTable {
  id: Ulid;
  source_id: Ulid;
  article_id: Ulid;
  source_policy_id: string;
  content_policy_id: string;
  exclusion_id: string;
  source_item_exclusion_id: string;
  content_exclusion_id: string;
  title_exclusion_id: string;
  discovery_channel: 'official_api';
  discovery_url: string;
  canonical_url: string;
  source_item_id: string;
  published_at: Timestamp;
  first_available_at: Timestamp;
  modified_at: Timestamp | null;
  acquired_at: Timestamp;
  acquired_content_sha256: string;
  source_body_sha256: string;
  normalized_body_sha256: string;
  title_sha256: string;
  source_receipt_sha256: string;
  acquisition_manifest_sha256: string;
  evidence_manifest_sha256: string;
  rights_receipt_sha256: string;
  local_authorization_receipt_sha256: string;
  attribution_sha256: string;
  robots_sha256: string;
}
export interface OfficialApiHashOnlyArticleVersionTable {
  id: Ulid;
  article_id: Ulid;
  source_id: Ulid;
  receipt_id: Ulid;
  content_policy_id: string;
  previous_version_id: Ulid | null;
  version_number: number;
  published_at: Timestamp;
  first_available_at: Timestamp;
  modified_at: Timestamp | null;
  acquired_at: Timestamp;
  language: string | null;
  content_encoding: 'utf-8';
  acquired_content_sha256: string;
  source_body_sha256: string;
  normalized_body_sha256: string;
  title_sha256: string;
  normalization_version: string;
  input_codepoint_length: number;
  title_codepoint_length: number;
  recorded_at: Timestamp;
}
export interface OfficialApiHashOnlyProjectionVersionTable {
  id: Ulid;
  source_id: Ulid;
  article_id: Ulid;
  article_version_id: Ulid;
  receipt_id: Ulid;
  policy_id: string;
  previous_version_id: Ulid | null;
  version_number: number;
  acquired_content_sha256: string;
  source_body_sha256: string;
  normalized_body_sha256: string;
  title_sha256: string;
  normalization_version: string;
  projection_policy_version: string;
  projection_sha256: string;
  evidence_manifest_sha256: string;
  acquisition_receipt_sha256: string;
  rights_receipt_sha256: string;
  local_authorization_receipt_sha256: string;
  attribution_sha256: string;
  recorded_at: Timestamp;
}
export interface LLMCloudflareProjectionRouteGrantTable {
  decision_sequence: ColumnType<string, never, never>;
  id: Ulid;
  decision_scope: 'EXTERNAL_INFERENCE' | 'DERIVED_SHADOW_PERSISTENCE';
  decision_status: 'APPROVED' | 'REVOKED';
  source_id: Ulid;
  route_kind: ColumnType<
    'CANONICAL_ARTICLE' | 'OFFICIAL_API_HASH_ONLY_TITLE',
    'CANONICAL_ARTICLE' | 'OFFICIAL_API_HASH_ONLY_TITLE' | undefined,
    'CANONICAL_ARTICLE' | 'OFFICIAL_API_HASH_ONLY_TITLE'
  >;
  article_id: Ulid | null;
  article_version_id: Ulid | null;
  projection_version_id: Ulid | null;
  hash_only_article_id: ColumnType<Ulid | null, Ulid | null | undefined, Ulid | null>;
  hash_only_article_version_id: ColumnType<Ulid | null, Ulid | null | undefined, Ulid | null>;
  hash_only_projection_version_id: ColumnType<Ulid | null, Ulid | null | undefined, Ulid | null>;
  policy_id: string;
  acquired_content_sha256: string;
  projection_policy_version: string;
  projection_sha256: string;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: '@cf/openai/gpt-oss-20b';
  fulltext_persistence: false;
  source_fulltext_retained: false;
  projection_text_retained: false;
  prompt_retained: false;
  raw_response_retained: false;
  quoted_source_text_retained: false;
  attribution_required: true;
  attribution_sha256: string;
  rights_receipt_sha256: string;
  controller_decision_sha256: string;
  cloudflare_terms_receipt_sha256: string;
  operator_authorization_sha256: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  approval_bundle_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  controller_signer_id: ColumnType<string | null, string | null | undefined, string | null>;
  controller_key_fingerprint_sha256: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  controller_signature_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  operator_signer_id: ColumnType<string | null, string | null | undefined, string | null>;
  operator_key_fingerprint_sha256: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  operator_signature_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  authorization_expires_at: ColumnType<
    Date | null,
    Date | string | null | undefined,
    Date | string | null
  >;
  authorized_request_count: ColumnType<number | null, number | null | undefined, number | null>;
  recorded_at: Timestamp;
}
export interface LLMCloudflareTitleOnlyAttemptReservationTable {
  id: Ulid;
  route_grant_id: Ulid;
  approval_bundle_sha256: string;
  run_id: string;
  source_id: Ulid;
  article_id: Ulid;
  article_version_id: Ulid;
  projection_version_id: Ulid;
  projection_sha256: string;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: '@cf/openai/gpt-oss-20b';
  reserved_at: Timestamp;
}
export interface LLMCloudflareTitleOnlyAttemptOutcomeTable {
  reservation_id: Ulid;
  outcome_state: 'RESPONSE_RECEIVED' | 'UNKNOWN_SENT';
  http_status: number | null;
  latency_ms: number;
  error_category: string | null;
  recorded_at: Timestamp;
}
/** Hash-only, title-projection Event Analyst derivatives. No source or projection text is stored. */
export interface EventAnalystTitleOnlyShadowEnvelopeTable {
  id: Ulid;
  source_id: Ulid;
  article_id: Ulid;
  article_version_id: Ulid;
  projection_version_id: Ulid;
  provider_run_id: Ulid;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: '@cf/openai/gpt-oss-20b';
  projection_policy_version: string;
  acquired_content_sha256: string;
  projection_sha256: string;
  title_sha256: string;
  schema_sha256: string;
  skill_sha256: string;
  derivative_sha256: string;
  event_candidate: 'TRUE' | 'FALSE' | 'UNCERTAIN';
  applicability: 'OBSERVATION_AVAILABLE' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE' | 'AMBIGUOUS';
  event_nugget_count: number;
  fact_count: number;
  grounded_fact_count: number;
  unsupported_fact_count: number;
  valid_evidence_reference_count: number;
  invalid_evidence_reference_count: number;
  semantic_derivatives: Json;
  evidence_locators: Json;
  recorded_at: Timestamp;
}
export interface LLMShadowRunConfigurationTable {
  provider_run_id: Ulid;
  config_hash: string;
  configuration: Json;
  input_manifest: Json;
  purpose: 'PRODUCT_DEVELOPMENT';
  mode: 'LLM_SEMANTIC_SHADOW';
  recorded_at: Timestamp;
}
export interface LLMShadowObservationTable {
  envelope_id: Ulid;
  cache_key: string;
  config_hash: string;
  structured_output: Json;
  recorded_at: Timestamp;
}
export interface LLMShadowCallClaimTable {
  call_key: string;
  provider_run_id: Ulid;
  article_id: Ulid;
  stage: 'extraction' | 'relation';
  claimed_at: Timestamp;
}
export interface LLMShadowCallOutcomeTable {
  call_key: string;
  outcome: 'RESPONSE_RECEIVED' | 'FAILED';
  recorded_at: Timestamp;
}
export interface PersonalOwnerAuditEventTable {
  id: Ulid;
  owner_identity: string;
  event_type:
    | 'OWNER_STATUS_VIEWED'
    | 'SOURCE_REGISTERED'
    | 'RIGHTS_DECISION_RECORDED'
    | 'MODEL_PRICE_RECORDED'
    | 'SOURCE_CONNECTION_RECORDED'
    | 'PROVIDER_AUTHORIZATION_RECORDED'
    | 'SOURCE_ACQUISITION_COMPLETED'
    | 'OPERATIONAL_JOB_SUBMITTED'
    | 'OPERATIONAL_JOB_CANCELLED'
    | 'BUDGET_RECONCILED'
    | 'OFFICIAL_EVENT_ACQUIRED'
    | 'PROVIDER_AUTO_SUSPENDED';
  request_fingerprint_sha256: string;
  recorded_at: Timestamp;
}
export interface PersonalOwnerTestAuthorizationTable {
  id: Ulid;
  owner_identity: string;
  source_id: Ulid;
  article_id: Ulid;
  article_version_id: Ulid;
  projection_version_id: Ulid;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: '@cf/openai/gpt-oss-20b';
  operation: 'MOCKED_TITLE_ONLY_INFERENCE' | 'MOCKED_DERIVED_SHADOW_PERSISTENCE';
  environment_scope: 'ISOLATED_TEST_ONLY';
  authorization_artifact_sha256: string;
  decision_status: 'APPROVED' | 'REVOKED';
  valid_from: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  recorded_at: Timestamp;
}
export interface PersonalOwnerTestJobTable {
  id: Ulid;
  owner_identity: string;
  idempotency_key: string;
  inference_authorization_id: Ulid;
  persistence_authorization_id: Ulid;
  source_id: Ulid;
  article_id: Ulid;
  article_version_id: Ulid;
  projection_version_id: Ulid;
  projection_sha256: string;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: '@cf/openai/gpt-oss-20b';
  request_fingerprint_sha256: string;
  environment_scope: 'ISOLATED_TEST_ONLY';
  created_at: Timestamp;
}
export interface PersonalOwnerTestJobEventTable {
  id: Ulid;
  job_id: Ulid;
  sequence_number: number;
  state: 'RESERVED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  observation_id: Ulid | null;
  error_category: string | null;
  recorded_at: Timestamp;
}
export type PersonalOwnerTestJobRuntimeState =
  | 'PENDING'
  | 'RUNNING'
  | 'RECOVERABLE'
  | 'RECONCILIATION_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type PersonalOwnerTestJobLifecycleState =
  | PersonalOwnerTestJobRuntimeState
  | 'PROVIDER_REQUEST_STARTED';

export interface PersonalOwnerTestJobRuntimeTable {
  job_id: Ulid;
  state: PersonalOwnerTestJobRuntimeState;
  attempt_count: number;
  safe_recovery_count: number;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  heartbeat_at: Timestamp | null;
  provider_request_started_at: Timestamp | null;
  completed_at: Timestamp | null;
  error_category: string | null;
  updated_at: Timestamp;
}

export interface PersonalOwnerTestJobLifecycleEventTable {
  id: Ulid;
  job_id: Ulid;
  sequence_number: number;
  state: PersonalOwnerTestJobLifecycleState;
  worker_id: string | null;
  attempt_count: number;
  error_category: string | null;
  recorded_at: Timestamp;
}
export interface PersonalOwnerTestShadowObservationTable {
  id: Ulid;
  job_id: Ulid;
  source_id: Ulid;
  article_id: Ulid;
  article_version_id: Ulid;
  projection_version_id: Ulid;
  provider_run_id: string;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: '@cf/openai/gpt-oss-20b';
  projection_sha256: string;
  schema_sha256: string;
  skill_sha256: string;
  derivative_sha256: string;
  applicability: 'OBSERVATION_AVAILABLE' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE' | 'AMBIGUOUS';
  event_nugget_count: number;
  fact_count: number;
  grounded_fact_count: number;
  unsupported_fact_count: number;
  valid_evidence_reference_count: number;
  invalid_evidence_reference_count: number;
  semantic_derivatives: Json;
  evidence_locators: Json;
  recorded_at: Timestamp;
}
