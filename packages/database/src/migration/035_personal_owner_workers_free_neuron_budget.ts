import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
alter table personal_owner_audit_events drop constraint personal_owner_audit_events_event_type_check;
alter table personal_owner_audit_events add constraint personal_owner_audit_events_event_type_check
  check (event_type in ('OWNER_STATUS_VIEWED','SOURCE_REGISTERED','RIGHTS_DECISION_RECORDED',
    'MODEL_PRICE_RECORDED','SOURCE_CONNECTION_RECORDED','PROVIDER_AUTHORIZATION_RECORDED',
    'SOURCE_ACQUISITION_COMPLETED','OPERATIONAL_JOB_SUBMITTED','OPERATIONAL_JOB_CANCELLED',
    'BUDGET_RECONCILED','PROVIDER_AUTO_SUSPENDED'));

alter table personal_owner_model_prices
  add column input_neurons_per_million_tokens integer not null default 0
    check (input_neurons_per_million_tokens between 0 and 1000000000),
  add column output_neurons_per_million_tokens integer not null default 0
    check (output_neurons_per_million_tokens between 0 and 1000000000);

alter table personal_owner_budget_controls
  add column workers_ai_plan text not null default 'UNVERIFIED'
    check (workers_ai_plan in ('UNVERIFIED','FREE')),
  add column paid_overage_disabled boolean not null default false,
  add column workers_ai_plan_evidence_url text,
  add column workers_ai_plan_evidence_sha256 text
    check (workers_ai_plan_evidence_sha256 is null or workers_ai_plan_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  add column workers_ai_plan_verified_until timestamptz(3),
  add column daily_neuron_limit integer not null default 8000
    check (daily_neuron_limit between 1 and 8000),
  add column per_request_neuron_limit integer not null default 1500
    check (per_request_neuron_limit between 1 and 1500),
  add constraint personal_owner_workers_free_requires_evidence
    check (workers_ai_plan <> 'FREE' or
      (paid_overage_disabled and workers_ai_plan_evidence_url is not null
        and workers_ai_plan_evidence_url ~ '^https://'
        and workers_ai_plan_evidence_sha256 is not null
        and workers_ai_plan_verified_until is not null
        and max_concurrency = 1 and max_requests_per_minute = 1));

create table personal_owner_neuron_reservations (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null unique references personal_owner_operational_jobs(id),
  owner_identity text not null references personal_owner_budget_controls(owner_identity),
  model_id text not null check (model_id = '@cf/openai/gpt-oss-20b'),
  utc_day date not null,
  reserved_neurons integer not null check (reserved_neurons between 1 and 8000),
  actual_neurons integer check (actual_neurons is null or actual_neurons between 0 and 2000000000),
  state text not null check (state in ('RESERVED','SETTLED','RELEASED','RECONCILIATION_REQUIRED')),
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  check ((state = 'SETTLED') = (actual_neurons is not null)),
  check (updated_at >= created_at and created_at <= clock_timestamp())
);
create index personal_owner_neuron_reservations_daily
  on personal_owner_neuron_reservations(owner_identity,utc_day,state);
create index personal_owner_neuron_reservations_owner_created
  on personal_owner_neuron_reservations(owner_identity,created_at desc);

create table personal_owner_neuron_events (
  id dialektik_ulid primary key,
  reservation_id dialektik_ulid not null references personal_owner_neuron_reservations(id),
  event_type text not null check (event_type in ('RESERVED','SETTLED','RELEASED','RECONCILIATION_REQUIRED')),
  reserved_neurons integer not null check (reserved_neurons between 1 and 8000),
  actual_neurons integer check (actual_neurons is null or actual_neurons between 0 and 2000000000),
  recorded_at timestamptz(3) not null check (recorded_at <= clock_timestamp()),
  check ((event_type = 'SETTLED') = (actual_neurons is not null))
);
create index personal_owner_neuron_events_reservation
  on personal_owner_neuron_events(reservation_id,recorded_at);
create trigger personal_owner_neuron_events_append_only
  before update or delete on personal_owner_neuron_events
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_neuron_events_no_truncate
  before truncate on personal_owner_neuron_events
  for each statement execute function dialektik_semantic_content_append_only();

create function dialektik_reserve_personal_owner_neurons(
  reservation_identity dialektik_ulid,
  job_identity dialektik_ulid,
  owner_identity text,
  model_identity text,
  amount_neurons integer
) returns boolean language plpgsql volatile as $$
declare control_row personal_owner_budget_controls; daily_reserved bigint;
  active_jobs integer; recent_requests integer; utc_today date;
begin
  utc_today := (clock_timestamp() at time zone 'UTC')::date;
  select * into control_row from personal_owner_budget_controls
    where personal_owner_budget_controls.owner_identity=$3 for update;
  if not found or not control_row.enabled or control_row.emergency_stop
    or control_row.revoked_at is not null or control_row.workers_ai_plan <> 'FREE'
    or not control_row.paid_overage_disabled
    or control_row.workers_ai_plan_evidence_url is null
    or control_row.workers_ai_plan_evidence_sha256 is null
    or control_row.workers_ai_plan_verified_until <= clock_timestamp()
    or control_row.max_concurrency <> 1 or control_row.max_requests_per_minute <> 1
    or $4 <> '@cf/openai/gpt-oss-20b'
    or amount_neurons < 1 or amount_neurons > control_row.per_request_neuron_limit
    or control_row.daily_neuron_limit > 8000
    or exists(select 1 from personal_owner_neuron_reservations where job_id=$2) then
    return false;
  end if;
  select coalesce(sum(case when state='SETTLED' then actual_neurons else reserved_neurons end),0)
    into daily_reserved from personal_owner_neuron_reservations
    where owner_identity=control_row.owner_identity and utc_day=utc_today
      and state in ('RESERVED','SETTLED','RECONCILIATION_REQUIRED');
  select count(*) into active_jobs from personal_owner_operational_jobs
    where owner_identity=control_row.owner_identity and id<>job_identity
      and state in ('PENDING','RUNNING','RECONCILIATION_REQUIRED');
  select count(*) into recent_requests from personal_owner_neuron_reservations
    where owner_identity=control_row.owner_identity
      and created_at >= clock_timestamp()-interval '1 minute';
  if daily_reserved+amount_neurons>control_row.daily_neuron_limit
    or active_jobs>=control_row.max_concurrency or recent_requests>=control_row.max_requests_per_minute then
    return false;
  end if;
  insert into personal_owner_neuron_reservations(
    id,job_id,owner_identity,model_id,utc_day,reserved_neurons,actual_neurons,state,created_at,updated_at
  ) values($1,$2,control_row.owner_identity,$4,utc_today,amount_neurons,null,'RESERVED',
    date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp()));
  insert into personal_owner_neuron_events(id,reservation_id,event_type,reserved_neurons,actual_neurons,recorded_at)
    values($1,$1,'RESERVED',amount_neurons,null,date_trunc('milliseconds',clock_timestamp()));
  return true;
end;
$$;
`;

export const personalOwnerWorkersFreeNeuronBudgetMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Workers Free neuron accounting is forward-only.');
  },
};
