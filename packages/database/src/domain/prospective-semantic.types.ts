import type { ColumnType } from 'kysely';
import type { Timestamp } from '../database.types';
import type { Ulid } from './ids';

/** One owner-authorized protocol, frozen before its sole invocation. */
export interface ProspectiveSemanticExperimentTable {
  run_identity: 'PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1';
  corpus_identity: 'PROSPECTIVE_MULTISOURCE_SHADOW_CORPUS_V1';
  corpus_manifest_sha256: string;
  preregistration_sha256: string;
  exposure_registry_sha256: string;
  candidate_commit: 'ea47eb75e955b9a51d15dc0135c81145130553ca';
  module_closure_sha256: string;
  runtime_python: '3.11.9';
  runtime_model: 'none';
  input_count: number;
  input_version_ids: Ulid[];
  registered_at: Timestamp;
}

/** STARTED permanently consumes the run, including process loss or uncertainty. */
export interface ProspectiveSemanticReservationTable {
  run_identity: ProspectiveSemanticExperimentTable['run_identity'];
  provider_run_id: Ulid;
  state: 'STARTED';
  started_at: Timestamp;
}

/** Terminal accounting appends without reopening the reservation. */
export interface ProspectiveSemanticOutcomeTable {
  run_identity: ProspectiveSemanticExperimentTable['run_identity'];
  state: 'COMPLETED' | 'FAILED' | 'UNCERTAIN';
  recorded_at: Timestamp;
}

/** Internal MVCC fence only: append-rights revision, never semantic state. */
export interface ProspectiveContentRightsWriteGuardTable {
  source_id: Ulid;
  revision: ColumnType<string, string | undefined, string>;
}
