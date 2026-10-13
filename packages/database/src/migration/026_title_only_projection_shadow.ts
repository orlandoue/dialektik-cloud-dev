import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
-- Hash-only title-projection registration is independent of semantic-result retention.
-- The exception is bound to the Article already fixed by migration 025 and requires
-- a prior, matching local hash-only projection receipt. All other registrations
-- retain the migration-018 derived-persistence gate.
create or replace function dialektik_validate_observed_content_version() returns trigger language plpgsql as $$
declare policy content_access_policies; article articles; prior observed_article_content_versions;
  projection_match boolean;
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
  select exists (select 1 from article_hash_only_projection_versions p
    where p.source_id = new.source_id and p.article_id = new.article_id and p.policy_id = new.policy_id
      and p.acquired_content_sha256 = new.acquired_content_hash
      and p.normalized_body_sha256 = new.normalized_input_hash
      and p.title_sha256 = new.title_input_hash
      and p.normalization_version = new.normalization_version
      and p.recorded_at <= new.recorded_at) into projection_match;
  if policy.content_access_mode = 'METADATA_ONLY' or not policy.metadata_storage
    or not policy.fulltext_acquisition or not policy.fulltext_machine_processing then
    raise exception using errcode = '23514', message = 'full content observation requires acquisition and machine-processing rights';
  end if;
  if not policy.derived_semantic_persistence and not (
    projection_match and article.id = '01M4CRBAXJPQEMJVXPKH1EY1N6'::dialektik_ulid
      and article.source_id = '01M4CQTXP483R30JDW6EJQ6ADQ'::dialektik_ulid
      and article.origin = 'LIVE_REAL' and article.event_id is null
      and new.original_title is null and new.persisted_body is null
      and policy.content_access_mode = 'FULLTEXT_EPHEMERAL'
      and not policy.fulltext_persistence
      and exists (select 1 from live_exposure_exclusions e
        join live_exposure_exclusions identity_exclusion on identity_exclusion.id = article.live_exposure_id
        where e.canonical_url = new.canonical_url and e.content_hash = new.normalized_input_hash
          and e.registry_key = identity_exclusion.registry_key
          and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
  ) then
    raise exception using errcode = '23514', message = 'observed content requires derived persistence or exact hash-only title projection registration';
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

-- Provider-specific exact grants remain independent of the source-level legacy
-- derived_semantic_persistence flag. The exact append-only scope decision is the
-- only persistence permission used by this title-only route.
create or replace function dialektik_validate_cloudflare_projection_route_grant() returns trigger language plpgsql as $$
declare version_row observed_article_content_versions; article_row articles; source_row sources;
  projection_row article_hash_only_projection_versions; current_policy content_access_policies;
begin
  select * into strict version_row from observed_article_content_versions where id=new.article_version_id;
  select * into strict article_row from articles where id=new.article_id;
  select * into strict source_row from sources where id=new.source_id;
  select * into strict projection_row from article_hash_only_projection_versions where id=new.projection_version_id;
  select * into current_policy from content_access_policies where source_id=new.source_id
    and recorded_at<=new.recorded_at order by recorded_at desc,id desc limit 1;
  if new.recorded_at > clock_timestamp()
    or new.recorded_at < projection_row.recorded_at
    or version_row.article_id is distinct from new.article_id
    or version_row.source_id is distinct from new.source_id
    or version_row.policy_id is distinct from new.policy_id
    or version_row.acquired_content_hash is distinct from new.acquired_content_sha256
    or version_row.normalized_input_hash is distinct from projection_row.normalized_body_sha256
    or version_row.title_input_hash is distinct from projection_row.title_sha256
    or version_row.persisted_body is not null
    or projection_row.source_id is distinct from new.source_id
    or projection_row.article_id is distinct from new.article_id
    or projection_row.policy_id is distinct from new.policy_id
    or projection_row.acquired_content_sha256 is distinct from new.acquired_content_sha256
    or projection_row.projection_policy_version is distinct from new.projection_policy_version
    or projection_row.projection_sha256 is distinct from new.projection_sha256
    or projection_row.attribution_sha256 is distinct from new.attribution_sha256
    or article_row.source_id is distinct from new.source_id
    or article_row.origin is distinct from 'LIVE_REAL'
    or article_row.event_id is not null
    or source_row.origin is distinct from 'LIVE_REAL'
    or current_policy.id is distinct from new.policy_id
    or not current_policy.metadata_storage
    or not current_policy.fulltext_acquisition
    or not current_policy.fulltext_machine_processing
    or current_policy.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or current_policy.fulltext_persistence
    or not exists(select 1 from live_exposure_exclusions e
      join live_exposure_exclusions identity_exclusion on identity_exclusion.id=article_row.live_exposure_id
      where e.canonical_url=article_row.url_canonical
        and e.registry_key=identity_exclusion.registry_key
        and e.content_hash=version_row.normalized_input_hash
        and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
    raise exception using errcode='23514',message='Cloudflare projection grant must bind an excluded body-null live Article version';
  end if;
  return new;
end;
$$;

create or replace function dialektik_cloudflare_projection_decision_allowed(
  scope_identity text,
  source_identity dialektik_ulid,
  article_identity dialektik_ulid,
  version_identity dialektik_ulid,
  projection_version_identity dialektik_ulid,
  policy_identity text,
  acquired_content_identity text,
  projection_policy_identity text,
  projection_identity text,
  provider_identity text,
  model_identity text
) returns boolean language plpgsql stable as $$
declare version_row observed_article_content_versions; article_row articles; source_row sources;
  current_policy content_access_policies; decision llm_cloudflare_projection_route_grants;
begin
  if scope_identity not in ('EXTERNAL_INFERENCE','DERIVED_SHADOW_PERSISTENCE')
    or source_identity is distinct from '01M4CQTXP483R30JDW6EJQ6ADQ'::dialektik_ulid
    or article_identity is distinct from '01M4CRBAXJPQEMJVXPKH1EY1N6'::dialektik_ulid
    or provider_identity is distinct from 'llm_cloudflare_workers_ai'
    or model_identity is distinct from '@cf/openai/gpt-oss-20b'
    or acquired_content_identity !~ '^[0-9a-f]{64}$'
    or projection_identity !~ '^[0-9a-f]{64}$'
    or projection_policy_identity !~ '^[A-Za-z0-9_.:-]{1,128}$' then return false; end if;
  select * into version_row from observed_article_content_versions where id=version_identity;
  select * into article_row from articles where id=article_identity;
  select * into source_row from sources where id=source_identity;
  perform 1 from article_hash_only_projection_versions p where p.id=projection_version_identity
    and p.source_id=source_identity and p.article_id=article_identity and p.policy_id=policy_identity
    and p.acquired_content_sha256=acquired_content_identity
    and p.projection_policy_version=projection_policy_identity and p.projection_sha256=projection_identity;
  if not found then return false; end if;
  select * into current_policy from content_access_policies where source_id=source_identity
    and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  if version_row.id is null or article_row.id is null or source_row.id is null
    or version_row.article_id is distinct from article_identity
    or version_row.source_id is distinct from source_identity
    or version_row.policy_id is distinct from policy_identity
    or version_row.acquired_content_hash is distinct from acquired_content_identity
    or version_row.normalized_input_hash is distinct from (select normalized_body_sha256 from article_hash_only_projection_versions where id=projection_version_identity)
    or version_row.title_input_hash is distinct from (select title_sha256 from article_hash_only_projection_versions where id=projection_version_identity)
    or version_row.persisted_body is not null
    or article_row.source_id is distinct from source_identity
    or article_row.origin is distinct from 'LIVE_REAL'
    or article_row.event_id is not null
    or source_row.origin is distinct from 'LIVE_REAL'
    or current_policy.id is distinct from policy_identity
    or not current_policy.metadata_storage or not current_policy.fulltext_acquisition
    or not current_policy.fulltext_machine_processing
    or current_policy.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or current_policy.fulltext_persistence
    or not exists(select 1 from live_exposure_exclusions e
      join live_exposure_exclusions identity_exclusion on identity_exclusion.id=article_row.live_exposure_id
      where e.canonical_url=article_row.url_canonical and e.registry_key=identity_exclusion.registry_key
        and e.content_hash=version_row.normalized_input_hash
        and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then return false; end if;
  select * into decision from llm_cloudflare_projection_route_grants
    where source_id=source_identity and article_id=article_identity and article_version_id=version_identity
      and projection_version_id=projection_version_identity and decision_scope=scope_identity
      and provider_type=provider_identity and model_id=model_identity order by decision_sequence desc limit 1;
  return decision.id is not null and decision.decision_status='APPROVED'
    and decision.policy_id=policy_identity and decision.acquired_content_sha256=acquired_content_identity
    and decision.projection_policy_version=projection_policy_identity
    and decision.projection_sha256=projection_identity
    and decision.attribution_sha256=(select attribution_sha256 from article_hash_only_projection_versions where id=projection_version_identity)
    and not decision.fulltext_persistence and not decision.source_fulltext_retained
    and not decision.projection_text_retained and not decision.prompt_retained
    and not decision.raw_response_retained and not decision.quoted_source_text_retained
    and decision.attribution_required;
end;
$$;

create table event_analyst_title_only_shadow_envelopes (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null references articles(id),
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  projection_version_id dialektik_ulid not null references article_hash_only_projection_versions(id),
  provider_run_id dialektik_ulid not null,
  provider_type text not null check (provider_type='llm_cloudflare_workers_ai'),
  model_id text not null check (model_id='@cf/openai/gpt-oss-20b'),
  projection_policy_version text not null,
  acquired_content_sha256 text not null check (acquired_content_sha256 ~ '^[0-9a-f]{64}$'),
  projection_sha256 text not null check (projection_sha256 ~ '^[0-9a-f]{64}$'),
  title_sha256 text not null check (title_sha256 ~ '^[0-9a-f]{64}$'),
  schema_sha256 text not null check (schema_sha256 ~ '^[0-9a-f]{64}$'),
  skill_sha256 text not null check (skill_sha256 ~ '^[0-9a-f]{64}$'),
  derivative_sha256 text not null check (derivative_sha256 ~ '^[0-9a-f]{64}$'),
  event_candidate text not null check (event_candidate in ('TRUE','FALSE','UNCERTAIN')),
  applicability text not null check (applicability in ('OBSERVATION_AVAILABLE','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE','AMBIGUOUS')),
  event_nugget_count integer not null check (event_nugget_count between 0 and 3),
  fact_count integer not null check (fact_count between 0 and 30),
  grounded_fact_count integer not null check (grounded_fact_count between 0 and fact_count),
  unsupported_fact_count integer not null check (unsupported_fact_count between 0 and fact_count),
  valid_evidence_reference_count integer not null check (valid_evidence_reference_count between 0 and 120),
  invalid_evidence_reference_count integer not null check (invalid_evidence_reference_count between 0 and 120),
  semantic_derivatives jsonb not null,
  evidence_locators jsonb not null,
  recorded_at timestamptz(3) not null,
  unique (article_version_id, provider_run_id)
);

create function dialektik_validate_title_only_shadow_envelope() returns trigger language plpgsql as $$
declare version_row observed_article_content_versions; projection_row article_hash_only_projection_versions;
  source_row sources; article_row articles; fact jsonb; locator jsonb; facts jsonb;
  evidence_refs jsonb; ref text; key_count integer;
begin
  if new.source_id is distinct from '01M4CQTXP483R30JDW6EJQ6ADQ'::dialektik_ulid
    or new.article_id is distinct from '01M4CRBAXJPQEMJVXPKH1EY1N6'::dialektik_ulid
    or new.provider_type is distinct from 'llm_cloudflare_workers_ai'
    or new.model_id is distinct from '@cf/openai/gpt-oss-20b' then
    raise exception using errcode='23514',message='title-only SHADOW envelope is outside its frozen Article/provider/model scope';
  end if;
  select * into strict version_row from observed_article_content_versions where id=new.article_version_id;
  select * into strict projection_row from article_hash_only_projection_versions where id=new.projection_version_id;
  select * into strict source_row from sources where id=new.source_id;
  select * into strict article_row from articles where id=new.article_id;
  if version_row.source_id is distinct from new.source_id or version_row.article_id is distinct from new.article_id
    or version_row.persisted_body is not null or version_row.original_title is not null
    or version_row.acquired_content_hash is distinct from new.acquired_content_sha256
    or version_row.title_input_hash is distinct from new.title_sha256
    or projection_row.source_id is distinct from new.source_id or projection_row.article_id is distinct from new.article_id
    or projection_row.projection_policy_version is distinct from new.projection_policy_version
    or projection_row.projection_sha256 is distinct from new.projection_sha256
    or projection_row.title_sha256 is distinct from new.title_sha256
    or projection_row.acquired_content_sha256 is distinct from new.acquired_content_sha256
    or article_row.origin is distinct from 'LIVE_REAL' or article_row.event_id is not null
    or source_row.origin is distinct from 'LIVE_REAL'
    or new.recorded_at < version_row.acquired_at
    or not dialektik_cloudflare_projection_route_allowed(new.source_id,new.article_id,new.article_version_id,
      new.projection_version_id,version_row.policy_id,new.acquired_content_sha256,new.projection_policy_version,
      new.projection_sha256,new.provider_type,new.model_id)
    or not dialektik_cloudflare_projection_persistence_allowed(new.source_id,new.article_id,new.article_version_id,
      new.projection_version_id,version_row.policy_id,new.acquired_content_sha256,new.projection_policy_version,
      new.projection_sha256,new.provider_type,new.model_id) then
    raise exception using errcode='23514',message='title-only SHADOW persistence requires exact body-null version and both active scoped grants';
  end if;
  if jsonb_typeof(new.semantic_derivatives) is distinct from 'object' then
    raise exception using errcode='23514',message='title-only derivative envelope has an invalid root type';
  end if;
  select count(*) into key_count from jsonb_object_keys(new.semantic_derivatives);
  if key_count <> 3
    or not (new.semantic_derivatives ?& array['eventCandidate','missingOrUncertainCount','facts']) then
    raise exception using errcode='23514',message='title-only derivative envelope has an invalid or non-closed root shape';
  end if;
  if jsonb_typeof(new.semantic_derivatives->'eventCandidate') is distinct from 'string'
    or new.semantic_derivatives->>'eventCandidate' is distinct from new.event_candidate
    or new.semantic_derivatives->>'eventCandidate' not in ('TRUE','FALSE','UNCERTAIN')
    or jsonb_typeof(new.semantic_derivatives->'missingOrUncertainCount') is distinct from 'number'
    or (new.semantic_derivatives->>'missingOrUncertainCount') !~ '^(0|[1-8])$'
    or jsonb_typeof(new.semantic_derivatives->'facts') is distinct from 'array' then
    raise exception using errcode='23514',message='title-only derivative summary does not match its bounded schema';
  end if;
  facts := new.semantic_derivatives->'facts';
  if jsonb_array_length(facts) <> new.grounded_fact_count
    or new.invalid_evidence_reference_count <> 0 then
    raise exception using errcode='23514',message='title-only persistence requires only grounded facts and valid references';
  end if;
  for fact in select value from jsonb_array_elements(facts) loop
    if jsonb_typeof(fact) is distinct from 'object' then
      raise exception using errcode='23514',message='title-only derivative fact has an invalid type';
    end if;
    select count(*) into key_count from jsonb_object_keys(fact);
    if key_count <> 5
      or not (fact ?& array['kind','valueSha256','evidenceBlockIds','support','normalizedTime'])
      or jsonb_typeof(fact->'kind') is distinct from 'string'
      or fact->>'kind' not in ('trigger_or_action','actor','time','location','external_identifier','process','topic','other')
      or jsonb_typeof(fact->'valueSha256') is distinct from 'string'
      or fact->>'valueSha256' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(fact->'support') is distinct from 'string'
      or fact->>'support' not in ('SUPPORTED_DIRECT','SUPPORTED_NORMALIZED')
      or jsonb_typeof(fact->'normalizedTime') not in ('null','string')
      or (jsonb_typeof(fact->'normalizedTime') = 'string'
        and (fact->>'normalizedTime') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception using errcode='23514',message='title-only derivative fact contains ungrounded or non-hash content';
    end if;
    evidence_refs := fact->'evidenceBlockIds';
    if jsonb_typeof(evidence_refs) is distinct from 'array' then
      raise exception using errcode='23514',message='title-only derivative evidence references must be an array';
    end if;
    if jsonb_array_length(evidence_refs) < 1 then
      raise exception using errcode='23514',message='title-only derivative fact requires title evidence';
    end if;
    for ref in select jsonb_array_elements_text(evidence_refs) loop
      if ref <> 'B001' then
        raise exception using errcode='23514',message='title-only derivative fact references a non-title block';
      end if;
    end loop;
  end loop;
  if jsonb_typeof(new.evidence_locators) is distinct from 'array' then
    raise exception using errcode='23514',message='title-only evidence locators must be an array';
  end if;
  if jsonb_array_length(new.evidence_locators) <> 1 then
    raise exception using errcode='23514',message='title-only evidence must contain exactly one title locator';
  end if;
  for locator in select value from jsonb_array_elements(new.evidence_locators) loop
    if jsonb_typeof(locator) is distinct from 'object' then
      raise exception using errcode='23514',message='title-only evidence locator has an invalid type';
    end if;
    select count(*) into key_count from jsonb_object_keys(locator);
    if key_count <> 6
      or not (locator ?& array['blockId','field','start','end','sourceSha256','spanSha256'])
      or jsonb_typeof(locator->'blockId') is distinct from 'string'
      or locator->>'blockId' <> 'B001' or locator->>'field' <> 'title'
      or jsonb_typeof(locator->'field') is distinct from 'string'
      or jsonb_typeof(locator->'start') is distinct from 'number'
      or locator->>'start' <> '0'
      or jsonb_typeof(locator->'end') is distinct from 'number'
      or (locator->>'end') !~ '^[0-9]{1,4}$'
      or jsonb_typeof(locator->'sourceSha256') is distinct from 'string'
      or locator->>'sourceSha256' is distinct from new.title_sha256
      or jsonb_typeof(locator->'spanSha256') is distinct from 'string'
      or locator->>'spanSha256' !~ '^[0-9a-f]{64}$' then
      raise exception using errcode='23514',message='title-only evidence locator does not match the exact title input';
    end if;
    if (locator->>'end')::integer <> version_row.title_codepoint_length then
      raise exception using errcode='23514',message='title-only evidence locator offset does not match the title length';
    end if;
  end loop;
  return new;
end;
$$;
create trigger title_only_shadow_envelopes_validate before insert on event_analyst_title_only_shadow_envelopes
  for each row execute function dialektik_validate_title_only_shadow_envelope();
create trigger title_only_shadow_envelopes_append_only before update or delete on event_analyst_title_only_shadow_envelopes
  for each row execute function dialektik_semantic_content_append_only();
create trigger title_only_shadow_envelopes_no_truncate before truncate on event_analyst_title_only_shadow_envelopes
  for each statement execute function dialektik_semantic_content_append_only();
`;

export const titleOnlyProjectionShadowMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down() {
    throw new Error('Title-only projection SHADOW migration is forward-only.');
  },
};
