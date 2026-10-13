import type { ColumnType } from 'kysely';
import type { Timestamp } from '../database.types';
import type { Ulid } from './ids';

export type PersonalOwnerDecisionStatus = 'UNVERIFIED' | 'AUTHORIZED' | 'SUSPENDED' | 'REVOKED';
export interface PersonalOwnerSourceRightsDecisionTable {
  id: Ulid;
  owner_identity: string;
  source_id: Ulid;
  sequence_number: number;
  publisher_identity: string;
  acquisition_method: string;
  rights_evidence_url: string | null;
  rights_evidence_sha256: string | null;
  scopes: unknown;
  local_processing: boolean;
  attribution: string | null;
  restrictions: unknown;
  decision_status: PersonalOwnerDecisionStatus;
  decision_provenance: string;
  valid_from: Timestamp;
  expires_at: Timestamp | null;
  recorded_at: Timestamp;
}

export type PersonalOwnerPriceStatus = 'UNVERIFIED' | 'VERIFIED' | 'REVOKED';
export interface PersonalOwnerModelPriceTable {
  id: Ulid;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: string;
  input_microusd_per_1k_tokens: number;
  output_microusd_per_1k_tokens: number;
  max_input_tokens: number;
  max_output_tokens: number;
  input_neurons_per_million_tokens: ColumnType<number, number | undefined, number>;
  output_neurons_per_million_tokens: ColumnType<number, number | undefined, number>;
  evidence_url: string | null;
  evidence_sha256: string | null;
  decision_status: PersonalOwnerPriceStatus;
  valid_from: Timestamp;
  expires_at: Timestamp | null;
  recorded_at: Timestamp;
}

export interface PersonalOwnerBudgetControlTable {
  owner_identity: string;
  enabled: boolean;
  emergency_stop: boolean;
  per_request_limit_microusd: number;
  daily_limit_microusd: number;
  total_limit_microusd: number;
  max_concurrency: number;
  max_requests_per_minute: number;
  revoked_at: Timestamp | null;
  updated_at: Timestamp;
  workers_ai_plan: ColumnType<
    'UNVERIFIED' | 'FREE',
    'UNVERIFIED' | 'FREE' | undefined,
    'UNVERIFIED' | 'FREE'
  >;
  paid_overage_disabled: ColumnType<boolean, boolean | undefined, boolean>;
  workers_ai_plan_evidence_url: ColumnType<string | null, string | null | undefined, string | null>;
  workers_ai_plan_evidence_sha256: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  workers_ai_plan_verified_until: ColumnType<
    Date | null,
    Date | string | null | undefined,
    Date | string | null
  >;
  daily_neuron_limit: ColumnType<number, number | undefined, number>;
  per_request_neuron_limit: ColumnType<number, number | undefined, number>;
}

export interface PersonalOwnerNeuronReservationTable {
  id: Ulid;
  job_id: Ulid;
  owner_identity: string;
  model_id: string;
  utc_day: string;
  reserved_neurons: number;
  actual_neurons: number | null;
  state: 'RESERVED' | 'SETTLED' | 'RELEASED' | 'RECONCILIATION_REQUIRED';
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PersonalOwnerNeuronEventTable {
  id: Ulid;
  reservation_id: Ulid;
  event_type: 'RESERVED' | 'SETTLED' | 'RELEASED' | 'RECONCILIATION_REQUIRED';
  reserved_neurons: number;
  actual_neurons: number | null;
  recorded_at: Timestamp;
}

export interface PersonalOwnerSourcePollStateTable {
  source_id: Ulid;
  owner_identity: string;
  etag: string | null;
  last_modified: string | null;
  poll_interval_seconds: number;
  consecutive_failures: number;
  last_http_status: number | null;
  last_polled_at: Timestamp | null;
  last_success_at: Timestamp | null;
  next_poll_at: Timestamp;
  lease_until: Timestamp | null;
  updated_at: Timestamp;
}
export interface PersonalOwnerBudgetControlEventTable {
  id: Ulid;
  owner_identity: string;
  event_type: 'CONFIGURED' | 'EMERGENCY_STOPPED' | 'REVOKED' | 'REACTIVATED';
  limits_snapshot: unknown;
  recorded_at: Timestamp;
}

export type PersonalOwnerOperationalJobState =
  | 'BLOCKED'
  | 'PENDING'
  | 'RUNNING'
  | 'RECONCILIATION_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export interface PersonalOwnerOperationalJobTable {
  id: Ulid;
  owner_identity: string;
  idempotency_key: string;
  article_id: Ulid;
  article_version_id: Ulid;
  source_id: Ulid;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: string;
  state: PersonalOwnerOperationalJobState;
  blocked_reason: string | null;
  request_fingerprint_sha256: string;
  attempt_count: number;
  provider_request_started_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface PersonalOwnerOperationalJobEventTable {
  id: Ulid;
  job_id: Ulid;
  sequence_number: number;
  state: PersonalOwnerOperationalJobState | 'PROVIDER_REQUEST_STARTED' | 'RECOVERED_PENDING';
  error_category: string | null;
  recorded_at: Timestamp;
}

export interface PersonalOwnerBudgetReservationTable {
  id: Ulid;
  job_id: Ulid;
  owner_identity: string;
  price_id: Ulid;
  reserved_microusd: number;
  state: 'RESERVED' | 'SETTLED' | 'RELEASED' | 'RECONCILIATION_REQUIRED';
  actual_microusd: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PersonalOwnerBudgetEventTable {
  id: Ulid;
  reservation_id: Ulid;
  event_type: 'RESERVED' | 'SETTLED' | 'RELEASED' | 'RECONCILIATION_REQUIRED';
  reserved_microusd: number;
  actual_microusd: number | null;
  recorded_at: Timestamp;
}

export interface PersonalOwnerSourceConnectionTable {
  id: Ulid;
  owner_identity: string;
  source_id: Ulid;
  sequence_number: number;
  discovery_channel: 'rss_atom';
  endpoint: string;
  allowed_article_domains: unknown;
  recorded_at: Timestamp;
}

export interface PersonalOwnerOfficialVoteEvidenceTable {
  id: Ulid;
  source_id: Ulid;
  source_record_id: string;
  source_record_url: string;
  response_sha256: string;
  fetched_at: Timestamp;
  description: string;
  source_date_raw: string;
  yes_votes: number;
  no_votes: number;
  abstention_votes: number;
  excused_votes: number;
  result: string | null;
  quorum: string | null;
}

export interface PersonalOwnerOfficialVoteOccurrenceTable {
  id: Ulid;
  source_id: Ulid;
  source_record_id: string;
  occurrence_kind: 'ROLL_CALL_VOTE';
  identity_basis: 'OFFICIAL_SOURCE_RECORD_ID';
  created_at: Timestamp;
}

export interface PersonalOwnerOfficialVoteObservationTable {
  id: Ulid;
  source_id: Ulid;
  source_record_id: string;
  occurrence_id: Ulid;
  evidence_id: Ulid;
  occurrence_identity_decision: 'SOURCE_RECORD_IDENTIFIED';
  thread_identity_decision: 'UNKNOWN';
  thread_abstention_reason: string;
  observed_at: Timestamp;
}

export interface PersonalOwnerOfficialVoteProvenanceTable {
  id: Ulid;
  observation_id: Ulid;
  source_id: Ulid;
  source_record_id: string;
  evidence_id: Ulid;
  source_record_url: string;
  response_sha256: string;
  adapter_version: 'camara-vote-record-v1';
  acquisition_method: 'OFFICIAL_API';
  recorded_at: Timestamp;
}

export interface PersonalOwnerProviderAuthorizationTable {
  id: Ulid;
  owner_identity: string;
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: string;
  decision_status: PersonalOwnerDecisionStatus;
  evidence_url: string | null;
  evidence_sha256: string | null;
  valid_from: Timestamp;
  expires_at: Timestamp | null;
  recorded_at: Timestamp;
}

export interface PersonalOwnerProviderAttemptTable {
  id: Ulid;
  job_id: Ulid;
  state: 'CLAIMED' | 'REQUEST_STARTED' | 'RESPONSE_RECEIVED' | 'OUTCOME_UNKNOWN';
  provider_type: 'llm_cloudflare_workers_ai';
  model_id: string;
  claimed_at: Timestamp;
  request_started_at: Timestamp | null;
  response_received_at: Timestamp | null;
  response_sha256: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_category: string | null;
  updated_at: Timestamp;
}

export interface PersonalOwnerBudgetReconciliationTable {
  id: Ulid;
  job_id: Ulid;
  owner_identity: string;
  outcome: 'CHARGED' | 'NOT_CHARGED';
  actual_microusd: number | null;
  evidence_url: string;
  evidence_sha256: string;
  recorded_at: Timestamp;
}
