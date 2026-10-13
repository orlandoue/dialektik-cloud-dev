import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
alter table personal_owner_audit_events drop constraint personal_owner_audit_events_event_type_check;
alter table personal_owner_audit_events add constraint personal_owner_audit_events_event_type_check
  check (event_type in ('OWNER_STATUS_VIEWED','SOURCE_REGISTERED','RIGHTS_DECISION_RECORDED','MODEL_PRICE_RECORDED'));

create table personal_owner_source_rights_decisions (
  id dialektik_ulid primary key,
  owner_identity text not null check (owner_identity ~ '^[a-zA-Z0-9_.:-]{1,128}$'),
  source_id dialektik_ulid not null references sources(id),
  sequence_number integer not null check (sequence_number > 0),
  publisher_identity text not null check (length(btrim(publisher_identity)) between 1 and 200),
  acquisition_method text not null check (acquisition_method in ('RSS_ATOM','OFFICIAL_API','OWNER_PROVIDED','OTHER')),
  rights_evidence_url text,
  rights_evidence_sha256 text check (rights_evidence_sha256 is null or rights_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  scopes jsonb not null,
  attribution text,
  restrictions jsonb not null default '{}'::jsonb check (jsonb_typeof(restrictions) = 'object'),
  decision_status text not null check (decision_status in ('UNVERIFIED','AUTHORIZED','SUSPENDED','REVOKED')),
  decision_provenance text not null check (length(btrim(decision_provenance)) between 1 and 500),
  valid_from timestamptz(3) not null,
  expires_at timestamptz(3),
  recorded_at timestamptz(3) not null,
  unique(source_id, sequence_number),
  check (expires_at is null or expires_at > valid_from),
  check (rights_evidence_url is null or rights_evidence_url ~ '^https://'),
  check (jsonb_typeof(scopes) = 'object'
    and (scopes - array['acquisition','metadata_storage','excerpt_storage','fulltext_acquisition',
      'fulltext_persistence','external_ai_transmission','derived_semantic_persistence','redisplay']) = '{}'::jsonb
    and scopes ?& array['acquisition','metadata_storage','excerpt_storage','fulltext_acquisition',
      'fulltext_persistence','external_ai_transmission','derived_semantic_persistence','redisplay']
    and jsonb_typeof(scopes->'acquisition') = 'boolean'
    and jsonb_typeof(scopes->'metadata_storage') = 'boolean'
    and jsonb_typeof(scopes->'excerpt_storage') = 'boolean'
    and jsonb_typeof(scopes->'fulltext_acquisition') = 'boolean'
    and jsonb_typeof(scopes->'fulltext_persistence') = 'boolean'
    and jsonb_typeof(scopes->'external_ai_transmission') = 'boolean'
    and jsonb_typeof(scopes->'derived_semantic_persistence') = 'boolean'
    and jsonb_typeof(scopes->'redisplay') = 'boolean'),
  check (decision_status <> 'AUTHORIZED' or
    (rights_evidence_url is not null and rights_evidence_sha256 is not null and valid_from <= recorded_at
      and (expires_at is null or expires_at > recorded_at) and attribution is not null
      and length(btrim(attribution)) between 1 and 1000)),
  check (decision_status <> 'UNVERIFIED' or scopes =
    '{"acquisition":false,"metadata_storage":false,"excerpt_storage":false,"fulltext_acquisition":false,"fulltext_persistence":false,"external_ai_transmission":false,"derived_semantic_persistence":false,"redisplay":false}'::jsonb),
  check (recorded_at <= clock_timestamp())
);
create index personal_owner_source_rights_latest
  on personal_owner_source_rights_decisions(source_id, sequence_number desc);
create function dialektik_guard_personal_owner_source_rights()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode='55000', message='personal owner source rights decisions are append-only';
  end if;
  perform 1 from prospective_content_rights_write_guards where source_id = new.source_id for update;
  if new.recorded_at > clock_timestamp() or new.valid_from > new.recorded_at then
    raise exception using errcode='23514', message='personal owner rights decision time is invalid';
  end if;
  if new.sequence_number <> coalesce((select max(sequence_number) + 1
      from personal_owner_source_rights_decisions where source_id = new.source_id), 1) then
    raise exception using errcode='23514', message='personal owner rights decision sequence is invalid';
  end if;
  return new;
end;
$$;
create trigger personal_owner_source_rights_guard
  before insert or update or delete on personal_owner_source_rights_decisions
  for each row execute function dialektik_guard_personal_owner_source_rights();
create trigger personal_owner_source_rights_no_truncate
  before truncate on personal_owner_source_rights_decisions
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_model_prices (
  id dialektik_ulid primary key,
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id ~ '^@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  input_microusd_per_1k_tokens integer not null check (input_microusd_per_1k_tokens between 0 and 1000000000),
  output_microusd_per_1k_tokens integer not null check (output_microusd_per_1k_tokens between 0 and 1000000000),
  max_input_tokens integer not null check (max_input_tokens between 1 and 1000000),
  max_output_tokens integer not null check (max_output_tokens between 1 and 1000000),
  evidence_url text,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  decision_status text not null check (decision_status in ('UNVERIFIED','VERIFIED','REVOKED')),
  valid_from timestamptz(3) not null,
  expires_at timestamptz(3),
  recorded_at timestamptz(3) not null,
  check (expires_at is null or expires_at > valid_from),
  check (evidence_url is null or evidence_url ~ '^https://'),
  check (decision_status <> 'VERIFIED' or
    (evidence_url is not null and evidence_sha256 is not null and valid_from <= recorded_at
      and (expires_at is null or expires_at > recorded_at))),
  check (recorded_at <= clock_timestamp())
);
create index personal_owner_model_prices_current
  on personal_owner_model_prices(provider_type, model_id, recorded_at desc);
create trigger personal_owner_model_prices_append_only
  before update or delete on personal_owner_model_prices
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_model_prices_no_truncate
  before truncate on personal_owner_model_prices
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_budget_controls (
  owner_identity text primary key check (owner_identity ~ '^[a-zA-Z0-9_.:-]{1,128}$'),
  enabled boolean not null default false,
  emergency_stop boolean not null default true,
  per_request_limit_microusd integer not null default 0 check (per_request_limit_microusd between 0 and 2000000000),
  daily_limit_microusd integer not null default 0 check (daily_limit_microusd between 0 and 2000000000),
  total_limit_microusd integer not null default 0 check (total_limit_microusd between 0 and 2000000000),
  max_concurrency smallint not null default 1 check (max_concurrency between 1 and 8),
  max_requests_per_minute smallint not null default 1 check (max_requests_per_minute between 1 and 10),
  revoked_at timestamptz(3),
  updated_at timestamptz(3) not null,
  check (enabled = false or (emergency_stop = false and revoked_at is null
    and per_request_limit_microusd > 0 and daily_limit_microusd > 0 and total_limit_microusd > 0)),
  check (updated_at <= clock_timestamp())
);
create table personal_owner_budget_control_events (
  id dialektik_ulid primary key,
  owner_identity text not null references personal_owner_budget_controls(owner_identity),
  event_type text not null check (event_type in ('CONFIGURED','EMERGENCY_STOPPED','REVOKED','REACTIVATED')),
  limits_snapshot jsonb not null check (jsonb_typeof(limits_snapshot) = 'object'),
  recorded_at timestamptz(3) not null check (recorded_at <= clock_timestamp())
);
create trigger personal_owner_budget_control_events_append_only
  before update or delete on personal_owner_budget_control_events
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_budget_control_events_no_truncate
  before truncate on personal_owner_budget_control_events
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_operational_jobs (
  id dialektik_ulid primary key,
  owner_identity text not null check (owner_identity ~ '^[a-zA-Z0-9_.:-]{1,128}$'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  article_id dialektik_ulid not null references articles(id),
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  source_id dialektik_ulid not null references sources(id),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id ~ '^@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  state text not null check (state in ('BLOCKED','PENDING','RUNNING','RECONCILIATION_REQUIRED','COMPLETED','FAILED','CANCELLED')),
  blocked_reason text check (blocked_reason is null or blocked_reason ~ '^[A-Z0-9_.:-]{1,96}$'),
  request_fingerprint_sha256 text not null check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 1),
  provider_request_started_at timestamptz(3),
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  completed_at timestamptz(3),
  unique(owner_identity, idempotency_key),
  check ((attempt_count = 1) = (provider_request_started_at is not null)),
  check ((state in ('COMPLETED','FAILED','CANCELLED')) = (completed_at is not null)),
  check ((state = 'BLOCKED') = (blocked_reason is not null)),
  check (state not in ('RECONCILIATION_REQUIRED','COMPLETED') or attempt_count = 1),
  check (state not in ('BLOCKED','PENDING','CANCELLED') or attempt_count = 0),
  check (updated_at >= created_at and created_at <= clock_timestamp())
);
create index personal_owner_operational_jobs_owner_created
  on personal_owner_operational_jobs(owner_identity, created_at desc);
create index personal_owner_operational_jobs_state
  on personal_owner_operational_jobs(state, updated_at);

create table personal_owner_operational_job_events (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null references personal_owner_operational_jobs(id),
  sequence_number integer not null check (sequence_number > 0),
  state text not null check (state in ('BLOCKED','PENDING','RUNNING','PROVIDER_REQUEST_STARTED',
    'RECONCILIATION_REQUIRED','COMPLETED','FAILED','CANCELLED')),
  error_category text check (error_category is null or error_category ~ '^[A-Z0-9_.:-]{1,96}$'),
  recorded_at timestamptz(3) not null,
  unique(job_id, sequence_number)
);
create index personal_owner_operational_job_events_latest
  on personal_owner_operational_job_events(job_id, sequence_number desc);
create function dialektik_validate_personal_owner_operational_job_event()
returns trigger language plpgsql as $$
declare latest personal_owner_operational_job_events;
begin
  select * into latest from personal_owner_operational_job_events
    where job_id = new.job_id order by sequence_number desc limit 1;
  if new.recorded_at > clock_timestamp()
    or (latest.id is null and new.sequence_number <> 1)
    or (latest.id is not null and new.sequence_number <> latest.sequence_number + 1)
    or (latest.state in ('BLOCKED','COMPLETED','FAILED','CANCELLED'))
    or (latest.state = 'PENDING' and new.state not in ('RUNNING','CANCELLED','FAILED'))
    or (latest.state = 'RUNNING' and new.state not in ('PROVIDER_REQUEST_STARTED','FAILED'))
    or (latest.state = 'PROVIDER_REQUEST_STARTED' and new.state not in ('COMPLETED','FAILED','RECONCILIATION_REQUIRED'))
    or (latest.state = 'RECONCILIATION_REQUIRED' and new.state not in ('COMPLETED','FAILED'))
    or (new.state = 'PROVIDER_REQUEST_STARTED' and latest.state <> 'RUNNING') then
    raise exception using errcode='23514', message='personal owner operational job transition is invalid';
  end if;
  return new;
end;
$$;
create trigger personal_owner_operational_job_events_validate
  before insert on personal_owner_operational_job_events
  for each row execute function dialektik_validate_personal_owner_operational_job_event();
create trigger personal_owner_operational_job_events_append_only
  before update or delete on personal_owner_operational_job_events
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_operational_job_events_no_truncate
  before truncate on personal_owner_operational_job_events
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_budget_reservations (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null unique references personal_owner_operational_jobs(id),
  owner_identity text not null references personal_owner_budget_controls(owner_identity),
  price_id dialektik_ulid not null references personal_owner_model_prices(id),
  reserved_microusd integer not null check (reserved_microusd between 1 and 2000000000),
  state text not null check (state in ('RESERVED','SETTLED','RELEASED','RECONCILIATION_REQUIRED')),
  actual_microusd integer check (actual_microusd is null or actual_microusd between 0 and 2000000000),
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  check ((state = 'SETTLED') = (actual_microusd is not null)),
  check (updated_at >= created_at and created_at <= clock_timestamp())
);
create index personal_owner_budget_reservations_owner_date
  on personal_owner_budget_reservations(owner_identity, created_at desc);
create table personal_owner_budget_events (
  id dialektik_ulid primary key,
  reservation_id dialektik_ulid not null references personal_owner_budget_reservations(id),
  event_type text not null check (event_type in ('RESERVED','SETTLED','RELEASED','RECONCILIATION_REQUIRED')),
  reserved_microusd integer not null check (reserved_microusd > 0),
  actual_microusd integer check (actual_microusd is null or actual_microusd >= 0),
  recorded_at timestamptz(3) not null check (recorded_at <= clock_timestamp()),
  check ((event_type = 'SETTLED') = (actual_microusd is not null))
);
create trigger personal_owner_budget_events_append_only
  before update or delete on personal_owner_budget_events
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_budget_events_no_truncate
  before truncate on personal_owner_budget_events
  for each statement execute function dialektik_semantic_content_append_only();

create function dialektik_reserve_personal_owner_budget(
  reservation_identity dialektik_ulid,
  job_identity dialektik_ulid,
  owner_identity text,
  price_identity dialektik_ulid,
  amount_microusd integer
) returns boolean language plpgsql volatile as $$
declare control_row personal_owner_budget_controls;
  total_reserved bigint;
  daily_reserved bigint;
  active_jobs integer;
  recent_requests integer;
begin
  select * into control_row from personal_owner_budget_controls
    where personal_owner_budget_controls.owner_identity = $3
    for update;
  if not found or not control_row.enabled or control_row.emergency_stop
    or control_row.revoked_at is not null or amount_microusd < 1
    or amount_microusd > control_row.per_request_limit_microusd
    or exists(select 1 from personal_owner_budget_reservations where job_id = $2) then
    return false;
  end if;
  select coalesce(sum(case when state = 'SETTLED' then actual_microusd else reserved_microusd end),0)
    into total_reserved from personal_owner_budget_reservations where owner_identity = control_row.owner_identity
      and state in ('RESERVED','SETTLED','RECONCILIATION_REQUIRED');
  select coalesce(sum(case when state = 'SETTLED' then actual_microusd else reserved_microusd end),0)
    into daily_reserved from personal_owner_budget_reservations where owner_identity = control_row.owner_identity
      and state in ('RESERVED','SETTLED','RECONCILIATION_REQUIRED')
      and created_at >= date_trunc('day', clock_timestamp());
  select count(*) into active_jobs from personal_owner_operational_jobs
    where owner_identity = control_row.owner_identity and id <> job_identity
      and state in ('PENDING','RUNNING','RECONCILIATION_REQUIRED');
  select count(*) into recent_requests from personal_owner_budget_reservations
    where owner_identity = control_row.owner_identity
      and created_at >= clock_timestamp() - interval '1 minute';
  if total_reserved + amount_microusd > control_row.total_limit_microusd
    or daily_reserved + amount_microusd > control_row.daily_limit_microusd
    or active_jobs >= control_row.max_concurrency
    or recent_requests >= control_row.max_requests_per_minute then
    return false;
  end if;
  insert into personal_owner_budget_reservations(
    id,job_id,owner_identity,price_id,reserved_microusd,state,actual_microusd,created_at,updated_at
  ) values ($1,$2,control_row.owner_identity,$4,
    amount_microusd,'RESERVED',null,date_trunc('milliseconds',clock_timestamp()),
    date_trunc('milliseconds',clock_timestamp()));
  insert into personal_owner_budget_events(id,reservation_id,event_type,reserved_microusd,actual_microusd,recorded_at)
    values ($1,$1,'RESERVED',amount_microusd,null,
      date_trunc('milliseconds',clock_timestamp()));
  return true;
end;
$$;
`;

export const personalOwnerOperationalPipelineMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner operational pipeline records are forward-only.');
  },
};
