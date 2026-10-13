import { sql, type Kysely, type Migration } from 'kysely';

const schema = `
-- Mutable technical crash guard; completed provenance below stays append-only.
create table acquisition_pacing_obligations (
  origin text primary key check (length(origin) <= 255 and origin ~ '^https://[^/?#@[:space:]]+$'),
  request_id text not null check (request_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  session_id text not null check (session_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  source_id dialektik_ulid not null,
  content_policy_id text not null,
  policy_id text not null check (length(policy_id) between 1 and 160 and policy_id ~ '^[A-Za-z0-9_.:/-]+$'),
  effective_minimum_interval_ms double precision not null check (effective_minimum_interval_ms >= 0 and effective_minimum_interval_ms < 'Infinity'::float8),
  retry_backoff_ms double precision not null check (retry_backoff_ms >= 0 and retry_backoff_ms < 'Infinity'::float8),
  response_retry_after_delay_ms double precision not null check (response_retry_after_delay_ms >= 0 and response_retry_after_delay_ms < 'Infinity'::float8),
  phase text not null check (phase in ('STARTED','HEADERS_OBSERVED','ROBOTS_VALIDATION_PENDING')),
  http_status integer check (http_status between 100 and 599),
  foreign key (source_id, content_policy_id) references content_access_policies(source_id,id),
  check ((phase='STARTED' and http_status is null and response_retry_after_delay_ms=0)
    or (phase='HEADERS_OBSERVED' and http_status is not null)
    or phase='ROBOTS_VALIDATION_PENDING')
);
create table acquisition_robots_observations (
  sequence_number bigint generated always as identity unique,
  observation_id text primary key check (observation_id ~ '^[a-f0-9]{64}$'),
  origin text not null check (length(origin) <= 255 and origin ~ '^https://[^/?#@[:space:]]+$'),
  source_id dialektik_ulid not null,
  content_policy_id text not null,
  policy_id text not null check (length(policy_id) between 1 and 160 and policy_id ~ '^[A-Za-z0-9_.:/-]+$'),
  policy_version text not null check (length(policy_version) between 1 and 80 and policy_version ~ '^[A-Za-z0-9_.:/-]+$'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  declared_delay_ms double precision check (declared_delay_ms >= 0 and declared_delay_ms < 'Infinity'::float8),
  foreign key (source_id, content_policy_id) references content_access_policies(source_id,id)
);
create index acquisition_robots_origin_latest on acquisition_robots_observations(origin,sequence_number desc);
create trigger acquisition_robots_immutable before update or delete on acquisition_robots_observations
  for each row execute function dialektik_semantic_content_append_only();
create trigger acquisition_robots_no_truncate before truncate on acquisition_robots_observations
  for each statement execute function dialektik_semantic_content_append_only();
create table acquisition_pacing_receipts (
  sequence_number bigint generated always as identity unique,
  request_id text primary key check (request_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  session_id text not null check (session_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  origin text not null check (length(origin) <= 255 and origin ~ '^https://[^/?#@[:space:]]+$'),
  source_id dialektik_ulid not null,
  content_policy_id text not null,
  policy_id text not null check (length(policy_id) between 1 and 160 and policy_id ~ '^[A-Za-z0-9_.:/-]+$'),
  policy_version text not null check (length(policy_version) between 1 and 80 and policy_version ~ '^[A-Za-z0-9_.:/-]+$'),
  policy_sha256 text not null check (policy_sha256 ~ '^[a-f0-9]{64}$'),
  policy_authenticated_at timestamptz not null,
  robots_observation_id text check (robots_observation_id ~ '^[a-f0-9]{64}$'),
  robots_sha256 text check (robots_sha256 ~ '^[a-f0-9]{64}$'),
  robots_observed_at timestamptz,
  source_policy_delay_ms double precision not null,
  declared_robots_delay_ms double precision,
  configured_minimum_delay_ms double precision not null,
  polling_minimum_delay_ms double precision not null,
  retry_backoff_ms double precision not null,
  retry_after_delay_ms double precision not null,
  response_retry_after_delay_ms double precision not null,
  effective_minimum_interval_ms double precision not null,
  enforced_previous_interval_ms double precision not null,
  request_started_at timestamptz not null,
  request_ended_at timestamptz not null,
  request_start_monotonic_ms double precision not null,
  request_end_monotonic_ms double precision not null,
  previous_request_id text references acquisition_pacing_receipts(request_id),
  previous_request_start_monotonic_ms double precision,
  previous_request_end_monotonic_ms double precision,
  http_status integer check (http_status between 100 and 599),
  outcome text not null check (outcome in ('COMPLETED','FAILED')),
  foreign key (source_id, content_policy_id) references content_access_policies(source_id,id),
  check ((robots_observation_id is null and robots_sha256 is null and robots_observed_at is null and declared_robots_delay_ms is null)
    or (robots_observation_id is not null and robots_sha256 is not null and robots_observed_at is not null)),
  check (source_policy_delay_ms >= 0 and source_policy_delay_ms < 'Infinity'::float8
    and configured_minimum_delay_ms >= 0 and configured_minimum_delay_ms < 'Infinity'::float8
    and polling_minimum_delay_ms >= 0 and polling_minimum_delay_ms < 'Infinity'::float8
    and retry_backoff_ms >= 0 and retry_backoff_ms < 'Infinity'::float8
    and retry_after_delay_ms >= 0 and retry_after_delay_ms < 'Infinity'::float8
    and response_retry_after_delay_ms >= 0 and response_retry_after_delay_ms < 'Infinity'::float8
    and effective_minimum_interval_ms >= 0 and effective_minimum_interval_ms < 'Infinity'::float8
    and enforced_previous_interval_ms >= effective_minimum_interval_ms and enforced_previous_interval_ms < 'Infinity'::float8
    and (declared_robots_delay_ms is null or (declared_robots_delay_ms >= 0 and declared_robots_delay_ms < 'Infinity'::float8))),
  check (effective_minimum_interval_ms = greatest(source_policy_delay_ms, configured_minimum_delay_ms,
    polling_minimum_delay_ms, coalesce(declared_robots_delay_ms,0))),
  check (request_start_monotonic_ms >= 0 and request_start_monotonic_ms < 'Infinity'::float8
    and request_end_monotonic_ms >= request_start_monotonic_ms and request_end_monotonic_ms < 'Infinity'::float8),
  check ((previous_request_start_monotonic_ms is null and previous_request_end_monotonic_ms is null)
    or (previous_request_id is not null and previous_request_start_monotonic_ms >= 0
      and previous_request_start_monotonic_ms < 'Infinity'::float8
      and previous_request_end_monotonic_ms >= previous_request_start_monotonic_ms
      and previous_request_end_monotonic_ms < 'Infinity'::float8))
);
create index acquisition_pacing_origin_latest on acquisition_pacing_receipts(origin, sequence_number desc);
create function dialektik_validate_acquisition_pacing_receipt() returns trigger language plpgsql as $$
declare prior acquisition_pacing_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik-ephemeral-acquisition-origin:' || new.origin,0));
  select * into prior from acquisition_pacing_receipts where origin=new.origin order by sequence_number desc limit 1;
  if new.previous_request_id is distinct from prior.request_id then
    raise exception using errcode='23514',message='acquisition pacing history must continue the current origin';
  end if;
  if prior.request_id is not null and prior.session_id=new.session_id then
    if new.previous_request_start_monotonic_ms is distinct from prior.request_start_monotonic_ms
      or new.previous_request_end_monotonic_ms is distinct from prior.request_end_monotonic_ms
      or new.enforced_previous_interval_ms < prior.effective_minimum_interval_ms
      or new.request_start_monotonic_ms < prior.request_end_monotonic_ms
      or new.request_start_monotonic_ms-prior.request_end_monotonic_ms < new.enforced_previous_interval_ms then
      raise exception using errcode='23514',message='acquisition pacing monotonic interval violated';
    end if;
  elsif new.previous_request_start_monotonic_ms is not null or new.previous_request_end_monotonic_ms is not null then
    raise exception using errcode='23514',message='different acquisition sessions cannot compare monotonic clocks';
  end if;
  return new;
end $$;
create trigger acquisition_pacing_validate before insert on acquisition_pacing_receipts
  for each row execute function dialektik_validate_acquisition_pacing_receipt();
create trigger acquisition_pacing_immutable before update or delete on acquisition_pacing_receipts
  for each row execute function dialektik_semantic_content_append_only();
create trigger acquisition_pacing_no_truncate before truncate on acquisition_pacing_receipts
  for each statement execute function dialektik_semantic_content_append_only();
`;
export const acquisitionPacingMigration: Migration = {
  async up(database: Kysely<unknown>): Promise<void> {
    await sql.raw(schema).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Acquisition pacing receipts are forward-only.');
  },
};
