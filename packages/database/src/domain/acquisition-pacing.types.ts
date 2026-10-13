import type { ColumnType } from 'kysely';
import type { NullableTimestamp, Timestamp } from '../database.types';
import type { Ulid } from './ids';

/** Technical acquisition provenance only: no publisher text or arbitrary JSON. */
export interface AcquisitionPacingReceiptTable {
  sequence_number: ColumnType<string, never, never>;
  request_id: string;
  session_id: string;
  origin: string;
  source_id: Ulid;
  content_policy_id: string;
  policy_id: string;
  policy_version: string;
  policy_sha256: string;
  policy_authenticated_at: Timestamp;
  robots_observation_id: string | null;
  robots_sha256: string | null;
  robots_observed_at: NullableTimestamp;
  source_policy_delay_ms: number;
  declared_robots_delay_ms: number | null;
  configured_minimum_delay_ms: number;
  polling_minimum_delay_ms: number;
  retry_backoff_ms: number;
  retry_after_delay_ms: number;
  response_retry_after_delay_ms: number;
  effective_minimum_interval_ms: number;
  enforced_previous_interval_ms: number;
  request_started_at: Timestamp;
  request_ended_at: Timestamp;
  request_start_monotonic_ms: number;
  request_end_monotonic_ms: number;
  previous_request_id: string | null;
  previous_request_start_monotonic_ms: number | null;
  previous_request_end_monotonic_ms: number | null;
  http_status: number | null;
  outcome: 'COMPLETED' | 'FAILED';
}
export interface AcquisitionPacingObligationTable {
  origin: string;
  request_id: string;
  session_id: string;
  source_id: Ulid;
  content_policy_id: string;
  policy_id: string;
  effective_minimum_interval_ms: number;
  retry_backoff_ms: number;
  response_retry_after_delay_ms: number;
  phase: 'STARTED' | 'HEADERS_OBSERVED' | 'ROBOTS_VALIDATION_PENDING';
  http_status: number | null;
}
export interface AcquisitionRobotsObservationTable {
  sequence_number: ColumnType<string, never, never>;
  observation_id: string;
  origin: string;
  source_id: Ulid;
  content_policy_id: string;
  policy_id: string;
  policy_version: string;
  sha256: string;
  observed_at: Timestamp;
  declared_delay_ms: number | null;
}
