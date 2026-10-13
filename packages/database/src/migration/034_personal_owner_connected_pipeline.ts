import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
-- V7-II adds a metadata/excerpt lane and scoped owner authorization. Existing
-- Gemini and scientific routes retain their prior policy and grant checks.
alter table personal_owner_audit_events drop constraint personal_owner_audit_events_event_type_check;
alter table personal_owner_audit_events add constraint personal_owner_audit_events_event_type_check
  check (event_type in ('OWNER_STATUS_VIEWED','SOURCE_REGISTERED','RIGHTS_DECISION_RECORDED',
    'MODEL_PRICE_RECORDED','SOURCE_CONNECTION_RECORDED','PROVIDER_AUTHORIZATION_RECORDED',
    'SOURCE_ACQUISITION_COMPLETED','OPERATIONAL_JOB_SUBMITTED','OPERATIONAL_JOB_CANCELLED',
    'BUDGET_RECONCILED'));
alter table personal_owner_source_rights_decisions
  add column local_processing boolean not null default false,
  add constraint personal_owner_source_local_processing_unverified
    check (decision_status <> 'UNVERIFIED' or local_processing = false);

-- A content version may have one active job or one provider attempt total.
-- This database invariant closes duplicate-submit races across API instances.
create unique index personal_owner_operational_jobs_one_attempt_per_version
  on personal_owner_operational_jobs(article_version_id)
  where attempt_count > 0 or state in ('PENDING','RUNNING','RECONCILIATION_REQUIRED');

create table personal_owner_source_connections (
  id dialektik_ulid primary key,
  owner_identity text not null check (owner_identity ~ '^[a-zA-Z0-9_.:-]{1,128}$'),
  source_id dialektik_ulid not null references sources(id),
  sequence_number integer not null check (sequence_number > 0),
  discovery_channel text not null check (discovery_channel = 'rss_atom'),
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  allowed_article_domains jsonb not null check (jsonb_typeof(allowed_article_domains) = 'array'),
  recorded_at timestamptz(3) not null check (recorded_at <= clock_timestamp()),
  unique(source_id, sequence_number)
);
create index personal_owner_source_connections_latest
  on personal_owner_source_connections(source_id, sequence_number desc);
create trigger personal_owner_source_connections_append_only
  before update or delete on personal_owner_source_connections
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_source_connections_no_truncate
  before truncate on personal_owner_source_connections
  for each statement execute function dialektik_semantic_content_append_only();
create function dialektik_validate_personal_owner_source_connection()
returns trigger language plpgsql as $$
begin
  perform 1 from prospective_content_rights_write_guards where source_id = new.source_id for update;
  if new.sequence_number <> coalesce((select max(sequence_number) + 1
      from personal_owner_source_connections where source_id = new.source_id), 1)
    or not exists(select 1 from sources s where s.id = new.source_id
      and lower(split_part(split_part(new.endpoint, '://', 2), '/', 1)) = s.canonical_domain)
    or jsonb_array_length(new.allowed_article_domains) < 1
    or jsonb_array_length(new.allowed_article_domains) > 8
    or exists(select 1 from jsonb_array_elements_text(new.allowed_article_domains) d
      where d.value !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$') then
    raise exception using errcode='23514', message='personal owner source connection is invalid';
  end if;
  return new;
end;
$$;
create trigger personal_owner_source_connections_validate
  before insert on personal_owner_source_connections
  for each row execute function dialektik_validate_personal_owner_source_connection();

create table personal_owner_provider_authorizations (
  id dialektik_ulid primary key,
  owner_identity text not null check (owner_identity ~ '^[a-zA-Z0-9_.:-]{1,128}$'),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id ~ '^@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  decision_status text not null check (decision_status in ('UNVERIFIED','AUTHORIZED','SUSPENDED','REVOKED')),
  evidence_url text,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  valid_from timestamptz(3) not null,
  expires_at timestamptz(3),
  recorded_at timestamptz(3) not null,
  check (expires_at is null or expires_at > valid_from),
  check (evidence_url is null or evidence_url ~ '^https://'),
  check (decision_status <> 'AUTHORIZED' or (evidence_url is not null
    and evidence_sha256 is not null and valid_from <= recorded_at
    and (expires_at is null or expires_at > recorded_at))),
  check (recorded_at <= clock_timestamp())
);
create index personal_owner_provider_authorizations_latest
  on personal_owner_provider_authorizations(owner_identity,provider_type,model_id,recorded_at desc,id desc);
create trigger personal_owner_provider_authorizations_append_only
  before update or delete on personal_owner_provider_authorizations
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_provider_authorizations_no_truncate
  before truncate on personal_owner_provider_authorizations
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_provider_attempts (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null unique references personal_owner_operational_jobs(id),
  state text not null check (state in ('CLAIMED','REQUEST_STARTED','RESPONSE_RECEIVED','OUTCOME_UNKNOWN')),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id ~ '^@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  claimed_at timestamptz(3) not null,
  request_started_at timestamptz(3),
  response_received_at timestamptz(3),
  response_sha256 text check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  error_category text check (error_category is null or error_category ~ '^[A-Z0-9_.:-]{1,96}$'),
  updated_at timestamptz(3) not null,
  check (claimed_at <= updated_at and (request_started_at is null or claimed_at <= request_started_at)
    and (response_received_at is null or request_started_at <= response_received_at)),
  check (state <> 'CLAIMED' or request_started_at is null),
  check (state not in ('REQUEST_STARTED','RESPONSE_RECEIVED') or request_started_at is not null),
  check ((state = 'RESPONSE_RECEIVED') = (response_received_at is not null))
);
create function dialektik_validate_personal_owner_provider_attempt()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'CLAIMED' or new.request_started_at is not null
      or not exists(select 1 from personal_owner_operational_jobs j
        join personal_owner_budget_reservations r on r.job_id=j.id
        where j.id=new.job_id and j.state='RUNNING' and j.attempt_count=0
          and j.provider_type=new.provider_type and j.model_id=new.model_id
          and r.state='RESERVED') then
      raise exception using errcode='23514', message='provider attempt requires a reserved running job';
    end if;
  elsif old.id is distinct from new.id or old.job_id is distinct from new.job_id
    or old.provider_type is distinct from new.provider_type or old.model_id is distinct from new.model_id
    or old.claimed_at is distinct from new.claimed_at
    or not ((old.state='CLAIMED' and new.state in ('REQUEST_STARTED','OUTCOME_UNKNOWN'))
      or (old.state='REQUEST_STARTED' and new.state in ('RESPONSE_RECEIVED','OUTCOME_UNKNOWN'))) then
    raise exception using errcode='23514', message='provider attempt transition is invalid';
  end if;
  return new;
end;
$$;
create trigger personal_owner_provider_attempts_validate
  before insert or update on personal_owner_provider_attempts
  for each row execute function dialektik_validate_personal_owner_provider_attempt();
create trigger personal_owner_provider_attempts_no_delete
  before delete on personal_owner_provider_attempts
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_provider_attempts_no_truncate
  before truncate on personal_owner_provider_attempts
  for each statement execute function dialektik_semantic_content_append_only();

create table personal_owner_budget_reconciliations (
  id dialektik_ulid primary key,
  job_id dialektik_ulid not null unique references personal_owner_operational_jobs(id),
  owner_identity text not null references personal_owner_budget_controls(owner_identity),
  outcome text not null check (outcome in ('CHARGED','NOT_CHARGED')),
  actual_microusd integer check (actual_microusd is null or actual_microusd between 0 and 2000000000),
  evidence_url text not null check (evidence_url ~ '^https://' and length(evidence_url) <= 2048),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz(3) not null,
  check ((outcome = 'CHARGED') = (actual_microusd is not null)),
  check (recorded_at <= clock_timestamp())
);
create trigger personal_owner_budget_reconciliations_append_only
  before update or delete on personal_owner_budget_reconciliations
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_budget_reconciliations_no_truncate
  before truncate on personal_owner_budget_reconciliations
  for each statement execute function dialektik_semantic_content_append_only();

alter table content_access_policies drop constraint content_access_policies_content_access_mode_check;
alter table content_access_policies add constraint content_access_policies_content_access_mode_check
  check (content_access_mode in ('METADATA_ONLY','EXCERPT_EPHEMERAL','FULLTEXT_EPHEMERAL','FULLTEXT_PERSISTED'));
alter table content_access_policies
  add column local_processing boolean not null default false,
  add column external_ai_transmission boolean not null default false,
  add column rights_evidence_sha256 text check (rights_evidence_sha256 is null or rights_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  add column personal_owner_source_rights_decision_id dialektik_ulid references personal_owner_source_rights_decisions(id);
alter table evidence_fingerprints drop constraint evidence_fingerprints_field_check;
alter table evidence_fingerprints add constraint evidence_fingerprints_field_check
  check (field in ('title','excerpt','body'));
alter table llm_processing_route_grants drop constraint llm_processing_route_grants_provider_type_check;
alter table llm_processing_route_grants add constraint llm_processing_route_grants_provider_type_check
  check (provider_type in ('llm_gemini','llm_cloudflare_workers_ai','authored_stub'));

create or replace function dialektik_validate_observed_content_version() returns trigger language plpgsql as $$
declare policy content_access_policies; article articles; prior observed_article_content_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_id::text,18));
  select * into strict policy from content_access_policies where id=new.policy_id and source_id=new.source_id;
  select * into strict article from articles where id=new.article_id;
  if policy.id is distinct from (select id from content_access_policies
      where source_id=new.source_id and recorded_at<=new.acquired_at order by recorded_at desc,id desc limit 1) then
    raise exception using errcode='23514',message='observed content requires current acquisition-time rights policy';
  end if;
  if article.source_id<>new.source_id or article.url_canonical<>new.canonical_url then
    raise exception using errcode='23514',message='observed content identity must match existing Article';
  end if;
  if new.original_title is not null and (not policy.metadata_storage
      or char_length(new.original_title)<>new.title_codepoint_length
      or encode(digest(convert_to(new.original_title,'UTF8'),'sha256'),'hex')<>new.title_input_hash) then
    raise exception using errcode='23514',message='observed title requires metadata rights and exact title identity';
  end if;
  if policy.content_access_mode='EXCERPT_EPHEMERAL' then
    if not policy.metadata_storage or not policy.excerpt_storage or not policy.local_processing
      or not policy.derived_semantic_persistence or policy.fulltext_acquisition
      or policy.fulltext_machine_processing or policy.fulltext_persistence or new.persisted_body is not null then
      raise exception using errcode='23514',message='excerpt observation requires separate storage, local processing, and derived persistence rights';
    end if;
    if not exists(select 1 from live_exposure_exclusions e join live_exposure_exclusions identity_exclusion
      on identity_exclusion.id=article.live_exposure_id where e.canonical_url=new.canonical_url
      and e.content_hash=new.acquired_content_hash and e.registry_key=identity_exclusion.registry_key
      and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
      raise exception using errcode='23514',message='excerpt input requires exact permanent exclusion provenance';
    end if;
  else
    if policy.content_access_mode='METADATA_ONLY' or not policy.metadata_storage
      or not policy.fulltext_acquisition or not policy.fulltext_machine_processing
      or not policy.derived_semantic_persistence then
      raise exception using errcode='23514',message='full content observation requires separate acquisition processing and derived persistence grants';
    end if;
    if policy.content_access_mode='FULLTEXT_EPHEMERAL' and new.persisted_body is not null then
      raise exception using errcode='23514',message='ephemeral content body persistence is forbidden';
    end if;
    if article.origin='LIVE_REAL' and not exists(select 1 from live_exposure_exclusions e
      join live_exposure_exclusions identity_exclusion on identity_exclusion.id=article.live_exposure_id
      where e.canonical_url=new.canonical_url and e.content_hash=new.normalized_input_hash
        and e.registry_key=identity_exclusion.registry_key
        and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
      raise exception using errcode='23514',message='real full content requires prior permanent exact-hash exclusion';
    end if;
  end if;
  if new.persisted_body is not null and (policy.content_access_mode<>'FULLTEXT_PERSISTED'
      or not policy.fulltext_persistence or char_length(new.persisted_body)<>new.input_codepoint_length
      or encode(digest(convert_to(new.persisted_body,'UTF8'),'sha256'),'hex')<>new.normalized_input_hash) then
    raise exception using errcode='23514',message='persisted body requires explicit rights and exact normalized identity';
  end if;
  select * into prior from observed_article_content_versions where article_id=new.article_id order by version_number desc limit 1;
  if prior.id is null then
    if new.version_number<>1 or new.previous_version_id is not null then
      raise exception using errcode='23514',message='first content version must begin at one';
    end if;
  elsif new.previous_version_id is distinct from prior.id or new.version_number<>prior.version_number+1
    or (new.normalized_input_hash=prior.normalized_input_hash and new.title_input_hash=prior.title_input_hash
      and new.acquired_content_hash=prior.acquired_content_hash and new.policy_id=prior.policy_id)
    or new.recorded_at<prior.recorded_at then
    raise exception using errcode='23514',message='changed content requires consecutive append-only observed version';
  end if;
  return new;
end;
$$;

create or replace function dialektik_validate_processing_record() returns trigger language plpgsql as $$
declare prior semantic_processing_records; version observed_article_content_versions; policy content_access_policies; run semantic_provider_runs;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_version_id::text||new.provider_run_id::text,18));
  select * into strict version from observed_article_content_versions where id=new.article_version_id;
  select * into strict policy from content_access_policies where id=version.policy_id;
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  if new.recorded_at<version.acquired_at or new.recorded_at<run.created_at then
    raise exception using errcode='23514',message='processing record cannot precede acquisition or provider run';
  end if;
  if (run.input_provenance='LIVE_REAL') is distinct from (exists(select 1 from articles a where a.id=version.article_id and a.origin='LIVE_REAL')) then
    raise exception using errcode='23514',message='provider provenance must match Article origin';
  end if;
  select * into prior from semantic_processing_records where article_version_id=new.article_version_id
    and provider_run_id=new.provider_run_id order by sequence_number desc limit 1;
  if prior.id is null then
    if new.sequence_number<>1 or new.previous_record_id is not null
      or new.processing_state not in ('NOT_ELIGIBLE','ELIGIBLE_UNPROCESSED') then
      raise exception using errcode='23514',message='processing begins with explicit independent eligibility';
    end if;
  elsif new.previous_record_id is distinct from prior.id or new.sequence_number<>prior.sequence_number+1
    or new.recorded_at<prior.recorded_at or not (
      (prior.processing_state='ELIGIBLE_UNPROCESSED' and new.processing_state in ('PROCESSING','PROCESSING_FAILED'))
      or (prior.processing_state='PROCESSING' and new.processing_state in ('PROCESSED_SHADOW','PROCESSING_FAILED'))) then
    raise exception using errcode='23514',message='processing transition requires consecutive append-only lineage';
  end if;
  if new.processing_state<>'NOT_ELIGIBLE' and (
      (policy.content_access_mode='EXCERPT_EPHEMERAL' and (not policy.metadata_storage or not policy.excerpt_storage
        or not policy.local_processing or not policy.derived_semantic_persistence))
      or (policy.content_access_mode not in ('EXCERPT_EPHEMERAL','METADATA_ONLY')
        and (not policy.fulltext_acquisition or not policy.fulltext_machine_processing or not policy.derived_semantic_persistence))
      or policy.content_access_mode='METADATA_ONLY') then
    raise exception using errcode='23514',message='semantic eligibility requires independent rights';
  end if;
  if new.processing_state='PROCESSED_SHADOW' and not exists(select 1 from semantic_envelopes
      where article_version_id=new.article_version_id and provider_run_id=new.provider_run_id) then
    raise exception using errcode='23514',message='processed shadow state requires durable envelope';
  end if;
  if new.processing_state='PROCESSING_FAILED' and exists(select 1 from semantic_envelopes
      where article_version_id=new.article_version_id and provider_run_id=new.provider_run_id) then
    raise exception using errcode='23514',message='failed processing cannot retain a successful envelope';
  end if;
  return new;
end;
$$;

-- Failure receipts retain hashes, never excerpt text. In excerpt mode, those
-- hashes are authorized by excerpt storage and local processing rather than
-- full-text acquisition/processing rights.
create or replace function dialektik_validate_processing_failure() returns trigger language plpgsql as $$
declare article articles; policy content_access_policies;
begin
  select * into strict article from articles where id=new.article_id;
  select * into strict policy from content_access_policies where id=new.policy_id and source_id=new.source_id;
  if article.source_id<>new.source_id
    or (new.input_provenance='LIVE_REAL') is distinct from (article.origin='LIVE_REAL') then
    raise exception using errcode='23514',message='failed attempt requires linked Article Source policy and declared provenance';
  end if;
  if (new.acquired_content_hash is not null or new.normalized_input_hash is not null or new.title_input_hash is not null)
    and (not policy.metadata_storage or policy.content_access_mode='METADATA_ONLY'
      or (policy.content_access_mode='EXCERPT_EPHEMERAL'
        and (not policy.excerpt_storage or not policy.local_processing))
      or (policy.content_access_mode<>'EXCERPT_EPHEMERAL'
        and (not policy.fulltext_acquisition
          or ((new.normalized_input_hash is not null or new.title_input_hash is not null)
            and not policy.fulltext_machine_processing)))) then
    raise exception using errcode='23514',message='failed attempt fingerprints require independent content storage and processing rights';
  end if;
  return new;
end;
$$;

create or replace function dialektik_validate_semantic_envelope() returns trigger language plpgsql as $$
declare version observed_article_content_versions; policy content_access_policies; run semantic_provider_runs; current_state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_version_id::text||new.provider_run_id::text,18));
  select * into strict version from observed_article_content_versions where id=new.article_version_id;
  select * into strict policy from content_access_policies where id=version.policy_id;
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  select processing_state into current_state from semantic_processing_records
    where article_version_id=new.article_version_id and provider_run_id=new.provider_run_id order by sequence_number desc limit 1;
  if current_state is distinct from 'PROCESSING' or not policy.derived_semantic_persistence
    or new.normalized_input_hash<>version.normalized_input_hash
    or new.normalization_version<>version.normalization_version
    or new.provider_type<>run.provider_type or new.provider_version<>run.provider_version
    or (run.provider_type='v10_11' and version.normalization_version<>'v10.11-original-fields-identity-v1')
    or new.processed_at<version.acquired_at or new.processed_at<(select recorded_at from semantic_processing_records
      where article_version_id=new.article_version_id and provider_run_id=new.provider_run_id order by sequence_number desc limit 1) then
    raise exception using errcode='23514',message='envelope requires exact input provider and active processing provenance';
  end if;
  if new.reproducibility_class='FULL_REPLAYABLE'
    and policy.content_access_mode='FULLTEXT_PERSISTED'
    and version.persisted_body is not null and version.original_title is null then
    raise exception using errcode='23514',message='FULL_REPLAYABLE requires exact retained title and body';
  end if;
  if new.reproducibility_class is distinct from (case
      when policy.content_access_mode='FULLTEXT_PERSISTED' and policy.fulltext_persistence
        and version.persisted_body is not null and version.original_title is not null
        then 'FULL_REPLAYABLE' else 'HASH_VERIFIABLE_REFETCH_REQUIRED' end) then
    raise exception using errcode='23514',message='replay class must reflect legitimate exact input retention';
  end if;
  return new;
end;
$$;

create or replace function dialektik_validate_evidence_fingerprint() returns trigger language plpgsql as $$
declare envelope semantic_envelopes; version observed_article_content_versions; policy content_access_policies;
  field_length integer; field_text text; quote_total integer; is_input_field boolean;
begin
  select * into strict envelope from semantic_envelopes where id=new.envelope_id;
  select * into strict version from observed_article_content_versions where id=envelope.article_version_id;
  select * into strict policy from content_access_policies where id=version.policy_id;
  is_input_field := new.field in ('body','excerpt');
  if new.article_version_id<>envelope.article_version_id or new.provider_run_id<>envelope.provider_run_id
    or new.input_hash<>version.acquired_content_hash or new.normalized_input_hash<>version.normalized_input_hash
    or new.normalization_version<>version.normalization_version
    or new.field_hash<>(case when is_input_field then version.normalized_input_hash else version.title_input_hash end)
    or (new.field='excerpt' and policy.content_access_mode<>'EXCERPT_EPHEMERAL') then
    raise exception using errcode='23514',message='evidence locator requires exact envelope field provenance';
  end if;
  field_length := case when is_input_field then version.input_codepoint_length else version.title_codepoint_length end;
  if new.span_end>field_length then
    raise exception using errcode='23514',message='evidence codepoint offsets must fit exact observed field';
  end if;
  field_text := case when is_input_field then version.persisted_body else version.original_title end;
  if field_text is not null and encode(digest(convert_to(substring(field_text from new.span_start+1 for new.span_end-new.span_start),'UTF8'),'sha256'),'hex')<>new.span_hash then
    raise exception using errcode='23514',message='evidence span hash must match exact retained field';
  end if;
  if new.retained_quote is not null then
    if not policy.minimal_evidence_fragment or policy.evidence_quote_max_codepoints=0
      or char_length(new.retained_quote)<>new.span_end-new.span_start
      or encode(digest(convert_to(new.retained_quote,'UTF8'),'sha256'),'hex')<>new.span_hash then
      raise exception using errcode='23514',message='evidence quote requires independent explicit rights and exact span hash';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(version.article_id::text||':'||version.normalized_input_hash||':quote-budget',19));
    select coalesce(sum(char_length(f.retained_quote)),0)::integer into quote_total
      from evidence_fingerprints f join observed_article_content_versions prior_version
        on prior_version.id=f.article_version_id
      where prior_version.article_id=version.article_id
        and prior_version.normalized_input_hash=version.normalized_input_hash;
    if quote_total+char_length(new.retained_quote)>policy.evidence_quote_max_codepoints
      or (is_input_field and char_length(new.retained_quote)>=version.input_codepoint_length)
      or (policy.content_access_mode in ('FULLTEXT_EPHEMERAL','EXCERPT_EPHEMERAL')
        and quote_total+char_length(new.retained_quote)>=version.input_codepoint_length) then
      raise exception using errcode='23514',message=case
        when policy.content_access_mode='EXCERPT_EPHEMERAL'
          then 'minimal evidence budget cannot become complete excerpt retention'
        else 'minimal evidence budget across Article body versions cannot become complete body retention'
      end;
    end if;
    new.quote_budget_start:=quote_total+1;
  else
    new.quote_budget_start:=null;
  end if;
  return new;
end;
$$;

drop function dialektik_llm_route_allowed(dialektik_ulid,dialektik_ulid,text,text,boolean);
create or replace function dialektik_llm_route_allowed(
  source_identity dialektik_ulid,
  article_identity dialektik_ulid,
  policy_identity text,
  provider text,
  external_route boolean,
  requested_model text default null
) returns boolean language plpgsql as $$
declare source_grant llm_processing_route_grants; article_grant llm_processing_route_grants;
  current_policy content_access_policies;
begin
  select * into current_policy from content_access_policies
    where source_id=source_identity and recorded_at<=statement_timestamp()
    order by recorded_at desc,id desc limit 1;
  if current_policy.id is distinct from policy_identity then return false; end if;
  if provider='llm_cloudflare_workers_ai' then
    if not external_route or requested_model is null
      or current_policy.content_access_mode <> 'EXCERPT_EPHEMERAL'
      or not current_policy.metadata_storage or not current_policy.excerpt_storage
      or not current_policy.local_processing or not current_policy.external_ai_transmission
      or not current_policy.derived_semantic_persistence
      or current_policy.fulltext_acquisition or current_policy.fulltext_machine_processing
      or current_policy.fulltext_persistence then return false; end if;
    select * into source_grant from llm_processing_route_grants
      where source_id=source_identity and article_id is null and provider_type=provider
        and policy_id=policy_identity and recorded_at<=statement_timestamp()
      order by recorded_at desc,id desc limit 1;
    select * into article_grant from llm_processing_route_grants
      where source_id=source_identity and article_id=article_identity and provider_type=provider
        and policy_id=policy_identity and recorded_at<=statement_timestamp()
      order by recorded_at desc,id desc limit 1;
    return source_grant.id is not null and article_grant.id is not null
      and source_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED'
      and article_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED'
      and not source_grant.fulltext_acquisition and not article_grant.fulltext_acquisition
      and not source_grant.machine_processing and not article_grant.machine_processing
      and source_grant.derived_persistence and article_grant.derived_persistence
      and not source_grant.fulltext_persistence and not article_grant.fulltext_persistence
      and not source_grant.evidence_fragments and not article_grant.evidence_fragments
      and exists(
        select 1 from personal_owner_operational_jobs j
        join personal_owner_budget_reservations br on br.job_id=j.id
        join personal_owner_budget_controls bc on bc.owner_identity=j.owner_identity
        join observed_article_content_versions v on v.id=j.article_version_id
        join articles a on a.id=j.article_id and a.source_id=j.source_id
        join live_exposure_exclusions x on x.id=a.live_exposure_id
        join lateral (select d.* from personal_owner_source_rights_decisions d
          where d.source_id=j.source_id order by d.sequence_number desc limit 1) d on true
        join lateral (select pa.* from personal_owner_provider_authorizations pa
          where pa.owner_identity=j.owner_identity and pa.provider_type=j.provider_type
            and pa.model_id=j.model_id order by pa.recorded_at desc,pa.id desc limit 1) pa on true
        where j.article_id=article_identity and j.source_id=source_identity
          and j.model_id=requested_model and j.provider_type=provider
          and j.state='RUNNING' and j.attempt_count <= 1
          and br.state in ('RESERVED','RECONCILIATION_REQUIRED')
          and bc.enabled and not bc.emergency_stop and bc.revoked_at is null
          and v.policy_id=policy_identity and v.persisted_body is null
          and a.origin='LIVE_REAL' and a.event_id is null
          and x.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'
          and d.decision_status='AUTHORIZED' and d.local_processing
          and d.valid_from<=statement_timestamp() and (d.expires_at is null or d.expires_at>statement_timestamp())
          and (d.scopes->>'acquisition')::boolean and (d.scopes->>'metadata_storage')::boolean
          and (d.scopes->>'excerpt_storage')::boolean
          and (d.scopes->>'external_ai_transmission')::boolean
          and (d.scopes->>'derived_semantic_persistence')::boolean
          and (d.scopes->>'redisplay')::boolean
          and pa.decision_status='AUTHORIZED' and pa.valid_from<=statement_timestamp()
          and (pa.expires_at is null or pa.expires_at>statement_timestamp())
      );
  end if;
  if not current_policy.fulltext_acquisition or not current_policy.fulltext_machine_processing
    or not current_policy.derived_semantic_persistence or current_policy.content_access_mode='METADATA_ONLY' then return false; end if;
  select * into source_grant from llm_processing_route_grants where source_id=source_identity and article_id is null and provider_type=provider and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  select * into article_grant from llm_processing_route_grants where source_id=source_identity and article_id=article_identity and provider_type=provider and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  if external_route and not exists(select 1 from articles a join sources s on s.id=a.source_id
    where a.id=article_identity and s.id=source_identity and a.origin='LIVE_REAL' and s.origin='LIVE_REAL' and a.event_id is null
    and exists(select 1 from live_exposure_exclusions e where e.canonical_url=a.url_canonical and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')) then return false; end if;
  return source_grant.policy_id is not distinct from policy_identity and article_grant.policy_id is not distinct from policy_identity
    and source_grant.fulltext_acquisition and article_grant.fulltext_acquisition
    and source_grant.machine_processing and article_grant.machine_processing
    and source_grant.derived_persistence and article_grant.derived_persistence
    and (current_policy.content_access_mode<>'FULLTEXT_PERSISTED' or (source_grant.fulltext_persistence and article_grant.fulltext_persistence))
    and (not current_policy.minimal_evidence_fragment or (source_grant.evidence_fragments and article_grant.evidence_fragments))
    and source_grant.processing_route in ('EXTERNAL_LLM_PROCESSING_ALLOWED','LOCAL_ONLY_PROCESSING')
    and article_grant.processing_route in ('EXTERNAL_LLM_PROCESSING_ALLOWED','LOCAL_ONLY_PROCESSING')
    and (not external_route or (source_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED' and article_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED'));
end;
$$;

-- The established LLM observation trigger predates Cloudflare and calls the
-- five-argument route function. Resolve its model from the exact active job;
-- this keeps its fail-closed rights, budget, stop, and authorization checks.
create or replace function dialektik_llm_route_allowed(
  source_identity dialektik_ulid,
  article_identity dialektik_ulid,
  policy_identity text,
  provider text,
  external_route boolean,
  requested_model text default null
) returns boolean language plpgsql as $$
declare source_grant llm_processing_route_grants; article_grant llm_processing_route_grants;
  current_policy content_access_policies;
begin
  if provider='llm_cloudflare_workers_ai' then
    if requested_model is null then
      select j.model_id into requested_model from personal_owner_operational_jobs j
        join llm_shadow_run_configurations c on c.provider_run_id=j.id
          and c.configuration->>'model'=j.model_id
        where j.article_id=article_identity and j.source_id=source_identity
          and j.provider_type=provider and j.state='RUNNING' and j.attempt_count<=1
          and exists(select 1 from jsonb_array_elements(c.input_manifest) m
            where m->>'articleId'=article_identity::text and m->>'versionId'=j.article_version_id::text
              and m->>'sourceId'=source_identity::text and m->>'policyId'=policy_identity)
        order by j.updated_at desc,j.id desc limit 1;
    end if;
    external_route:=true;
  end if;
  select * into current_policy from content_access_policies
    where source_id=source_identity and recorded_at<=statement_timestamp()
    order by recorded_at desc,id desc limit 1;
  if current_policy.id is distinct from policy_identity then return false; end if;
  if provider='llm_cloudflare_workers_ai' then
    if not external_route or requested_model is null
      or current_policy.content_access_mode <> 'EXCERPT_EPHEMERAL'
      or not current_policy.metadata_storage or not current_policy.excerpt_storage
      or not current_policy.local_processing or not current_policy.external_ai_transmission
      or not current_policy.derived_semantic_persistence
      or current_policy.fulltext_acquisition or current_policy.fulltext_machine_processing
      or current_policy.fulltext_persistence then return false; end if;
    select * into source_grant from llm_processing_route_grants
      where source_id=source_identity and article_id is null and provider_type=provider
        and policy_id=policy_identity and recorded_at<=statement_timestamp()
      order by recorded_at desc,id desc limit 1;
    select * into article_grant from llm_processing_route_grants
      where source_id=source_identity and article_id=article_identity and provider_type=provider
        and policy_id=policy_identity and recorded_at<=statement_timestamp()
      order by recorded_at desc,id desc limit 1;
    return source_grant.id is not null and article_grant.id is not null
      and source_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED'
      and article_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED'
      and not source_grant.fulltext_acquisition and not article_grant.fulltext_acquisition
      and not source_grant.machine_processing and not article_grant.machine_processing
      and source_grant.derived_persistence and article_grant.derived_persistence
      and not source_grant.fulltext_persistence and not article_grant.fulltext_persistence
      and not source_grant.evidence_fragments and not article_grant.evidence_fragments
      and exists(
        select 1 from personal_owner_operational_jobs j
        join personal_owner_budget_reservations br on br.job_id=j.id
        join personal_owner_budget_controls bc on bc.owner_identity=j.owner_identity
        join observed_article_content_versions v on v.id=j.article_version_id
        join articles a on a.id=j.article_id and a.source_id=j.source_id
        join live_exposure_exclusions x on x.id=a.live_exposure_id
        join lateral (select d.* from personal_owner_source_rights_decisions d
          where d.source_id=j.source_id order by d.sequence_number desc limit 1) d on true
        join lateral (select pa.* from personal_owner_provider_authorizations pa
          where pa.owner_identity=j.owner_identity and pa.provider_type=j.provider_type
            and pa.model_id=j.model_id order by pa.recorded_at desc,pa.id desc limit 1) pa on true
        where j.article_id=article_identity and j.source_id=source_identity
          and j.model_id=requested_model and j.provider_type=provider
          and j.state='RUNNING' and j.attempt_count <= 1
          and br.state in ('RESERVED','RECONCILIATION_REQUIRED')
          and bc.enabled and not bc.emergency_stop and bc.revoked_at is null
          and v.policy_id=policy_identity and v.persisted_body is null
          and a.origin='LIVE_REAL' and a.event_id is null
          and x.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'
          and d.decision_status='AUTHORIZED' and d.local_processing
          and d.valid_from<=statement_timestamp() and (d.expires_at is null or d.expires_at>statement_timestamp())
          and (d.scopes->>'acquisition')::boolean and (d.scopes->>'metadata_storage')::boolean
          and (d.scopes->>'excerpt_storage')::boolean
          and (d.scopes->>'external_ai_transmission')::boolean
          and (d.scopes->>'derived_semantic_persistence')::boolean
          and (d.scopes->>'redisplay')::boolean
          and pa.decision_status='AUTHORIZED' and pa.valid_from<=statement_timestamp()
          and (pa.expires_at is null or pa.expires_at>statement_timestamp())
      );
  end if;
  if not current_policy.fulltext_acquisition or not current_policy.fulltext_machine_processing
    or not current_policy.derived_semantic_persistence or current_policy.content_access_mode='METADATA_ONLY' then return false; end if;
  select * into source_grant from llm_processing_route_grants where source_id=source_identity and article_id is null and provider_type=provider and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  select * into article_grant from llm_processing_route_grants where source_id=source_identity and article_id=article_identity and provider_type=provider and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  if external_route and not exists(select 1 from articles a join sources s on s.id=a.source_id
    where a.id=article_identity and s.id=source_identity and a.origin='LIVE_REAL' and s.origin='LIVE_REAL' and a.event_id is null
    and exists(select 1 from live_exposure_exclusions e where e.canonical_url=a.url_canonical and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')) then return false; end if;
  return source_grant.policy_id is not distinct from policy_identity and article_grant.policy_id is not distinct from policy_identity
    and source_grant.fulltext_acquisition and article_grant.fulltext_acquisition
    and source_grant.machine_processing and article_grant.machine_processing
    and source_grant.derived_persistence and article_grant.derived_persistence
    and (current_policy.content_access_mode<>'FULLTEXT_PERSISTED' or (source_grant.fulltext_persistence and article_grant.fulltext_persistence))
    and (not current_policy.minimal_evidence_fragment or (source_grant.evidence_fragments and article_grant.evidence_fragments))
    and source_grant.processing_route in ('EXTERNAL_LLM_PROCESSING_ALLOWED','LOCAL_ONLY_PROCESSING')
    and article_grant.processing_route in ('EXTERNAL_LLM_PROCESSING_ALLOWED','LOCAL_ONLY_PROCESSING')
    and (not external_route or (source_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED' and article_grant.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED'));
end;
$$;

create or replace function dialektik_llm_processed_requires_grounding() returns trigger language plpgsql as $$
declare run semantic_provider_runs;
begin
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  if new.processing_state='PROCESSED_SHADOW'
    and (run.provider_type in ('llm_gemini','llm_cloudflare_workers_ai') or run.provider_version like 'product-llm-v1.%')
    and not exists(select 1 from semantic_envelopes e join llm_shadow_observations o on o.envelope_id=e.id
      where e.provider_run_id=run.id and e.article_version_id=new.article_version_id) then
    raise exception using errcode='23514',message='LLM processed state requires grounded typed envelope extension';
  end if;
  return new;
end;
$$;

create or replace function dialektik_llm_run_requires_config() returns trigger language plpgsql as $$
begin
  if (new.provider_type in ('llm_gemini','llm_cloudflare_workers_ai') or new.provider_version like 'product-llm-v1.%')
    and not exists(select 1 from llm_shadow_run_configurations where provider_run_id=new.id) then
    raise exception using errcode='23514',message='LLM provider run requires independently frozen product configuration';
  end if;
  return new;
end;
$$;

create or replace function dialektik_validate_llm_route_grant() returns trigger language plpgsql as $$
begin
  if new.recorded_at > clock_timestamp() or (new.article_id is not null and not exists(
      select 1 from articles where id=new.article_id and source_id=new.source_id)) then
    raise exception using errcode='23514',message='LLM grant requires exact Source Article and nonfuture receipt';
  end if;
  if new.provider_type='llm_cloudflare_workers_ai' and not exists(
      select 1 from personal_owner_operational_jobs j
      join personal_owner_budget_reservations r on r.job_id=j.id
      join personal_owner_budget_controls c on c.owner_identity=j.owner_identity
      join lateral (select d.* from personal_owner_source_rights_decisions d
        where d.source_id=j.source_id order by d.sequence_number desc limit 1) d on true
      join lateral (select pa.* from personal_owner_provider_authorizations pa
        where pa.owner_identity=j.owner_identity and pa.provider_type=j.provider_type
          and pa.model_id=j.model_id order by pa.recorded_at desc,pa.id desc limit 1) pa on true
      where j.source_id=new.source_id and j.provider_type=new.provider_type
        and j.state='PENDING' and j.model_id is not null and r.state='RESERVED'
        and c.enabled and not c.emergency_stop and c.revoked_at is null
        and (new.article_id is null or new.article_id=j.article_id)
        and exists(select 1 from observed_article_content_versions v
          where v.id=j.article_version_id and v.policy_id=new.policy_id
            and v.persisted_body is null)
        and d.decision_status='AUTHORIZED' and d.local_processing
        and d.valid_from<=clock_timestamp() and (d.expires_at is null or d.expires_at>clock_timestamp())
        and (d.scopes->>'acquisition')::boolean and (d.scopes->>'metadata_storage')::boolean
        and (d.scopes->>'excerpt_storage')::boolean
        and (d.scopes->>'external_ai_transmission')::boolean
        and (d.scopes->>'derived_semantic_persistence')::boolean
        and pa.decision_status='AUTHORIZED' and pa.valid_from<=clock_timestamp()
        and (pa.expires_at is null or pa.expires_at>clock_timestamp())
  ) then
    raise exception using errcode='23514',message='Cloudflare route grant requires an authorized reserved PersonalOwner job';
  end if;
  return new;
end;
$$;

create or replace function dialektik_validate_llm_run_config() returns trigger language plpgsql as $$
declare run semantic_provider_runs; cfg jsonb; entry jsonb;
begin
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  cfg:=new.configuration;
  if not dialektik_llm_closed_object(cfg,array['model','providerVersion','configHash','promptVersion','schemaVersion','retrievalVersion','graphVersion','maxArticles','maxCalls','topK','timeoutMs','maxRetries','concurrency','maxOutputTokens'],array['string','string','string','string','string','string','string','number','number','number','number','number','number','number']) or jsonb_typeof(cfg) is distinct from 'object' or (select count(*) from jsonb_object_keys(cfg))<>14
    or not (cfg ?& array['model','providerVersion','configHash','promptVersion','schemaVersion','retrievalVersion','graphVersion','maxArticles','maxCalls','topK','timeoutMs','maxRetries','concurrency','maxOutputTokens'])
    or cfg->>'configHash'<>new.config_hash or cfg->>'providerVersion'<>run.provider_version
    or run.provider_version<>(case when run.provider_type='llm_cloudflare_workers_ai'
      then 'product-cloudflare-workers-ai-v1.' else 'product-llm-v1.' end)||substr(new.config_hash,1,24)
    or run.candidate_commit is not null or run.runtime_python is not null
    or run.provider_type not in ('llm_gemini','llm_cloudflare_workers_ai','authored_stub')
    or run.run_identity not like 'LLM_SEMANTIC_SHADOW_%'
    or (run.provider_type='authored_stub' and cfg->>'model' not like 'recorded-%')
    or (run.provider_type='llm_gemini' and (cfg->>'model' not like 'gemini-%' or run.input_provenance<>'LIVE_REAL'))
    or (run.provider_type='llm_cloudflare_workers_ai' and (cfg->>'model' not like '@cf/%' or run.input_provenance<>'LIVE_REAL'))
    or (cfg->>'maxArticles')::integer not between 1 and 30 or (cfg->>'maxCalls')::integer not between 1 and 120
    or (cfg->>'topK')::integer not between 1 and 5 or (cfg->>'timeoutMs')::integer not between 1 and 120000
    or cfg->>'maxRetries'<>'0' or cfg->>'concurrency'<>'1' or cfg->>'maxOutputTokens'<>'4096'
    or cfg->>'promptVersion'<>'product-llm-prompts-v1' or cfg->>'schemaVersion'<>'product-llm-schema-v1'
    or cfg->>'retrievalVersion'<>'fact-index-topk-v1' or cfg->>'graphVersion'<>'proposal-builder-v1'
    or length(cfg->>'model')>128 or cfg->>'model'!~'^[A-Za-z0-9@_.:/-]+$'
    or new.recorded_at<run.created_at then
    raise exception using errcode='23514',message='LLM run requires exact bounded independent provider configuration';
  end if;
  if jsonb_typeof(new.input_manifest) is distinct from 'array' or jsonb_array_length(new.input_manifest) not between 1 and (cfg->>'maxArticles')::integer then
    raise exception using errcode='23514',message='LLM run requires bounded frozen input manifest';
  end if;
  for entry in select value from jsonb_array_elements(new.input_manifest) loop
    if not dialektik_llm_closed_object(entry,array['articleId','versionId','sourceId','policyId','inputHash','titleHash'],array['string','string','string','string','string','string']) or jsonb_typeof(entry) is distinct from 'object' or (select count(*) from jsonb_object_keys(entry))<>6
      or not(entry ?& array['articleId','versionId','sourceId','policyId','inputHash','titleHash'])
      or entry->>'inputHash'!~'^[0-9a-f]{64}$' or entry->>'titleHash'!~'^[0-9a-f]{64}$' or entry->>'policyId'!~'^[0-9a-f]{64}$'
      or entry->>'versionId'!~'^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
      or not exists(
        select 1 from articles a
        join live_exposure_exclusions identity_x on identity_x.id=a.live_exposure_id
        join observed_article_content_versions v on v.article_id=a.id
        join content_access_policies p on p.id=v.policy_id
        join live_exposure_exclusions e on e.canonical_url=a.url_canonical
          and e.registry_key=identity_x.registry_key
        where a.id::text=entry->>'articleId' and a.source_id::text=entry->>'sourceId'
          and a.event_id is null and v.id::text=entry->>'versionId' and v.source_id=a.source_id
          and v.policy_id=entry->>'policyId' and v.normalized_input_hash=entry->>'inputHash'
          and v.title_input_hash=entry->>'titleHash'
          and e.content_hash=case when p.content_access_mode='EXCERPT_EPHEMERAL'
            then v.acquired_content_hash else v.normalized_input_hash end
          and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
      or (run.provider_type in ('llm_gemini','llm_cloudflare_workers_ai') and not exists(select 1 from articles a join sources s on s.id=a.source_id
        where a.id::text=entry->>'articleId' and a.origin='LIVE_REAL' and s.origin='LIVE_REAL')) then
      raise exception using errcode='23514',message='LLM manifest contains unsupported identity or nonhash input';
    end if;
  end loop;
  if (select count(distinct x->>'articleId') from jsonb_array_elements(new.input_manifest) x)<>jsonb_array_length(new.input_manifest) then
    raise exception using errcode='23514',message='LLM manifest cannot repeat Article identities';
  end if;
  return new;
end;
$$;

create or replace function dialektik_validate_llm_call() returns trigger language plpgsql as $$
declare config llm_shadow_run_configurations; run semantic_provider_runs; entry jsonb;
begin
  select * into strict config from llm_shadow_run_configurations where provider_run_id=new.provider_run_id;
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  select m into entry from jsonb_array_elements(config.input_manifest) m where m->>'articleId'=new.article_id::text;
  if entry is not null then perform 1 from prospective_content_rights_write_guards where source_id=(entry->>'sourceId')::dialektik_ulid for update; end if;
  if entry is null or (select count(*) from llm_shadow_call_claims where provider_run_id=new.provider_run_id)>=(config.configuration->>'maxCalls')::integer
    or exists(select 1 from llm_shadow_call_claims c left join llm_shadow_call_outcomes o on o.call_key=c.call_key where c.provider_run_id=new.provider_run_id and o.call_key is null)
    or exists(select 1 from semantic_shadow_graph_snapshots where provider_run_id=new.provider_run_id)
    or not dialektik_llm_route_allowed((entry->>'sourceId')::dialektik_ulid,new.article_id,entry->>'policyId',run.provider_type,run.provider_type in ('llm_gemini','llm_cloudflare_workers_ai'),config.configuration->>'model') then
    raise exception using errcode='23514',message='LLM call requires frozen bounds and current Source AND Article route';
  end if;
  return new;
end;
$$;

drop function dialektik_reserve_personal_owner_budget(dialektik_ulid,dialektik_ulid,text,dialektik_ulid,integer);
create function dialektik_reserve_personal_owner_budget(
  reservation_identity dialektik_ulid,
  job_identity dialektik_ulid,
  owner_identity text,
  price_identity dialektik_ulid,
  amount_microusd integer
) returns boolean language plpgsql volatile as $$
declare control_row personal_owner_budget_controls; total_reserved bigint; daily_reserved bigint;
  active_jobs integer; recent_requests integer;
begin
  select * into control_row from personal_owner_budget_controls control
    where control.owner_identity=$3 for update;
  if not found or not control_row.enabled or control_row.emergency_stop or control_row.revoked_at is not null
    or amount_microusd < 1 or amount_microusd > control_row.per_request_limit_microusd
    or exists(select 1 from personal_owner_budget_reservations reservation where reservation.job_id=$2) then return false; end if;
  select coalesce(sum(case when state='SETTLED' then actual_microusd else reserved_microusd end),0)
    into total_reserved from personal_owner_budget_reservations reservation where reservation.owner_identity=control_row.owner_identity
      and reservation.state in ('RESERVED','SETTLED','RECONCILIATION_REQUIRED');
  select coalesce(sum(case when state='SETTLED' then actual_microusd else reserved_microusd end),0)
    into daily_reserved from personal_owner_budget_reservations reservation where reservation.owner_identity=control_row.owner_identity
      and reservation.state in ('RESERVED','SETTLED','RECONCILIATION_REQUIRED')
      and reservation.created_at>=date_trunc('day',clock_timestamp());
  select count(*) into active_jobs from personal_owner_operational_jobs job where job.owner_identity=control_row.owner_identity
    and job.id<>job_identity and job.state in ('PENDING','RUNNING','RECONCILIATION_REQUIRED');
  select count(*) into recent_requests from personal_owner_budget_reservations reservation
    where reservation.owner_identity=control_row.owner_identity
      and reservation.created_at>=clock_timestamp()-interval '1 minute';
  if total_reserved+amount_microusd>control_row.total_limit_microusd
    or daily_reserved+amount_microusd>control_row.daily_limit_microusd
    or active_jobs>=control_row.max_concurrency or recent_requests>=control_row.max_requests_per_minute then return false; end if;
  insert into personal_owner_budget_reservations(id,job_id,owner_identity,price_id,reserved_microusd,state,actual_microusd,created_at,updated_at)
    values($1,$2,control_row.owner_identity,$4,amount_microusd,'RESERVED',null,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp()));
  insert into personal_owner_budget_events(id,reservation_id,event_type,reserved_microusd,actual_microusd,recorded_at)
    values($1,$1,'RESERVED',amount_microusd,null,date_trunc('milliseconds',clock_timestamp()));
  return true;
end;
$$;

alter table personal_owner_operational_jobs drop constraint personal_owner_operational_jobs_state_check;
alter table personal_owner_operational_jobs add constraint personal_owner_operational_jobs_state_check
  check (state in ('BLOCKED','PENDING','RUNNING','RECONCILIATION_REQUIRED','COMPLETED','FAILED','CANCELLED'));
alter table personal_owner_operational_job_events drop constraint personal_owner_operational_job_events_state_check;
alter table personal_owner_operational_job_events add constraint personal_owner_operational_job_events_state_check
  check (state in ('BLOCKED','PENDING','RUNNING','PROVIDER_REQUEST_STARTED','RECOVERED_PENDING',
    'RECONCILIATION_REQUIRED','COMPLETED','FAILED','CANCELLED'));
create or replace function dialektik_validate_personal_owner_operational_job_event()
returns trigger language plpgsql as $$
declare latest personal_owner_operational_job_events;
begin
  select * into latest from personal_owner_operational_job_events where job_id=new.job_id order by sequence_number desc limit 1;
  if new.recorded_at>clock_timestamp() or (latest.id is null and new.sequence_number<>1)
    or (latest.id is not null and new.sequence_number<>latest.sequence_number+1)
    or (latest.state in ('BLOCKED','COMPLETED','FAILED','CANCELLED'))
    or (latest.state='PENDING' and new.state not in ('RUNNING','CANCELLED','FAILED'))
    or (latest.state='RUNNING' and new.state not in ('PROVIDER_REQUEST_STARTED','RECOVERED_PENDING','FAILED','CANCELLED'))
    or (latest.state='RECOVERED_PENDING' and new.state not in ('RUNNING','CANCELLED','FAILED'))
    or (latest.state='PROVIDER_REQUEST_STARTED' and new.state not in ('COMPLETED','FAILED','RECONCILIATION_REQUIRED'))
    or (latest.state='RECONCILIATION_REQUIRED' and new.state not in ('COMPLETED','FAILED'))
    or (new.state='PROVIDER_REQUEST_STARTED' and latest.state<>'RUNNING') then
    raise exception using errcode='23514',message='personal owner operational job transition is invalid';
  end if;
  return new;
end;
$$;
`;

export const personalOwnerConnectedPipelineMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner connected pipeline records are forward-only.');
  },
};
