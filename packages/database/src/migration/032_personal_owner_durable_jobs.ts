import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
create table personal_owner_test_job_runtime (
  job_id dialektik_ulid primary key references personal_owner_test_jobs(id),
  state text not null check (state in (
    'PENDING','RUNNING','RECOVERABLE','RECONCILIATION_REQUIRED',
    'COMPLETED','FAILED','CANCELLED'
  )),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 1),
  safe_recovery_count smallint not null default 0 check (safe_recovery_count between 0 and 3),
  lease_owner text,
  lease_expires_at timestamptz(3),
  heartbeat_at timestamptz(3),
  provider_request_started_at timestamptz(3),
  completed_at timestamptz(3),
  error_category text check (error_category is null or error_category ~ '^[A-Z0-9_.:-]{1,96}$'),
  updated_at timestamptz(3) not null,
  check ((state = 'RUNNING' and lease_owner is not null and lease_expires_at is not null and heartbeat_at is not null)
    or (state <> 'RUNNING' and lease_owner is null and lease_expires_at is null and heartbeat_at is null)),
  check ((attempt_count = 1) = (provider_request_started_at is not null)),
  check (state not in ('PENDING','RECOVERABLE') or attempt_count = 0),
  check (state <> 'RECONCILIATION_REQUIRED' or attempt_count = 1),
  check ((state in ('COMPLETED','FAILED','CANCELLED')) = (completed_at is not null))
);
create index personal_owner_test_job_runtime_ready
  on personal_owner_test_job_runtime(state, lease_expires_at, updated_at);

create table personal_owner_test_job_lifecycle_events (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null references personal_owner_test_jobs(id),
  sequence_number integer not null check (sequence_number > 0),
  state text not null check (state in (
    'PENDING','RUNNING','PROVIDER_REQUEST_STARTED','RECOVERABLE',
    'RECONCILIATION_REQUIRED','COMPLETED','FAILED','CANCELLED'
  )),
  worker_id text check (worker_id is null or worker_id ~ '^[a-f0-9-]{36}$'),
  attempt_count smallint not null check (attempt_count between 0 and 1),
  error_category text check (error_category is null or error_category ~ '^[A-Z0-9_.:-]{1,96}$'),
  recorded_at timestamptz(3) not null,
  unique(job_id, sequence_number)
);
create index personal_owner_test_job_lifecycle_latest
  on personal_owner_test_job_lifecycle_events(job_id, sequence_number desc);

create function dialektik_validate_personal_owner_test_job_lifecycle_event()
returns trigger language plpgsql as $$
declare latest personal_owner_test_job_lifecycle_events;
begin
  select * into latest from personal_owner_test_job_lifecycle_events
    where job_id = new.job_id order by sequence_number desc limit 1;
  if (latest.id is null and (new.sequence_number <> 1 or
      (new.state <> 'PENDING' and not exists (
        select 1 from personal_owner_test_job_events legacy where legacy.job_id = new.job_id
      ))))
    or (latest.id is not null and new.sequence_number <> latest.sequence_number + 1)
    or (latest.state in ('COMPLETED','FAILED','CANCELLED'))
    or (latest.state = 'PENDING' and new.state not in ('RUNNING','CANCELLED'))
    or (latest.state = 'RUNNING' and new.state not in (
      'PROVIDER_REQUEST_STARTED','RECOVERABLE','FAILED'
    ))
    or (latest.state = 'PROVIDER_REQUEST_STARTED' and new.state not in (
      'COMPLETED','RECONCILIATION_REQUIRED','FAILED'
    ))
    or (latest.state = 'RECOVERABLE' and new.state not in ('RUNNING','FAILED','CANCELLED'))
    or (latest.state = 'RECONCILIATION_REQUIRED' and new.state not in ('COMPLETED','FAILED'))
    or (new.state = 'PROVIDER_REQUEST_STARTED' and
      (latest.state <> 'RUNNING' or new.attempt_count <> 1))
    or (new.state in ('PENDING','RUNNING','RECOVERABLE','CANCELLED') and new.attempt_count <> 0)
    or (new.state in ('RECONCILIATION_REQUIRED','COMPLETED') and new.attempt_count <> 1)
    or new.recorded_at > clock_timestamp() then
    raise exception using errcode='23514', message='personal test lifecycle transition is invalid';
  end if;
  return new;
end;
$$;
create trigger personal_owner_test_job_lifecycle_validate
  before insert on personal_owner_test_job_lifecycle_events
  for each row execute function dialektik_validate_personal_owner_test_job_lifecycle_event();
create trigger personal_owner_test_job_lifecycle_append_only
  before update or delete on personal_owner_test_job_lifecycle_events
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_test_job_lifecycle_no_truncate
  before truncate on personal_owner_test_job_lifecycle_events
  for each statement execute function dialektik_semantic_content_append_only();

create function dialektik_validate_personal_owner_test_job_runtime()
returns trigger language plpgsql as $$
declare transition_allowed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'PENDING' or new.attempt_count <> 0 or new.safe_recovery_count <> 0
      or new.lease_owner is not null or new.provider_request_started_at is not null
      or new.completed_at is not null then
      raise exception using errcode='23514', message='personal test runtime must begin pending';
    end if;
    return new;
  end if;
  if new.job_id is distinct from old.job_id
    or new.updated_at < old.updated_at
    or new.attempt_count < old.attempt_count
    or new.safe_recovery_count < old.safe_recovery_count
    or new.safe_recovery_count > old.safe_recovery_count + 1
    or (old.provider_request_started_at is not null and
        new.provider_request_started_at is distinct from old.provider_request_started_at)
    or (old.attempt_count = 0 and new.attempt_count not in (0,1))
    or ((new.attempt_count = 1) <> (new.provider_request_started_at is not null))
    or (new.lease_owner is not null and new.lease_owner !~ '^[a-f0-9-]{36}$')
    or (new.lease_expires_at is not null and new.heartbeat_at is not null
        and new.lease_expires_at <= new.heartbeat_at) then
    raise exception using errcode='23514', message='personal test runtime identity or lease invalid';
  end if;

  if new.state = old.state then
    transition_allowed := old.state = 'RUNNING'
      and new.lease_owner = old.lease_owner
      and new.lease_expires_at >= old.lease_expires_at
      and new.heartbeat_at >= old.heartbeat_at
      and new.completed_at is null;
  else
    transition_allowed :=
      (old.state = 'PENDING' and new.state in ('RUNNING','CANCELLED'))
      or (old.state = 'RUNNING' and new.state in (
        'RECOVERABLE','RECONCILIATION_REQUIRED','COMPLETED','FAILED'
      ))
      or (old.state = 'RECOVERABLE' and new.state in ('RUNNING','CANCELLED','FAILED'))
      or (old.state = 'RECONCILIATION_REQUIRED' and new.state in ('COMPLETED','FAILED'));
  end if;
  if not transition_allowed then
    raise exception using errcode='23514', message='personal test runtime transition is invalid';
  end if;
  if new.state = 'RECOVERABLE' and
      (old.attempt_count <> 0 or new.attempt_count <> 0
       or new.safe_recovery_count <> old.safe_recovery_count + 1) then
    raise exception using errcode='23514', message='only a pre-request recovery may be retried';
  end if;
  if new.state = 'RECONCILIATION_REQUIRED' and
      (old.attempt_count <> 1 or new.attempt_count <> 1) then
    raise exception using errcode='23514', message='uncertain provider outcomes require reconciliation';
  end if;
  if new.state in ('COMPLETED','FAILED','CANCELLED') then
    if new.completed_at is null or new.lease_owner is not null
      or new.lease_expires_at is not null or new.heartbeat_at is not null then
      raise exception using errcode='23514', message='terminal personal test job must release its lease';
    end if;
  elsif new.completed_at is not null then
    raise exception using errcode='23514', message='nonterminal personal test job cannot be completed';
  end if;
  return new;
end;
$$;
create trigger personal_owner_test_job_runtime_validate
  before insert or update on personal_owner_test_job_runtime
  for each row execute function dialektik_validate_personal_owner_test_job_runtime();

create function dialektik_initialize_personal_owner_test_job_runtime()
returns trigger language plpgsql as $$
declare now_at timestamptz(3);
begin
  now_at := date_trunc('milliseconds',clock_timestamp());
  insert into personal_owner_test_job_runtime(job_id,state,updated_at)
  values (new.id,'PENDING',now_at);
  insert into personal_owner_test_job_lifecycle_events(
    id,job_id,sequence_number,state,worker_id,attempt_count,error_category,recorded_at
  ) values (new.id,new.id,1,'PENDING',null,0,null,now_at);
  return new;
end;
$$;
create trigger personal_owner_test_job_runtime_initialize
  after insert on personal_owner_test_jobs
  for each row execute function dialektik_initialize_personal_owner_test_job_runtime();

with latest as (
  select distinct on (job_id) job_id, id, state, sequence_number, recorded_at
  from personal_owner_test_job_events
  order by job_id, sequence_number desc, id desc
), first_running as (
  select distinct on (job_id) job_id, recorded_at
  from personal_owner_test_job_events
  where state = 'RUNNING'
  order by job_id, sequence_number, id
), legacy as (
  select j.id as job_id, coalesce(l.id, j.id) as event_id,
    case coalesce(l.state,'RESERVED')
      when 'RESERVED' then 'PENDING'
      when 'RUNNING' then 'RECONCILIATION_REQUIRED'
      when 'SUCCEEDED' then 'COMPLETED'
      when 'FAILED' then 'FAILED'
      when 'CANCELLED' then 'CANCELLED'
    end as mapped_state,
    case when coalesce(l.state,'RESERVED') in ('RUNNING','SUCCEEDED','FAILED') then 1 else 0 end
      as attempt_count,
    coalesce(fr.recorded_at, l.recorded_at) as request_started_at,
    coalesce(l.recorded_at, j.created_at) as recorded_at
  from personal_owner_test_jobs j
  left join latest l on l.job_id = j.id
  left join first_running fr on fr.job_id = j.id
)
insert into personal_owner_test_job_runtime(
  job_id,state,attempt_count,provider_request_started_at,completed_at,updated_at
)
select job_id,mapped_state,attempt_count,request_started_at,
  case when mapped_state in ('COMPLETED','FAILED','CANCELLED') then recorded_at else null end,
  recorded_at
from legacy;

with latest as (
  select distinct on (job_id) job_id, id, state, sequence_number, recorded_at
  from personal_owner_test_job_events
  order by job_id, sequence_number desc, id desc
), legacy as (
  select j.id as job_id, coalesce(l.id,j.id) as event_id,
    case coalesce(l.state,'RESERVED')
      when 'RESERVED' then 'PENDING'
      when 'RUNNING' then 'RECONCILIATION_REQUIRED'
      when 'SUCCEEDED' then 'COMPLETED'
      when 'FAILED' then 'FAILED'
      when 'CANCELLED' then 'CANCELLED'
    end as mapped_state,
    case when coalesce(l.state,'RESERVED') in ('RUNNING','SUCCEEDED','FAILED') then 1 else 0 end
      as attempt_count,
    coalesce(l.recorded_at,j.created_at) as recorded_at
  from personal_owner_test_jobs j
  left join latest l on l.job_id=j.id
)
insert into personal_owner_test_job_lifecycle_events(
  id,job_id,sequence_number,state,worker_id,attempt_count,error_category,recorded_at
)
select event_id,job_id,1,mapped_state,null,attempt_count,null,recorded_at from legacy;
`;

export const personalOwnerDurableJobsMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner durable job records are forward-only.');
  },
};
