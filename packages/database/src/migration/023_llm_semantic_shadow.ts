import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
alter table semantic_article_proposals drop constraint semantic_article_proposals_reason_code_check;
alter table semantic_article_proposals add constraint semantic_article_proposals_reason_code_check check(reason_code in (
    'no_bounded_occurrence_observation', 'multi_observation_article_requires_decomposition',
    'multiple_identity_matches', 'occurrence_thread_incompatibility', 'no_automatic_occurrence_reparent',
    'unique_occurrence_match', 'thread_match_all_children_distinct', 'occurrence_identity_unknown',
    'thread_identity_unknown', 'unresolved_prior_thread_comparison', 'unresolved_prior_occurrence_comparison',
    'grounded_process_distinct_from_all_prior','llm_grounded_same_occurrence','llm_grounded_same_thread','llm_bounded_singleton','llm_abstention'));
-- New product lane only. No changes to candidate, canonical semantics or historical rows.
create function dialektik_llm_closed_object(value jsonb, keys text[], types text[]) returns boolean language plpgsql immutable as $$
declare i integer;
begin
  if value is null or jsonb_typeof(value) is distinct from 'object' or cardinality(keys)<>cardinality(types) or (select count(*) from jsonb_object_keys(value))<>cardinality(keys) then return false; end if;
  for i in 1..cardinality(keys) loop
    if not coalesce(jsonb_typeof(value->keys[i])=any(string_to_array(types[i],'|')),false) then return false; end if;
  end loop;
  return true;
end;
$$;
create table llm_processing_route_grants (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid references articles(id),
  policy_id text not null,
  provider_type text not null check(provider_type in ('llm_gemini','authored_stub')),
  processing_route text not null check(processing_route in ('EXTERNAL_LLM_PROCESSING_ALLOWED','LOCAL_ONLY_PROCESSING','NOT_ALLOWED')),
  fulltext_acquisition boolean not null,
  machine_processing boolean not null,
  derived_persistence boolean not null,
  fulltext_persistence boolean not null,
  evidence_fragments boolean not null,
  rights_receipt_sha256 text not null check(rights_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz(3) not null,
  foreign key(source_id,policy_id) references content_access_policies(source_id,id)
);
create index llm_route_grants_current on llm_processing_route_grants(source_id,article_id,provider_type,recorded_at desc,id desc);
create function dialektik_validate_llm_route_grant() returns trigger language plpgsql as $$
begin
  if new.recorded_at > clock_timestamp() or (new.article_id is not null and not exists(select 1 from articles where id=new.article_id and source_id=new.source_id)) then
    raise exception using errcode='23514',message='LLM grant requires exact Source Article and nonfuture receipt';
  end if;
  return new;
end;
$$;
create trigger llm_route_grants_validate before insert on llm_processing_route_grants for each row execute function dialektik_validate_llm_route_grant();
-- Permission appends contend on the same Source row-version fence as content policy appends.
create trigger llm_route_grants_fence after insert on llm_processing_route_grants for each row execute function dialektik_fence_content_policy_append();

create function dialektik_llm_route_allowed(source_identity dialektik_ulid,article_identity dialektik_ulid,policy_identity text,provider text,external_route boolean) returns boolean language plpgsql as $$
declare source_grant llm_processing_route_grants; article_grant llm_processing_route_grants; current_policy content_access_policies;
begin
  select * into current_policy from content_access_policies where source_id=source_identity and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  if current_policy.id is distinct from policy_identity or not current_policy.fulltext_acquisition or not current_policy.fulltext_machine_processing
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

create table llm_shadow_run_configurations (
  provider_run_id dialektik_ulid primary key references semantic_provider_runs(id),
  config_hash text not null check(config_hash ~ '^[0-9a-f]{64}$'),
  configuration jsonb not null,
  input_manifest jsonb not null,
  purpose text not null check(purpose='PRODUCT_DEVELOPMENT'),
  mode text not null check(mode='LLM_SEMANTIC_SHADOW'),
  recorded_at timestamptz(3) not null
);
create function dialektik_validate_llm_run_config() returns trigger language plpgsql as $$
declare run semantic_provider_runs; cfg jsonb; entry jsonb;
begin
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  cfg:=new.configuration;
  if not dialektik_llm_closed_object(cfg,array['model','providerVersion','configHash','promptVersion','schemaVersion','retrievalVersion','graphVersion','maxArticles','maxCalls','topK','timeoutMs','maxRetries','concurrency','maxOutputTokens'],array['string','string','string','string','string','string','string','number','number','number','number','number','number','number']) or jsonb_typeof(cfg) is distinct from 'object' or (select count(*) from jsonb_object_keys(cfg))<>14
    or not (cfg ?& array['model','providerVersion','configHash','promptVersion','schemaVersion','retrievalVersion','graphVersion','maxArticles','maxCalls','topK','timeoutMs','maxRetries','concurrency','maxOutputTokens'])
    or cfg->>'configHash'<>new.config_hash or cfg->>'providerVersion'<>run.provider_version
    or run.provider_version<>'product-llm-v1.'||substr(new.config_hash,1,24)
    or run.candidate_commit is not null or run.runtime_python is not null
    or run.provider_type not in ('llm_gemini','authored_stub')
    or run.run_identity not like 'LLM_SEMANTIC_SHADOW_%'
    or (run.provider_type='authored_stub' and cfg->>'model' not like 'recorded-%')
    or (run.provider_type='llm_gemini' and (cfg->>'model' not like 'gemini-%' or run.input_provenance<>'LIVE_REAL'))
    or (cfg->>'maxArticles')::integer not between 1 and 30 or (cfg->>'maxCalls')::integer not between 1 and 120
    or (cfg->>'topK')::integer not between 1 and 5 or (cfg->>'timeoutMs')::integer not between 1 and 120000
    or cfg->>'maxRetries'<>'0' or cfg->>'concurrency'<>'1' or cfg->>'maxOutputTokens'<>'4096'
    or cfg->>'promptVersion'<>'product-llm-prompts-v1' or cfg->>'schemaVersion'<>'product-llm-schema-v1'
    or cfg->>'retrievalVersion'<>'fact-index-topk-v1' or cfg->>'graphVersion'<>'proposal-builder-v1'
    or length(cfg->>'model')>128 or cfg->>'model'!~'^[A-Za-z0-9_.:/-]+$'
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
      or not exists(select 1 from articles a where a.id::text=entry->>'articleId' and a.source_id::text=entry->>'sourceId' and a.event_id is null
        and exists(select 1 from live_exposure_exclusions e where e.canonical_url=a.url_canonical and e.content_hash=entry->>'inputHash'))
      or (run.provider_type='llm_gemini' and not exists(select 1 from articles a join sources s on s.id=a.source_id
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
create trigger llm_shadow_config_validate before insert on llm_shadow_run_configurations for each row execute function dialektik_validate_llm_run_config();

create table llm_shadow_observations (
  envelope_id dialektik_ulid primary key references semantic_envelopes(id),
  cache_key text not null check(cache_key ~ '^[0-9a-f]{64}$'),
  config_hash text not null check(config_hash ~ '^[0-9a-f]{64}$'),
  structured_output jsonb not null,
  recorded_at timestamptz(3) not null
);
create index llm_shadow_observations_cache on llm_shadow_observations(cache_key,config_hash);
create function dialektik_validate_llm_observation() returns trigger language plpgsql as $$
declare envelope semantic_envelopes; version observed_article_content_versions; run semantic_provider_runs; config llm_shadow_run_configurations;
  entry jsonb; fact jsonb; locator jsonb; relation jsonb; target llm_shadow_observations; output jsonb; extraction jsonb;
begin
  select * into strict envelope from semantic_envelopes where id=new.envelope_id;
  select * into strict version from observed_article_content_versions where id=envelope.article_version_id;
  select * into strict run from semantic_provider_runs where id=envelope.provider_run_id;
  select * into strict config from llm_shadow_run_configurations where provider_run_id=run.id;
  perform 1 from prospective_content_rights_write_guards where source_id=version.source_id for update;
  output:=new.structured_output; extraction:=output->'extraction';
  if not dialektik_llm_closed_object(output,array['mode','config','route','extraction','relations','outputHash','cacheKey','usage','evidenceVerification'],array['string','object','string','object','array','string','string','object','string']) or new.config_hash<>config.config_hash or jsonb_typeof(output) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(output))<>9 or not(output ?& array['mode','config','route','extraction','relations','outputHash','cacheKey','usage','evidenceVerification'])
    or output->>'mode'<>'LLM_SEMANTIC_SHADOW' or output->>'evidenceVerification'<>'VERIFIED'
    or output->'config'<>config.configuration or output->>'cacheKey'<>new.cache_key or new.cache_key<>encode(digest(convert_to('["'||config.config_hash||'","'||version.normalized_input_hash||'","'||version.title_input_hash||'"]','UTF8'),'sha256'),'hex') or output->>'outputHash'!~'^[0-9a-f]{64}$'
    or output->>'route' not in ('LOCAL_ONLY_PROCESSING','EXTERNAL_LLM_PROCESSING_ALLOWED')
    or (run.provider_type='llm_gemini' and output->>'route'<>'EXTERNAL_LLM_PROCESSING_ALLOWED')
    or not dialektik_llm_route_allowed(version.source_id,version.article_id,version.policy_id,run.provider_type,run.provider_type='llm_gemini')
    or not exists(select 1 from jsonb_array_elements(config.input_manifest) m where m->>'articleId'=version.article_id::text
      and m->>'versionId'=version.id::text and m->>'sourceId'=version.source_id::text and m->>'policyId'=version.policy_id
      and m->>'inputHash'=version.normalized_input_hash and m->>'titleHash'=version.title_input_hash)
    or new.recorded_at<envelope.processed_at then
    raise exception using errcode='23514',message='LLM observation requires exact manifest and current Source AND Article processing routes';
  end if;
  if not dialektik_llm_closed_object(extraction,array['status','boundedOccurrence','boundedThread','facts'],array['string','boolean','boolean','array']) or jsonb_typeof(extraction) is distinct from 'object' or (select count(*) from jsonb_object_keys(extraction))<>4
    or not(extraction ?& array['status','boundedOccurrence','boundedThread','facts'])
    or extraction->>'status' not in ('OBSERVATION_AVAILABLE','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE','AMBIGUOUS')
    or jsonb_typeof(extraction->'boundedOccurrence')<>'boolean' or jsonb_typeof(extraction->'boundedThread')<>'boolean'
    or jsonb_typeof(extraction->'facts')<>'array' or jsonb_array_length(extraction->'facts')>12 then
    raise exception using errcode='23514',message='LLM extraction must be closed structured hash-only facts';
  end if;
  for fact in select value from jsonb_array_elements(extraction->'facts') loop
    locator:=fact->'evidence';
    if not dialektik_llm_closed_object(fact,array['id','role','valueHash','retrievalHash','evidence','isoDate'],array['string','string','string','string','object','string|null']) or not dialektik_llm_closed_object(locator,array['field','start','end','sourceSha256','spanSha256'],array['string','number','number','string','string']) or jsonb_typeof(fact) is distinct from 'object' or (select count(*) from jsonb_object_keys(fact))<>6
      or not(fact ?& array['id','role','valueHash','retrievalHash','evidence','isoDate'])
      or fact->>'id'!~'^f[0-9]{1,2}$' or fact->>'role' not in ('action','participant','date','end_date','location','external_id','process','topic')
      or fact->>'valueHash'!~'^[0-9a-f]{64}$' or fact->>'retrievalHash'!~'^[0-9a-f]{64}$'
      or jsonb_typeof(locator) is distinct from 'object' or (select count(*) from jsonb_object_keys(locator))<>5
      or not(locator ?& array['field','start','end','sourceSha256','spanSha256'])
      or fact->>'valueHash'<>locator->>'spanSha256'
      or not exists(select 1 from evidence_fingerprints e where e.envelope_id=new.envelope_id and e.field=locator->>'field'
        and e.field_hash=locator->>'sourceSha256' and e.span_hash=locator->>'spanSha256' and e.span_start=(locator->>'start')::integer and e.span_end=(locator->>'end')::integer)
      or fact->'isoDate'<>'null'::jsonb then
      raise exception using errcode='23514',message='LLM fact requires immutable verified fingerprint without text';
    end if;
  end loop;
  if extraction->>'status'='OBSERVATION_AVAILABLE' and (extraction->>'boundedOccurrence'<>'true'
    or not exists(select 1 from jsonb_array_elements(extraction->'facts') f where f->>'role'='action')
    or not exists(select 1 from jsonb_array_elements(extraction->'facts') f where f->>'role' in ('date','external_id')))
    or (extraction->>'boundedThread'='true' and (extraction->>'boundedOccurrence'<>'true'
      or not exists(select 1 from jsonb_array_elements(extraction->'facts') f where f->>'role'='process')
      or not exists(select 1 from jsonb_array_elements(extraction->'facts') f where f->>'role'='external_id'))) then
    raise exception using errcode='23514',message='LLM observation requires independently bounded roles';
  end if;
  if (select count(distinct f->>'id') from jsonb_array_elements(extraction->'facts') f)<>jsonb_array_length(extraction->'facts')
    or (extraction->>'status'<>'OBSERVATION_AVAILABLE' and (jsonb_array_length(extraction->'facts')<>0 or extraction->>'boundedOccurrence'<>'false' or extraction->>'boundedThread'<>'false')) then
    raise exception using errcode='23514',message='LLM abstention cannot smuggle an observation';
  end if;
  if not dialektik_llm_closed_object(output->'usage',array['inputTokens','outputTokens','totalTokens','cost'],array['number|null','number|null','number|null','null']) or jsonb_typeof(output->'usage') is distinct from 'object' or (select count(*) from jsonb_object_keys(output->'usage'))<>4
    or not((output->'usage') ?& array['inputTokens','outputTokens','totalTokens','cost']) or output->'usage'->'cost'<>'null'::jsonb then
    raise exception using errcode='23514',message='LLM usage cannot retain text or invented cost';
  end if;
  for entry in select value from jsonb_each(output->'usage') where key<>'cost' loop
    if entry<>'null'::jsonb and (jsonb_typeof(entry)<>'number' or entry::text!~'^[0-9]{1,10}$' or entry::text::numeric>1000000000) then
      raise exception using errcode='23514',message='LLM token usage is bounded nonnegative or unavailable';
    end if;
  end loop;
  if jsonb_typeof(output->'relations')<>'array' or jsonb_array_length(output->'relations')>(config.configuration->>'topK')::integer then
    raise exception using errcode='23514',message='LLM relation set exceeds frozen top K';
  end if;
  for relation in select value from jsonb_array_elements(output->'relations') loop
    if not dialektik_llm_closed_object(relation,array['decision','occurrence','thread','leftFacts','rightFacts','targetArticleId','targetVersionId'],array['string','string','string','array','array','string','string']) or jsonb_typeof(relation) is distinct from 'object' or (select count(*) from jsonb_object_keys(relation))<>7
      or not(relation ?& array['decision','occurrence','thread','leftFacts','rightFacts','targetArticleId','targetVersionId'])
      or relation->>'decision' not in ('SAME_OCCURRENCE','DIFFERENT_OCCURRENCE_SAME_THREAD','DIFFERENT_THREAD','UNKNOWN','NOT_APPLICABLE')
      or relation->>'occurrence' not in ('SAME','DISTINCT','UNKNOWN','NOT_APPLICABLE') or relation->>'thread' not in ('SAME','DISTINCT','UNKNOWN','NOT_APPLICABLE')
      or jsonb_typeof(relation->'leftFacts')<>'array' or jsonb_typeof(relation->'rightFacts')<>'array'
      or jsonb_array_length(relation->'leftFacts')>12 or jsonb_array_length(relation->'rightFacts')>12 then
      raise exception using errcode='23514',message='LLM relation is a closed independently grounded decision';
    end if;
    if (relation->>'decision'='SAME_OCCURRENCE' and (relation->>'occurrence'<>'SAME' or relation->>'thread' not in ('SAME','UNKNOWN')))
      or (relation->>'decision'='DIFFERENT_OCCURRENCE_SAME_THREAD' and (relation->>'occurrence'<>'DISTINCT' or relation->>'thread'<>'SAME'))
      or (relation->>'decision'='DIFFERENT_THREAD' and (relation->>'occurrence'<>'DISTINCT' or relation->>'thread'<>'DISTINCT'))
      or (relation->>'decision'='UNKNOWN' and (relation->>'occurrence' not in ('UNKNOWN','DISTINCT') or relation->>'thread'<>'UNKNOWN'))
      or (relation->>'decision'='NOT_APPLICABLE' and (relation->>'occurrence'<>'NOT_APPLICABLE' or relation->>'thread'<>'NOT_APPLICABLE')) then
      raise exception using errcode='23514',message='LLM relation axes disagree';
    end if;
    select o.* into target from llm_shadow_observations o join semantic_envelopes e on e.id=o.envelope_id
      join observed_article_content_versions v on v.id=e.article_version_id
      where e.provider_run_id=run.id and v.id::text=relation->>'targetVersionId' and v.article_id::text=relation->>'targetArticleId';
    if target.envelope_id is null or target.config_hash<>new.config_hash or target.recorded_at>new.recorded_at or relation->>'targetArticleId'=version.article_id::text
      or not exists(select 1 from observed_article_content_versions v where v.id::text=relation->>'targetVersionId'
        and dialektik_llm_route_allowed(v.source_id,v.article_id,v.policy_id,run.provider_type,run.provider_type='llm_gemini'))
      or exists(select 1 from jsonb_array_elements_text(relation->'leftFacts') k where not exists(select 1 from jsonb_array_elements(extraction->'facts') f where f->>'id'=k))
      or exists(select 1 from jsonb_array_elements_text(relation->'rightFacts') k where not exists(select 1 from jsonb_array_elements(target.structured_output->'extraction'->'facts') f where f->>'id'=k))
      or (relation->>'decision' not in ('UNKNOWN','NOT_APPLICABLE') and (jsonb_array_length(relation->'leftFacts')=0 or jsonb_array_length(relation->'rightFacts')=0)) then
      raise exception using errcode='23514',message='LLM relation must reference verified facts on both exact inputs';
    end if;
  end loop;
  return new;
end;
$$;
create trigger llm_shadow_observation_validate before insert on llm_shadow_observations for each row execute function dialektik_validate_llm_observation();

create function dialektik_llm_processed_requires_grounding() returns trigger language plpgsql as $$
declare run semantic_provider_runs;
begin
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  if new.processing_state='PROCESSED_SHADOW' and (run.provider_type='llm_gemini' or run.provider_version like 'product-llm-v1.%')
    and not exists(select 1 from semantic_envelopes e join llm_shadow_observations o on o.envelope_id=e.id
      where e.provider_run_id=run.id and e.article_version_id=new.article_version_id) then
    raise exception using errcode='23514',message='LLM processed state requires grounded typed envelope extension';
  end if;
  return new;
end;
$$;
create trigger llm_processed_grounding before insert on semantic_processing_records for each row execute function dialektik_llm_processed_requires_grounding();
create function dialektik_llm_run_requires_config() returns trigger language plpgsql as $$
begin
  if (new.provider_type='llm_gemini' or new.provider_version like 'product-llm-v1.%') and not exists(select 1 from llm_shadow_run_configurations where provider_run_id=new.id) then
    raise exception using errcode='23514',message='LLM provider run requires independently frozen product configuration';
  end if;
  return new;
end;
$$;
create constraint trigger llm_run_config_required after insert on semantic_provider_runs deferrable initially deferred for each row execute function dialektik_llm_run_requires_config();

create table llm_shadow_call_claims (
  call_key text primary key check(call_key ~ '^[0-9a-f]{64}$'),
  provider_run_id dialektik_ulid not null references llm_shadow_run_configurations(provider_run_id),
  article_id dialektik_ulid not null references articles(id),
  stage text not null check(stage in ('extraction','relation')),
  claimed_at timestamptz(3) not null
);
create unique index llm_one_extraction_claim on llm_shadow_call_claims(provider_run_id,article_id) where stage='extraction';
create table llm_shadow_call_outcomes (
  call_key text primary key references llm_shadow_call_claims(call_key),
  outcome text not null check(outcome in ('RESPONSE_RECEIVED','FAILED')),
  recorded_at timestamptz(3) not null
);
create function dialektik_validate_llm_call() returns trigger language plpgsql as $$
declare config llm_shadow_run_configurations; run semantic_provider_runs; entry jsonb;
begin
  select * into strict config from llm_shadow_run_configurations where provider_run_id=new.provider_run_id for update;
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  select m into entry from jsonb_array_elements(config.input_manifest) m where m->>'articleId'=new.article_id::text;
  if entry is not null then perform 1 from prospective_content_rights_write_guards where source_id=(entry->>'sourceId')::dialektik_ulid for update; end if;
  if entry is null or (select count(*) from llm_shadow_call_claims where provider_run_id=new.provider_run_id)>=(config.configuration->>'maxCalls')::integer
    or exists(select 1 from llm_shadow_call_claims c left join llm_shadow_call_outcomes o on o.call_key=c.call_key where c.provider_run_id=new.provider_run_id and o.call_key is null)
    or exists(select 1 from semantic_shadow_graph_snapshots where provider_run_id=new.provider_run_id)
    or not dialektik_llm_route_allowed((entry->>'sourceId')::dialektik_ulid,new.article_id,entry->>'policyId',run.provider_type,run.provider_type='llm_gemini') then
    raise exception using errcode='23514',message='LLM call requires frozen bounds and current Source AND Article route';
  end if;
  return new;
end;
$$;
create trigger llm_shadow_calls_validate before insert on llm_shadow_call_claims for each row execute function dialektik_validate_llm_call();
create function dialektik_validate_llm_call_outcome() returns trigger language plpgsql as $$
begin
  if new.recorded_at < (select claimed_at from llm_shadow_call_claims where call_key=new.call_key) then
    raise exception using errcode='23514',message='LLM response receipt cannot precede claimed call';
  end if;
  return new;
end;
$$;
create trigger llm_call_outcome_validate before insert on llm_shadow_call_outcomes for each row execute function dialektik_validate_llm_call_outcome();
do $$
declare relation text;
begin
  foreach relation in array array['llm_processing_route_grants','llm_shadow_run_configurations','llm_shadow_observations','llm_shadow_call_claims','llm_shadow_call_outcomes'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function dialektik_semantic_content_append_only()',relation||'_append_only',relation);
    execute format('create trigger %I before truncate on %I for each statement execute function dialektik_semantic_content_append_only()',relation||'_no_truncate',relation);
  end loop;
end;
$$;
`;
export const llmSemanticShadowMigration: Migration = {
  async up(database) {
    await sql.raw(SCHEMA).execute(database);
  },
  down() {
    throw new Error('Committed LLM shadow migration is forward-only.');
  },
};
