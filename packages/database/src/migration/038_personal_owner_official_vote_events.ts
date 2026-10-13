import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
alter table personal_owner_audit_events drop constraint personal_owner_audit_events_event_type_check;
alter table personal_owner_audit_events add constraint personal_owner_audit_events_event_type_check
  check (event_type in ('OWNER_STATUS_VIEWED','SOURCE_REGISTERED','RIGHTS_DECISION_RECORDED',
    'MODEL_PRICE_RECORDED','SOURCE_CONNECTION_RECORDED','PROVIDER_AUTHORIZATION_RECORDED',
    'SOURCE_ACQUISITION_COMPLETED','OPERATIONAL_JOB_SUBMITTED','OPERATIONAL_JOB_CANCELLED',
    'BUDGET_RECONCILED','OFFICIAL_EVENT_ACQUIRED'));

-- A bounded, owner-triggered lane for open official event records. It stores
-- only aggregate metadata, source identity, and a hash of the transient reply.
create table personal_owner_official_vote_evidence (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  source_record_id text not null check (source_record_id ~ '^[0-9]{1,12}$'),
  source_record_url text not null check (source_record_url ~ '^https://opendata[.]camara[.]cl/camaradiputados/WServices/WSLegislativo[.]asmx/retornarVotacionDetalle[?]prmVotacionId=[0-9]{1,12}$'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  fetched_at timestamptz(3) not null,
  description text not null check (length(description) between 1 and 1000),
  source_date_raw text not null check (source_date_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'),
  yes_votes integer not null check (yes_votes between 0 and 1000),
  no_votes integer not null check (no_votes between 0 and 1000),
  abstention_votes integer not null check (abstention_votes between 0 and 1000),
  excused_votes integer not null check (excused_votes between 0 and 1000),
  result text check (result is null or length(result) <= 200),
  quorum text check (quorum is null or length(quorum) <= 200),
  unique (source_id, source_record_id, response_sha256),
  unique (id, source_id, source_record_id)
);
create index personal_owner_official_vote_evidence_latest
  on personal_owner_official_vote_evidence(source_id, source_record_id, fetched_at desc, id desc);

create table personal_owner_official_vote_occurrences (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  source_record_id text not null check (source_record_id ~ '^[0-9]{1,12}$'),
  occurrence_kind text not null check (occurrence_kind = 'ROLL_CALL_VOTE'),
  identity_basis text not null check (identity_basis = 'OFFICIAL_SOURCE_RECORD_ID'),
  created_at timestamptz(3) not null,
  unique (source_id, source_record_id),
  unique (id, source_id, source_record_id)
);

create table personal_owner_official_vote_observations (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  source_record_id text not null check (source_record_id ~ '^[0-9]{1,12}$'),
  occurrence_id dialektik_ulid not null,
  evidence_id dialektik_ulid not null,
  occurrence_identity_decision text not null check (occurrence_identity_decision = 'SOURCE_RECORD_IDENTIFIED'),
  thread_identity_decision text not null check (thread_identity_decision = 'UNKNOWN'),
  thread_abstention_reason text not null check (length(thread_abstention_reason) between 1 and 500),
  observed_at timestamptz(3) not null,
  foreign key (occurrence_id, source_id, source_record_id)
    references personal_owner_official_vote_occurrences(id, source_id, source_record_id),
  foreign key (evidence_id, source_id, source_record_id)
    references personal_owner_official_vote_evidence(id, source_id, source_record_id),
  unique (evidence_id),
  unique (id, source_id, source_record_id, evidence_id)
);

create table personal_owner_official_vote_provenance (
  id dialektik_ulid primary key,
  observation_id dialektik_ulid not null unique,
  source_id dialektik_ulid not null references sources(id),
  source_record_id text not null check (source_record_id ~ '^[0-9]{1,12}$'),
  evidence_id dialektik_ulid not null,
  source_record_url text not null check (source_record_url ~ '^https://opendata[.]camara[.]cl/camaradiputados/WServices/WSLegislativo[.]asmx/retornarVotacionDetalle[?]prmVotacionId=[0-9]{1,12}$'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  adapter_version text not null check (adapter_version = 'camara-vote-record-v1'),
  acquisition_method text not null check (acquisition_method = 'OFFICIAL_API'),
  recorded_at timestamptz(3) not null,
  foreign key (observation_id, source_id, source_record_id, evidence_id)
    references personal_owner_official_vote_observations(id, source_id, source_record_id, evidence_id),
  foreign key (evidence_id, source_id, source_record_id)
    references personal_owner_official_vote_evidence(id, source_id, source_record_id)
);

do $$ declare table_name text;
begin
  foreach table_name in array array[
    'personal_owner_official_vote_evidence', 'personal_owner_official_vote_occurrences',
    'personal_owner_official_vote_observations', 'personal_owner_official_vote_provenance'
  ] loop
    execute format('create trigger %I before update or delete on %I for each row execute function dialektik_semantic_content_append_only()', table_name || '_immutable', table_name);
    execute format('create trigger %I before truncate on %I for each statement execute function dialektik_semantic_content_append_only()', table_name || '_no_truncate', table_name);
  end loop;
end; $$;
`;

export const personalOwnerOfficialVoteEventsMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner official vote evidence is append-only and forward-only.');
  },
};
