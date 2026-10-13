import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
-- Preserve existing RSS provenance; an official API acquisition must never be labelled RSS.
alter table live_acquisition_receipts drop constraint live_acquisition_receipts_discovery_channel_check;
alter table live_acquisition_receipts add constraint live_acquisition_receipts_discovery_channel_check
  check (discovery_channel in ('rss_atom', 'official_api'));

create table content_access_policies (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  source_id dialektik_ulid not null references sources(id),
  content_access_mode text not null default 'METADATA_ONLY'
    check (content_access_mode in ('METADATA_ONLY', 'FULLTEXT_EPHEMERAL', 'FULLTEXT_PERSISTED')),
  metadata_storage boolean not null default false,
  excerpt_storage boolean not null default false,
  fulltext_acquisition boolean not null default false,
  fulltext_machine_processing boolean not null default false,
  fulltext_persistence boolean not null default false,
  derived_semantic_persistence boolean not null default false,
  minimal_evidence_fragment boolean not null default false,
  redisplay boolean not null default false,
  external_source_link boolean not null default false,
  evidence_quote_max_codepoints integer not null default 0
    check (evidence_quote_max_codepoints between 0 and 512),
  rights_evidence_url text not null check (rights_evidence_url ~ '^https://' and length(rights_evidence_url) <= 2048),
  rights_verified_at timestamptz(3) not null,
  recorded_at timestamptz(3) not null,
  unique (source_id, id),
  check (rights_verified_at <= recorded_at),
  check (minimal_evidence_fragment or evidence_quote_max_codepoints = 0),
  check (content_access_mode <> 'FULLTEXT_PERSISTED' or fulltext_persistence)
);
create index content_policies_by_source on content_access_policies(source_id, recorded_at desc, id);

create table observed_article_content_versions (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  source_id dialektik_ulid not null references sources(id),
  policy_id text not null,
  previous_version_id dialektik_ulid references observed_article_content_versions(id),
  version_number integer not null check (version_number > 0),
  canonical_url text not null check (canonical_url ~ '^https://' and length(canonical_url) <= 2048),
  publisher_item_id text check (publisher_item_id is null or length(publisher_item_id) between 1 and 512),
  original_title text check (original_title is null or char_length(original_title) between 1 and 1024),
  published_at timestamptz(3) not null,
  available_at timestamptz(3) not null,
  modified_at timestamptz(3),
  acquired_at timestamptz(3) not null,
  language text check (language is null or language ~ '^[A-Za-z][A-Za-z0-9-]{0,34}$'),
  content_encoding text not null check (content_encoding = 'utf-8'),
  acquired_content_hash text not null check (acquired_content_hash ~ '^[0-9a-f]{64}$'),
  normalized_input_hash text not null check (normalized_input_hash ~ '^[0-9a-f]{64}$'),
  title_input_hash text not null check (title_input_hash ~ '^[0-9a-f]{64}$'),
  normalization_version text not null check (normalization_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  input_codepoint_length integer not null check (input_codepoint_length > 0),
  title_codepoint_length integer not null check (title_codepoint_length > 0),
  persisted_body text,
  recorded_at timestamptz(3) not null,
  foreign key (source_id, policy_id) references content_access_policies(source_id, id),
  unique (article_id, version_number),
  check ((version_number = 1) = (previous_version_id is null)),
  check (acquired_at >= available_at)
);
create unique index observed_content_versions_single_successor
  on observed_article_content_versions(previous_version_id) where previous_version_id is not null;
create index observed_content_versions_by_article
  on observed_article_content_versions(article_id, version_number desc);

create table semantic_provider_runs (
  id dialektik_ulid primary key,
  provider_type text not null check (provider_type ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  provider_version text not null check (provider_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  candidate_commit text check (candidate_commit is null or candidate_commit ~ '^[0-9a-f]{40}$'),
  runtime_python text check (runtime_python is null or runtime_python ~ '^[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,3}$'),
  runtime_model text check (runtime_model is null or runtime_model ~ '^[A-Za-z0-9_.:/-]{1,128}$'),
  run_identity text not null unique check (run_identity ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  input_provenance text not null check (input_provenance in ('AUTHORED_STUB', 'LIVE_REAL')),
  created_at timestamptz(3) not null,
  check ((input_provenance = 'AUTHORED_STUB') = (provider_type = 'authored_stub')),
  check (provider_type <> 'authored_stub' or (candidate_commit is null and runtime_python is null and runtime_model is null)),
  check (provider_type <> 'v10_11' or (
    candidate_commit is not distinct from 'ea47eb75e955b9a51d15dc0135c81145130553ca'
    and provider_version = 'phase3v10.11-applicability-replay-v1'
    and runtime_python is not distinct from '3.11.9' and runtime_model is not distinct from 'none'))
);

create table semantic_processing_records (
  id dialektik_ulid primary key,
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  provider_run_id dialektik_ulid not null references semantic_provider_runs(id),
  previous_record_id dialektik_ulid references semantic_processing_records(id),
  sequence_number integer not null check (sequence_number > 0),
  processing_state text not null check (processing_state in (
    'NOT_ELIGIBLE', 'ELIGIBLE_UNPROCESSED', 'PROCESSING', 'PROCESSED_SHADOW', 'PROCESSING_FAILED')),
  error_code text check (error_code in (
    'RIGHTS_DENIED', 'ACQUISITION_FAILED', 'PARSE_FAILED', 'NORMALIZATION_FAILED',
    'INPUT_INVALID', 'PROVIDER_TIMEOUT', 'PROVIDER_FAILED', 'MAPPING_FAILED', 'PERSISTENCE_FAILED')),
  recorded_at timestamptz(3) not null,
  unique (article_version_id, provider_run_id, sequence_number),
  check ((sequence_number = 1) = (previous_record_id is null)),
  check ((processing_state = 'PROCESSING_FAILED') = (error_code is not null))
);
create unique index semantic_processing_single_successor
  on semantic_processing_records(previous_record_id) where previous_record_id is not null;

create table semantic_processing_failures (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  source_id dialektik_ulid not null references sources(id),
  policy_id text not null,
  provider_type text not null check (provider_type ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  provider_version text not null check (provider_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  run_identity text not null check (run_identity ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  input_provenance text not null check (input_provenance in ('AUTHORED_STUB', 'LIVE_REAL')),
  error_code text not null check (error_code in (
    'RIGHTS_DENIED', 'ACQUISITION_FAILED', 'PARSE_FAILED', 'NORMALIZATION_FAILED',
    'INPUT_INVALID', 'PROVIDER_TIMEOUT', 'PROVIDER_FAILED', 'MAPPING_FAILED', 'PERSISTENCE_FAILED')),
  acquired_content_hash text check (acquired_content_hash is null or acquired_content_hash ~ '^[0-9a-f]{64}$'),
  normalized_input_hash text check (normalized_input_hash is null or normalized_input_hash ~ '^[0-9a-f]{64}$'),
  title_input_hash text check (title_input_hash is null or title_input_hash ~ '^[0-9a-f]{64}$'),
  failed_at timestamptz(3) not null,
  foreign key (source_id, policy_id) references content_access_policies(source_id, id),
  unique (article_id, run_identity),
  check ((input_provenance = 'AUTHORED_STUB') = (provider_type = 'authored_stub'))
);
create index semantic_failures_by_article on semantic_processing_failures(article_id, failed_at desc, id);

create table semantic_envelopes (
  id dialektik_ulid primary key,
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  normalized_input_hash text not null check (normalized_input_hash ~ '^[0-9a-f]{64}$'),
  normalization_version text not null check (normalization_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  provider_type text not null check (provider_type ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  provider_version text not null check (provider_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  provider_run_id dialektik_ulid not null references semantic_provider_runs(id),
  reproducibility_class text not null check (reproducibility_class in (
    'FULL_REPLAYABLE', 'HASH_VERIFIABLE_REFETCH_REQUIRED', 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE')),
  authority text not null check (authority = 'SHADOW_NOT_AUTHORITATIVE'),
  processed_at timestamptz(3) not null,
  unique (article_version_id, provider_run_id)
);

create table derived_semantic_observations (
  id dialektik_ulid primary key,
  envelope_id dialektik_ulid not null references semantic_envelopes(id),
  observation_key text not null check (observation_key ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  decision shadow_semantic_decision not null,
  applicability shadow_semantic_applicability not null,
  proposed_occurrence_key text check (proposed_occurrence_key is null or proposed_occurrence_key ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  proposed_thread_key text check (proposed_thread_key is null or proposed_thread_key ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  unique (envelope_id, observation_key)
);

create table evidence_fingerprints (
  id dialektik_ulid primary key,
  envelope_id dialektik_ulid not null references semantic_envelopes(id),
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  provider_run_id dialektik_ulid not null references semantic_provider_runs(id),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  normalized_input_hash text not null check (normalized_input_hash ~ '^[0-9a-f]{64}$'),
  normalization_version text not null check (normalization_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  field text not null check (field in ('title', 'body')),
  field_hash text not null check (field_hash ~ '^[0-9a-f]{64}$'),
  span_start integer not null check (span_start >= 0),
  span_end integer not null check (span_end > span_start),
  span_hash text not null check (span_hash ~ '^[0-9a-f]{64}$'),
  context_hash text check (context_hash is null or context_hash ~ '^[0-9a-f]{64}$'),
  retained_quote text,
  quote_budget_start integer check (quote_budget_start is null or quote_budget_start > 0),
  unique (envelope_id, field, span_start, span_end, span_hash),
  unique (article_version_id, quote_budget_start),
  check ((retained_quote is null) = (quote_budget_start is null))
);

create table semantic_article_proposals (
  id dialektik_ulid primary key,
  envelope_id dialektik_ulid not null unique references semantic_envelopes(id),
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  provider_run_id dialektik_ulid not null references semantic_provider_runs(id),
  action text not null check (action in ('update_occurrence', 'new_occurrence_in_existing_thread', 'new_thread', 'ambiguous')),
  reason_code text not null check (reason_code in (
    'no_bounded_occurrence_observation', 'multi_observation_article_requires_decomposition',
    'multiple_identity_matches', 'occurrence_thread_incompatibility', 'no_automatic_occurrence_reparent',
    'unique_occurrence_match', 'thread_match_all_children_distinct', 'occurrence_identity_unknown',
    'thread_identity_unknown', 'unresolved_prior_thread_comparison', 'unresolved_prior_occurrence_comparison',
    'grounded_process_distinct_from_all_prior')),
  proposed_occurrence_key text check (proposed_occurrence_key is null or proposed_occurrence_key ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  proposed_thread_key text check (proposed_thread_key is null or proposed_thread_key ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  partial_occurrence_creation boolean not null,
  check (not partial_occurrence_creation or proposed_occurrence_key is not null)
);

create table semantic_candidate_applicability (
  id dialektik_ulid primary key,
  envelope_id dialektik_ulid not null references semantic_envelopes(id),
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  provider_run_id dialektik_ulid not null references semantic_provider_runs(id),
  scope text not null check (scope in ('OCCURRENCE', 'THREAD')),
  target_key text not null check (target_key ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  outcome shadow_semantic_applicability not null
);

create table semantic_refetch_verifications (
  id dialektik_ulid primary key,
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  expected_input_hash text not null check (expected_input_hash ~ '^[0-9a-f]{64}$'),
  expected_title_hash text not null check (expected_title_hash ~ '^[0-9a-f]{64}$'),
  refetched_input_hash text check (refetched_input_hash is null or refetched_input_hash ~ '^[0-9a-f]{64}$'),
  refetched_title_hash text check (refetched_title_hash is null or refetched_title_hash ~ '^[0-9a-f]{64}$'),
  normalization_version text not null check (normalization_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  source_version_status text not null check (source_version_status in (
    'HASH_MATCH', 'SOURCE_VERSION_CHANGED', 'SOURCE_UNAVAILABLE')),
  reproducibility_class text not null check (reproducibility_class in (
    'FULL_REPLAYABLE', 'HASH_VERIFIABLE_REFETCH_REQUIRED', 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE')),
  verified_at timestamptz(3) not null
);
create index semantic_refetch_by_version
  on semantic_refetch_verifications(article_version_id, verified_at desc, id);

create function dialektik_semantic_content_append_only() returns trigger language plpgsql as $$
begin
  raise exception using errcode = '23514', message = 'semantic content provenance is append-only';
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'content_access_policies', 'observed_article_content_versions', 'semantic_provider_runs',
    'semantic_processing_records', 'semantic_processing_failures', 'semantic_envelopes', 'derived_semantic_observations',
    'evidence_fingerprints', 'semantic_refetch_verifications', 'semantic_article_proposals', 'semantic_candidate_applicability'
  ] loop
    execute format('create trigger %I before update or delete on %I for each row execute function dialektik_semantic_content_append_only()',
      table_name || '_immutable', table_name);
    execute format('create trigger %I before truncate on %I for each statement execute function dialektik_semantic_content_append_only()',
      table_name || '_no_truncate', table_name);
  end loop;
end;
$$;

create function dialektik_validate_observed_content_version() returns trigger language plpgsql as $$
declare policy content_access_policies; article articles; prior observed_article_content_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_id::text, 18));
  select * into strict policy from content_access_policies where id = new.policy_id and source_id = new.source_id;
  select * into strict article from articles where id = new.article_id;
  if policy.id is distinct from (select id from content_access_policies
    where source_id = new.source_id and recorded_at <= new.acquired_at
    order by recorded_at desc, id desc limit 1) then
    raise exception using errcode = '23514', message = 'observed content requires current acquisition-time rights policy';
  end if;
  if article.source_id <> new.source_id or article.url_canonical <> new.canonical_url then
    raise exception using errcode = '23514', message = 'observed content identity must match existing Article';
  end if;
  if new.original_title is not null and (not policy.metadata_storage
    or char_length(new.original_title) <> new.title_codepoint_length
    or encode(digest(convert_to(new.original_title, 'UTF8'), 'sha256'), 'hex') <> new.title_input_hash) then
    raise exception using errcode = '23514', message = 'observed title requires metadata rights and exact title identity';
  end if;
  if policy.content_access_mode = 'METADATA_ONLY' or not policy.metadata_storage or not policy.fulltext_acquisition
    or not policy.fulltext_machine_processing or not policy.derived_semantic_persistence then
    raise exception using errcode = '23514', message = 'full content observation requires separate acquisition processing and derived persistence grants';
  end if;
  if policy.content_access_mode = 'FULLTEXT_EPHEMERAL' and new.persisted_body is not null then
    raise exception using errcode = '23514', message = 'ephemeral content body persistence is forbidden';
  end if;
  if new.persisted_body is not null and (policy.content_access_mode <> 'FULLTEXT_PERSISTED'
    or not policy.fulltext_persistence
    or char_length(new.persisted_body) <> new.input_codepoint_length
    or encode(digest(convert_to(new.persisted_body, 'UTF8'), 'sha256'), 'hex') <> new.normalized_input_hash) then
    raise exception using errcode = '23514', message = 'persisted body requires explicit rights and exact normalized identity';
  end if;
  if policy.content_access_mode = 'FULLTEXT_EPHEMERAL' and (
    encode(digest(convert_to(article.text_original, 'UTF8'), 'sha256'), 'hex') = new.normalized_input_hash
    or encode(digest(convert_to(article.text_normalized, 'UTF8'), 'sha256'), 'hex') = new.normalized_input_hash
    or exists (select 1 from article_representations r where r.article_id = new.article_id
      and (encode(digest(convert_to(r.body, 'UTF8'), 'sha256'), 'hex') = new.normalized_input_hash
        or encode(digest(convert_to(r.canonical_text, 'UTF8'), 'sha256'), 'hex') = new.normalized_input_hash))) then
    raise exception using errcode = '23514', message = 'ephemeral input cannot already be retained in legacy body storage';
  end if;
  if article.origin = 'LIVE_REAL' and not exists (
    select 1 from live_exposure_exclusions e join live_exposure_exclusions identity_exclusion
      on identity_exclusion.id = article.live_exposure_id
    where e.canonical_url = new.canonical_url and e.content_hash = new.normalized_input_hash
      and e.registry_key = identity_exclusion.registry_key
      and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'
  ) then
    raise exception using errcode = '23514', message = 'real full content requires prior permanent exact-hash exclusion';
  end if;
  select * into prior from observed_article_content_versions
    where article_id = new.article_id order by version_number desc limit 1;
  if prior.id is null then
    if new.version_number <> 1 or new.previous_version_id is not null then
      raise exception using errcode = '23514', message = 'first content version must begin at one';
    end if;
  elsif new.previous_version_id is distinct from prior.id or new.version_number <> prior.version_number + 1
    or (new.normalized_input_hash = prior.normalized_input_hash and new.title_input_hash = prior.title_input_hash
      and new.acquired_content_hash = prior.acquired_content_hash and new.policy_id = prior.policy_id)
    or new.recorded_at < prior.recorded_at then
    raise exception using errcode = '23514', message = 'changed content requires consecutive append-only observed version';
  end if;
  return new;
end;
$$;
create trigger observed_content_versions_validate before insert on observed_article_content_versions
  for each row execute function dialektik_validate_observed_content_version();

create function dialektik_validate_processing_record() returns trigger language plpgsql as $$
declare prior semantic_processing_records; version observed_article_content_versions; policy content_access_policies; run semantic_provider_runs;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_version_id::text || new.provider_run_id::text, 18));
  select * into strict version from observed_article_content_versions where id = new.article_version_id;
  select * into strict policy from content_access_policies where id = version.policy_id;
  select * into strict run from semantic_provider_runs where id = new.provider_run_id;
  if new.recorded_at < version.acquired_at or new.recorded_at < run.created_at then
    raise exception using errcode = '23514', message = 'processing record cannot precede acquisition or provider run';
  end if;
  if (run.input_provenance = 'LIVE_REAL') is distinct from (exists (
    select 1 from articles a where a.id = version.article_id and a.origin = 'LIVE_REAL')) then
    raise exception using errcode = '23514', message = 'provider provenance must match Article origin';
  end if;
  select * into prior from semantic_processing_records where article_version_id = new.article_version_id
    and provider_run_id = new.provider_run_id order by sequence_number desc limit 1;
  if prior.id is null then
    if new.sequence_number <> 1 or new.previous_record_id is not null
      or new.processing_state not in ('NOT_ELIGIBLE', 'ELIGIBLE_UNPROCESSED') then
      raise exception using errcode = '23514', message = 'processing begins with explicit independent eligibility';
    end if;
  elsif new.previous_record_id is distinct from prior.id or new.sequence_number <> prior.sequence_number + 1
    or new.recorded_at < prior.recorded_at or not (
      (prior.processing_state = 'ELIGIBLE_UNPROCESSED' and new.processing_state in ('PROCESSING', 'PROCESSING_FAILED'))
      or (prior.processing_state = 'PROCESSING' and new.processing_state in ('PROCESSED_SHADOW', 'PROCESSING_FAILED'))
    ) then
    raise exception using errcode = '23514', message = 'processing transition requires consecutive append-only lineage';
  end if;
  if new.processing_state <> 'NOT_ELIGIBLE' and (policy.content_access_mode = 'METADATA_ONLY'
    or not policy.fulltext_acquisition or not policy.fulltext_machine_processing
    or not policy.derived_semantic_persistence) then
    raise exception using errcode = '23514', message = 'semantic eligibility requires independent rights';
  end if;
  if new.processing_state = 'PROCESSED_SHADOW' and not exists (select 1 from semantic_envelopes
    where article_version_id = new.article_version_id and provider_run_id = new.provider_run_id) then
    raise exception using errcode = '23514', message = 'processed shadow state requires durable envelope';
  end if;
  if new.processing_state = 'PROCESSING_FAILED' and exists (select 1 from semantic_envelopes
    where article_version_id = new.article_version_id and provider_run_id = new.provider_run_id) then
    raise exception using errcode = '23514', message = 'failed processing cannot retain a successful envelope';
  end if;
  return new;
end;
$$;
create trigger semantic_processing_validate before insert on semantic_processing_records
  for each row execute function dialektik_validate_processing_record();

create function dialektik_validate_processing_failure() returns trigger language plpgsql as $$
declare article articles; policy content_access_policies;
begin
  select * into strict article from articles where id = new.article_id;
  select * into strict policy from content_access_policies where id = new.policy_id and source_id = new.source_id;
  if article.source_id <> new.source_id
    or (new.input_provenance = 'LIVE_REAL') is distinct from (article.origin = 'LIVE_REAL') then
    raise exception using errcode = '23514', message = 'failed attempt requires linked Article Source policy and declared provenance';
  end if;
  if (new.acquired_content_hash is not null or new.normalized_input_hash is not null or new.title_input_hash is not null)
    and (not policy.metadata_storage or not policy.fulltext_acquisition
      or ((new.normalized_input_hash is not null or new.title_input_hash is not null) and not policy.fulltext_machine_processing)) then
    raise exception using errcode = '23514', message = 'failed attempt fingerprints require independent metadata acquisition and processing rights';
  end if;
  return new;
end;
$$;
create trigger semantic_processing_failures_validate before insert on semantic_processing_failures
  for each row execute function dialektik_validate_processing_failure();

create function dialektik_validate_semantic_envelope() returns trigger language plpgsql as $$
declare version observed_article_content_versions; policy content_access_policies; run semantic_provider_runs; current_state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_version_id::text || new.provider_run_id::text, 18));
  select * into strict version from observed_article_content_versions where id = new.article_version_id;
  select * into strict policy from content_access_policies where id = version.policy_id;
  select * into strict run from semantic_provider_runs where id = new.provider_run_id;
  select processing_state into current_state from semantic_processing_records
    where article_version_id = new.article_version_id and provider_run_id = new.provider_run_id
    order by sequence_number desc limit 1;
  if current_state is distinct from 'PROCESSING' or not policy.derived_semantic_persistence
    or new.normalized_input_hash <> version.normalized_input_hash
    or new.normalization_version <> version.normalization_version
    or new.provider_type <> run.provider_type or new.provider_version <> run.provider_version
    or (run.provider_type = 'v10_11' and version.normalization_version <> 'v10.11-original-fields-identity-v1')
    or new.processed_at < version.acquired_at
    or new.processed_at < (select recorded_at from semantic_processing_records
      where article_version_id = new.article_version_id and provider_run_id = new.provider_run_id
      order by sequence_number desc limit 1) then
    raise exception using errcode = '23514', message = 'envelope requires exact input provider and active processing provenance';
  end if;
  if new.reproducibility_class is distinct from (case
    when policy.content_access_mode = 'FULLTEXT_PERSISTED' and policy.fulltext_persistence and version.persisted_body is not null
      then 'FULL_REPLAYABLE' else 'HASH_VERIFIABLE_REFETCH_REQUIRED' end) then
    raise exception using errcode = '23514', message = 'replay class must reflect legitimate exact input retention';
  end if;
  return new;
end;
$$;
create trigger semantic_envelopes_validate before insert on semantic_envelopes
  for each row execute function dialektik_validate_semantic_envelope();

create function dialektik_require_open_envelope() returns trigger language plpgsql as $$
declare envelope semantic_envelopes; current_state text;
begin
  select * into strict envelope from semantic_envelopes where id = new.envelope_id;
  perform pg_advisory_xact_lock(hashtextextended(envelope.article_version_id::text || envelope.provider_run_id::text, 18));
  select processing_state into current_state from semantic_processing_records
    where article_version_id = envelope.article_version_id and provider_run_id = envelope.provider_run_id
    order by sequence_number desc limit 1;
  if current_state is distinct from 'PROCESSING' then
    raise exception using errcode = '23514', message = 'completed envelope children are immutable';
  end if;
  return new;
end;
$$;
create trigger derived_semantic_observations_open before insert on derived_semantic_observations
  for each row execute function dialektik_require_open_envelope();
create trigger evidence_fingerprints_open before insert on evidence_fingerprints
  for each row execute function dialektik_require_open_envelope();
create trigger semantic_article_proposals_open before insert on semantic_article_proposals
  for each row execute function dialektik_require_open_envelope();
create trigger semantic_candidate_applicability_open before insert on semantic_candidate_applicability
  for each row execute function dialektik_require_open_envelope();

create function dialektik_validate_semantic_child_identity() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from semantic_envelopes where id = new.envelope_id
    and article_version_id = new.article_version_id and provider_run_id = new.provider_run_id) then
    raise exception using errcode = '23514', message = 'semantic child requires exact envelope version and provider run';
  end if;
  return new;
end;
$$;
create trigger semantic_article_proposals_validate before insert on semantic_article_proposals
  for each row execute function dialektik_validate_semantic_child_identity();
create trigger semantic_candidate_applicability_validate before insert on semantic_candidate_applicability
  for each row execute function dialektik_validate_semantic_child_identity();

create function dialektik_validate_evidence_fingerprint() returns trigger language plpgsql as $$
declare envelope semantic_envelopes; version observed_article_content_versions; policy content_access_policies; field_length integer; field_text text; quote_total integer;
begin
  select * into strict envelope from semantic_envelopes where id = new.envelope_id;
  select * into strict version from observed_article_content_versions where id = envelope.article_version_id;
  select * into strict policy from content_access_policies where id = version.policy_id;
  if new.article_version_id <> envelope.article_version_id or new.provider_run_id <> envelope.provider_run_id
    or new.input_hash <> version.acquired_content_hash or new.normalized_input_hash <> version.normalized_input_hash
    or new.normalization_version <> version.normalization_version
    or new.field_hash <> (case when new.field = 'body' then version.normalized_input_hash else version.title_input_hash end) then
    raise exception using errcode = '23514', message = 'evidence locator requires exact envelope field provenance';
  end if;
  field_length := case when new.field = 'body' then version.input_codepoint_length else version.title_codepoint_length end;
  if new.span_end > field_length then
    raise exception using errcode = '23514', message = 'evidence codepoint offsets must fit exact observed field';
  end if;
  field_text := case when new.field = 'body' then version.persisted_body else version.original_title end;
  if field_text is not null and encode(digest(convert_to(substring(field_text from new.span_start + 1 for new.span_end - new.span_start), 'UTF8'), 'sha256'), 'hex') <> new.span_hash then
    raise exception using errcode = '23514', message = 'evidence span hash must match exact retained field';
  end if;
  if new.retained_quote is not null then
    if not policy.minimal_evidence_fragment or policy.evidence_quote_max_codepoints = 0
      or char_length(new.retained_quote) <> new.span_end - new.span_start
      or encode(digest(convert_to(new.retained_quote, 'UTF8'), 'sha256'), 'hex') <> new.span_hash then
      raise exception using errcode = '23514', message = 'evidence quote requires independent explicit rights and exact span hash';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(version.id::text || ':quote-budget', 18));
    select coalesce(sum(char_length(retained_quote)), 0)::integer into quote_total
      from evidence_fingerprints where article_version_id = version.id;
    if quote_total + char_length(new.retained_quote) > policy.evidence_quote_max_codepoints
      or (new.field = 'body' and char_length(new.retained_quote) >= version.input_codepoint_length)
      or (policy.content_access_mode = 'FULLTEXT_EPHEMERAL'
        and quote_total + char_length(new.retained_quote) >= version.input_codepoint_length) then
      raise exception using errcode = '23514', message = 'minimal evidence budget cannot become complete body retention';
    end if;
    -- A stale repeatable-read snapshot cannot silently reserve the same quota prefix.
    -- The unique constraint rejects it even if its SUM did not see a concurrent commit.
    new.quote_budget_start := quote_total + 1;
  else
    new.quote_budget_start := null;
  end if;
  return new;
end;
$$;
create trigger evidence_fingerprints_validate before insert on evidence_fingerprints
  for each row execute function dialektik_validate_evidence_fingerprint();

create function dialektik_validate_refetch_verification() returns trigger language plpgsql as $$
declare version observed_article_content_versions;
begin
  select * into strict version from observed_article_content_versions where id = new.article_version_id;
  if new.expected_input_hash <> version.normalized_input_hash or new.expected_title_hash <> version.title_input_hash
    or new.normalization_version <> version.normalization_version or new.verified_at < version.acquired_at
    or not exists (select 1 from semantic_envelopes where article_version_id = version.id)
    or (new.source_version_status = 'HASH_MATCH' and (new.refetched_input_hash is distinct from new.expected_input_hash
      or new.refetched_title_hash is distinct from new.expected_title_hash))
    or (new.source_version_status = 'SOURCE_VERSION_CHANGED' and (new.refetched_input_hash is null or new.refetched_title_hash is null
      or (new.refetched_input_hash = new.expected_input_hash and new.refetched_title_hash = new.expected_title_hash)))
    or (new.source_version_status = 'SOURCE_UNAVAILABLE' and (new.refetched_input_hash is not null or new.refetched_title_hash is not null)) then
    raise exception using errcode = '23514', message = 'refetch verification requires exact historical hash and coherent result';
  end if;
  if new.reproducibility_class is distinct from (case
    when version.persisted_body is not null then 'FULL_REPLAYABLE'
    when new.source_version_status = 'HASH_MATCH' then 'HASH_VERIFIABLE_REFETCH_REQUIRED'
    else 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE' end) then
    raise exception using errcode = '23514', message = 'refetch replay class must reflect retained or unavailable historical input';
  end if;
  return new;
end;
$$;
create trigger semantic_refetch_validate before insert on semantic_refetch_verifications
  for each row execute function dialektik_validate_refetch_verification();

create function dialektik_guard_legacy_fulltext_retention() returns trigger language plpgsql as $$
begin
  if exists (select 1 from observed_article_content_versions v join content_access_policies p on p.id = v.policy_id
    where v.article_id = new.article_id and p.content_access_mode = 'FULLTEXT_EPHEMERAL')
    and not exists (select 1 from observed_article_content_versions v join content_access_policies p on p.id = v.policy_id
      where v.article_id = new.article_id and p.content_access_mode = 'FULLTEXT_PERSISTED' and p.fulltext_persistence
        and v.persisted_body = new.body
        and v.version_number = (select max(version_number) from observed_article_content_versions where article_id = new.article_id)) then
    raise exception using errcode = '23514', message = 'ephemeral Article cannot retain a legacy full-text representation';
  end if;
  return new;
end;
$$;
create trigger article_representations_ephemeral_guard before insert or update on article_representations
  for each row execute function dialektik_guard_legacy_fulltext_retention();

create function dialektik_guard_article_ephemeral_text() returns trigger language plpgsql as $$
begin
  if (new.source_id is distinct from old.source_id or new.url_canonical is distinct from old.url_canonical)
    and exists (select 1 from observed_article_content_versions where article_id = old.id) then
    raise exception using errcode = '23514', message = 'observed content Article identity is permanent';
  end if;
  if exists (select 1 from observed_article_content_versions v join content_access_policies p on p.id = v.policy_id
    where v.article_id = new.id and p.content_access_mode = 'FULLTEXT_EPHEMERAL'
      and (encode(digest(convert_to(new.text_original, 'UTF8'), 'sha256'), 'hex') = v.normalized_input_hash
        or encode(digest(convert_to(new.text_normalized, 'UTF8'), 'sha256'), 'hex') = v.normalized_input_hash)) then
    raise exception using errcode = '23514', message = 'ephemeral input cannot enter Article text storage';
  end if;
  return new;
end;
$$;
create trigger articles_ephemeral_text_guard before update on articles
  for each row execute function dialektik_guard_article_ephemeral_text();
`;

export const ephemeralSemanticPipelineMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
};
