import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
-- This migration is deliberately test-only.  It does not alter the shared
-- Cloudflare grant functions or the production semantic persistence tables.
create table personal_owner_test_authorizations (
  id dialektik_ulid primary key,
  owner_identity text not null check (owner_identity ~ '^synthetic-owner-[A-Za-z0-9_.:-]{1,48}$'),
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null references official_api_hash_only_articles(article_id),
  article_version_id dialektik_ulid not null references official_api_hash_only_article_versions(id),
  projection_version_id dialektik_ulid not null references official_api_hash_only_projection_versions(id),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id = '@cf/openai/gpt-oss-20b'),
  operation text not null check (operation in ('MOCKED_TITLE_ONLY_INFERENCE','MOCKED_DERIVED_SHADOW_PERSISTENCE')),
  environment_scope text not null check (environment_scope = 'ISOLATED_TEST_ONLY'),
  authorization_artifact_sha256 text not null check (authorization_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  decision_status text not null check (decision_status in ('APPROVED','REVOKED')),
  valid_from timestamptz(3) not null,
  expires_at timestamptz(3) not null,
  revoked_at timestamptz(3),
  recorded_at timestamptz(3) not null,
  check (expires_at > valid_from),
  check ((decision_status = 'REVOKED') = (revoked_at is not null))
);
create index personal_owner_test_authorizations_lookup on personal_owner_test_authorizations(
  owner_identity, source_id, article_id, article_version_id, projection_version_id,
  provider_type, model_id, operation, recorded_at desc, id desc
);

create function dialektik_validate_personal_owner_test_authorization() returns trigger language plpgsql as $$
declare version_row official_api_hash_only_article_versions;
  projection_row official_api_hash_only_projection_versions;
begin
  select * into strict version_row from official_api_hash_only_article_versions
    where id = new.article_version_id;
  select * into strict projection_row from official_api_hash_only_projection_versions
    where id = new.projection_version_id;
  if new.recorded_at > clock_timestamp()
    or new.valid_from > new.expires_at
    or version_row.article_id is distinct from new.article_id
    or version_row.source_id is distinct from new.source_id
    or projection_row.article_id is distinct from new.article_id
    or projection_row.source_id is distinct from new.source_id
    or projection_row.article_version_id is distinct from new.article_version_id
    or new.decision_status = 'REVOKED' and new.revoked_at is null then
    raise exception using errcode='23514', message='personal test authorization identity or validity mismatch';
  end if;
  return new;
end;
$$;
create trigger personal_owner_test_authorizations_validate
  before insert on personal_owner_test_authorizations
  for each row execute function dialektik_validate_personal_owner_test_authorization();
create trigger personal_owner_test_authorizations_append_only
  before update or delete on personal_owner_test_authorizations
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_test_authorizations_no_truncate
  before truncate on personal_owner_test_authorizations
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_test_jobs (
  id dialektik_ulid primary key,
  owner_identity text not null check (owner_identity ~ '^synthetic-owner-[A-Za-z0-9_.:-]{1,48}$'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  inference_authorization_id dialektik_ulid not null references personal_owner_test_authorizations(id),
  persistence_authorization_id dialektik_ulid not null references personal_owner_test_authorizations(id),
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null references official_api_hash_only_articles(article_id),
  article_version_id dialektik_ulid not null references official_api_hash_only_article_versions(id),
  projection_version_id dialektik_ulid not null references official_api_hash_only_projection_versions(id),
  projection_sha256 text not null check (projection_sha256 ~ '^[0-9a-f]{64}$'),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id = '@cf/openai/gpt-oss-20b'),
  request_fingerprint_sha256 text not null check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  environment_scope text not null check (environment_scope = 'ISOLATED_TEST_ONLY'),
  created_at timestamptz(3) not null,
  unique (owner_identity, idempotency_key)
);
create index personal_owner_test_jobs_scope on personal_owner_test_jobs(owner_identity, created_at desc, id desc);
create function dialektik_validate_personal_owner_test_job() returns trigger language plpgsql as $$
declare inference_auth personal_owner_test_authorizations;
  persistence_auth personal_owner_test_authorizations;
  projection_row official_api_hash_only_projection_versions;
begin
  select * into strict inference_auth from personal_owner_test_authorizations
    where id = new.inference_authorization_id;
  select * into strict persistence_auth from personal_owner_test_authorizations
    where id = new.persistence_authorization_id;
  select * into strict projection_row from official_api_hash_only_projection_versions
    where id = new.projection_version_id;
  if inference_auth.owner_identity is distinct from new.owner_identity
    or persistence_auth.owner_identity is distinct from new.owner_identity
    or inference_auth.source_id is distinct from new.source_id
    or persistence_auth.source_id is distinct from new.source_id
    or inference_auth.article_id is distinct from new.article_id
    or persistence_auth.article_id is distinct from new.article_id
    or inference_auth.article_version_id is distinct from new.article_version_id
    or persistence_auth.article_version_id is distinct from new.article_version_id
    or inference_auth.projection_version_id is distinct from new.projection_version_id
    or persistence_auth.projection_version_id is distinct from new.projection_version_id
    or inference_auth.operation <> 'MOCKED_TITLE_ONLY_INFERENCE'
    or persistence_auth.operation <> 'MOCKED_DERIVED_SHADOW_PERSISTENCE'
    or inference_auth.environment_scope <> 'ISOLATED_TEST_ONLY'
    or persistence_auth.environment_scope <> 'ISOLATED_TEST_ONLY'
    or inference_auth.decision_status <> 'APPROVED'
    or persistence_auth.decision_status <> 'APPROVED'
    or inference_auth.revoked_at is not null
    or persistence_auth.revoked_at is not null
    or inference_auth.valid_from > new.created_at
    or persistence_auth.valid_from > new.created_at
    or inference_auth.expires_at <= new.created_at
    or persistence_auth.expires_at <= new.created_at
    or projection_row.projection_sha256 is distinct from new.projection_sha256
    or new.created_at > clock_timestamp() then
    raise exception using errcode='23514', message='personal test job authorization or scope mismatch';
  end if;
  return new;
end;
$$;
create trigger personal_owner_test_jobs_validate
  before insert on personal_owner_test_jobs
  for each row execute function dialektik_validate_personal_owner_test_job();
create trigger personal_owner_test_jobs_append_only
  before update or delete on personal_owner_test_jobs
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_test_jobs_no_truncate
  before truncate on personal_owner_test_jobs
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_test_job_events (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null references personal_owner_test_jobs(id),
  sequence_number integer not null check (sequence_number > 0),
  state text not null check (state in ('RESERVED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  observation_id dialektik_ulid,
  error_category text check (error_category is null or error_category ~ '^[A-Z0-9_.:-]{1,96}$'),
  recorded_at timestamptz(3) not null,
  unique (job_id, sequence_number)
);
create index personal_owner_test_job_events_latest on personal_owner_test_job_events(job_id, sequence_number desc);
create function dialektik_validate_personal_owner_test_job_event() returns trigger language plpgsql as $$
declare latest_event personal_owner_test_job_events;
begin
  select * into latest_event from personal_owner_test_job_events
    where job_id = new.job_id order by sequence_number desc limit 1;
  if (latest_event.id is null and new.sequence_number <> 1)
    or (latest_event.id is not null and new.sequence_number <> latest_event.sequence_number + 1)
    or (latest_event.state in ('SUCCEEDED','FAILED','CANCELLED'))
    or (new.state = 'RESERVED' and new.sequence_number <> 1)
    or (new.state = 'RUNNING' and (latest_event.id is null or latest_event.state <> 'RESERVED'))
    or (new.state = 'CANCELLED' and (latest_event.id is null or latest_event.state <> 'RESERVED'))
    or (new.state in ('SUCCEEDED','FAILED') and (latest_event.id is null or latest_event.state <> 'RUNNING'))
    or (new.state = 'SUCCEEDED' and new.observation_id is null)
    or (new.state = 'SUCCEEDED' and not exists (
      select 1 from personal_owner_test_shadow_observations
      where id = new.observation_id and job_id = new.job_id
    ))
    or (new.state <> 'SUCCEEDED' and new.observation_id is not null)
    or new.recorded_at > clock_timestamp() then
    raise exception using errcode='23514', message='personal test job event transition is invalid';
  end if;
  return new;
end;
$$;
create trigger personal_owner_test_job_events_validate
  before insert on personal_owner_test_job_events
  for each row execute function dialektik_validate_personal_owner_test_job_event();
create trigger personal_owner_test_job_events_append_only
  before update or delete on personal_owner_test_job_events
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_test_job_events_no_truncate
  before truncate on personal_owner_test_job_events
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_test_shadow_observations (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null unique references personal_owner_test_jobs(id),
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null references official_api_hash_only_articles(article_id),
  article_version_id dialektik_ulid not null references official_api_hash_only_article_versions(id),
  projection_version_id dialektik_ulid not null references official_api_hash_only_projection_versions(id),
  provider_run_id text not null check (provider_run_id ~ '^[A-Za-z0-9_.:-]{16,96}$'),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id = '@cf/openai/gpt-oss-20b'),
  projection_sha256 text not null check (projection_sha256 ~ '^[0-9a-f]{64}$'),
  schema_sha256 text not null check (schema_sha256 ~ '^[0-9a-f]{64}$'),
  skill_sha256 text not null check (skill_sha256 ~ '^[0-9a-f]{64}$'),
  derivative_sha256 text not null check (derivative_sha256 ~ '^[0-9a-f]{64}$'),
  applicability text not null check (applicability in ('OBSERVATION_AVAILABLE','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE','AMBIGUOUS')),
  event_nugget_count integer not null check (event_nugget_count between 0 and 3),
  fact_count integer not null check (fact_count between 0 and 30),
  grounded_fact_count integer not null check (grounded_fact_count between 0 and fact_count),
  unsupported_fact_count integer not null check (unsupported_fact_count between 0 and fact_count),
  valid_evidence_reference_count integer not null check (valid_evidence_reference_count between 0 and 120),
  invalid_evidence_reference_count integer not null check (invalid_evidence_reference_count between 0 and 120),
  semantic_derivatives jsonb not null,
  evidence_locators jsonb not null,
  recorded_at timestamptz(3) not null
);
create function dialektik_personal_owner_test_jsonb_contains_forbidden(payload jsonb)
returns boolean language plpgsql immutable as $$
declare entry record; child jsonb;
begin
  if jsonb_typeof(payload) = 'object' then
    for entry in select key, value as child from jsonb_each(payload) loop
      if entry.key in ('sourceText','projectionText','prompt','rawResponse','body')
        or dialektik_personal_owner_test_jsonb_contains_forbidden(entry.child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(payload) = 'array' then
    for child in select value from jsonb_array_elements(payload) loop
      if dialektik_personal_owner_test_jsonb_contains_forbidden(child) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;
create function dialektik_validate_personal_owner_test_observation() returns trigger language plpgsql as $$
declare job_row personal_owner_test_jobs; version_row official_api_hash_only_article_versions;
begin
  select * into strict job_row from personal_owner_test_jobs where id = new.job_id;
  select * into strict version_row from official_api_hash_only_article_versions where id = new.article_version_id;
  if job_row.source_id is distinct from new.source_id
    or job_row.article_id is distinct from new.article_id
    or job_row.article_version_id is distinct from new.article_version_id
    or job_row.projection_version_id is distinct from new.projection_version_id
    or job_row.projection_sha256 is distinct from new.projection_sha256
    or job_row.provider_type is distinct from new.provider_type
    or job_row.model_id is distinct from new.model_id
    or version_row.title_codepoint_length < 1
    or jsonb_typeof(new.semantic_derivatives) is distinct from 'object'
    or jsonb_typeof(new.evidence_locators) is distinct from 'array'
    or dialektik_personal_owner_test_jsonb_contains_forbidden(new.semantic_derivatives)
    or dialektik_personal_owner_test_jsonb_contains_forbidden(new.evidence_locators) then
    raise exception using errcode='23514', message='personal test observation is outside sanitized hash-only scope';
  end if;
  return new;
end;
$$;
create trigger personal_owner_test_observations_validate
  before insert on personal_owner_test_shadow_observations
  for each row execute function dialektik_validate_personal_owner_test_observation();
create trigger personal_owner_test_observations_append_only
  before update or delete on personal_owner_test_shadow_observations
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_test_observations_no_truncate
  before truncate on personal_owner_test_shadow_observations
  for each statement execute function dialektik_semantic_content_append_only();
`;

export const personalOwnerTestWorkflowMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner test workflow records are append-only and forward-only.');
  },
};
