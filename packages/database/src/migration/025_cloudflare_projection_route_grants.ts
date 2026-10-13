import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
-- Exact-Article append-only registry for local ephemeral projection hashes.
-- Only IDs, hashes, and version metadata are retained; no text payload exists.
create table article_hash_only_projection_versions (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null references articles(id),
  policy_id text not null,
  previous_version_id dialektik_ulid references article_hash_only_projection_versions(id),
  version_number integer not null check (version_number > 0),
  acquired_content_sha256 text not null check (acquired_content_sha256 ~ '^[0-9a-f]{64}$'),
  source_body_sha256 text not null check (source_body_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_body_sha256 text not null check (normalized_body_sha256 ~ '^[0-9a-f]{64}$'),
  title_sha256 text not null check (title_sha256 ~ '^[0-9a-f]{64}$'),
  normalization_version text not null check (normalization_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  projection_policy_version text not null check (projection_policy_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  projection_sha256 text not null check (projection_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_manifest_sha256 text not null check (evidence_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  acquisition_receipt_sha256 text not null check (acquisition_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  rights_receipt_sha256 text not null check (rights_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  local_authorization_receipt_sha256 text not null check (local_authorization_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  attribution_sha256 text not null check (attribution_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz(3) not null,
  unique (article_id, version_number),
  check ((version_number = 1) = (previous_version_id is null)),
  check (source_id = '01M4CQTXP483R30JDW6EJQ6ADQ'::dialektik_ulid),
  check (article_id = '01M4CRBAXJPQEMJVXPKH1EY1N6'::dialektik_ulid),
  foreign key (source_id, policy_id) references content_access_policies(source_id, id)
);
create unique index article_hash_only_projection_single_successor
  on article_hash_only_projection_versions(previous_version_id) where previous_version_id is not null;
create index article_hash_only_projection_by_article
  on article_hash_only_projection_versions(article_id, version_number desc);

create function dialektik_validate_article_hash_only_projection_version() returns trigger language plpgsql as $$
declare policy content_access_policies; article articles; source_row sources;
  prior article_hash_only_projection_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_id::text, 42));
  select * into strict policy from content_access_policies where id=new.policy_id and source_id=new.source_id;
  select * into strict article from articles where id=new.article_id;
  select * into strict source_row from sources where id=new.source_id;
  if new.recorded_at > clock_timestamp()
    or policy.id is distinct from (select id from content_access_policies
      where source_id=new.source_id and recorded_at<=new.recorded_at
      order by recorded_at desc,id desc limit 1)
    or not policy.metadata_storage
    or not policy.fulltext_acquisition
    or not policy.fulltext_machine_processing
    or policy.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or policy.fulltext_persistence
    or article.source_id is distinct from new.source_id
    or article.origin is distinct from 'LIVE_REAL'
    or article.event_id is not null
    or source_row.origin is distinct from 'LIVE_REAL'
    or not exists(select 1 from live_exposure_exclusions e
      join live_exposure_exclusions identity_exclusion on identity_exclusion.id=article.live_exposure_id
      where e.canonical_url=article.url_canonical
        and e.registry_key=identity_exclusion.registry_key
        and e.content_hash=new.normalized_body_sha256
        and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
    raise exception using errcode='23514',message='hash-only projection version requires exact local rights and prior Final V2 exclusion';
  end if;
  select * into prior from article_hash_only_projection_versions
    where article_id=new.article_id order by version_number desc limit 1;
  if prior.id is null then
    if new.version_number<>1 or new.previous_version_id is not null then
      raise exception using errcode='23514',message='first hash-only projection version must begin at one';
    end if;
  elsif new.previous_version_id is distinct from prior.id
    or new.version_number<>prior.version_number+1
    or new.recorded_at<prior.recorded_at
    or (new.acquired_content_sha256=prior.acquired_content_sha256
      and new.source_body_sha256=prior.source_body_sha256
      and new.normalized_body_sha256=prior.normalized_body_sha256
      and new.title_sha256=prior.title_sha256
      and new.normalization_version=prior.normalization_version
      and new.projection_policy_version=prior.projection_policy_version
      and new.projection_sha256=prior.projection_sha256
      and new.evidence_manifest_sha256=prior.evidence_manifest_sha256) then
    raise exception using errcode='23514',message='changed hash-only projection requires a consecutive append-only version';
  end if;
  return new;
end;
$$;
create trigger article_hash_only_projection_versions_validate
  before insert on article_hash_only_projection_versions
  for each row execute function dialektik_validate_article_hash_only_projection_version();
create trigger article_hash_only_projection_versions_append_only
  before update or delete on article_hash_only_projection_versions
  for each row execute function dialektik_semantic_content_append_only();
create trigger article_hash_only_projection_versions_no_truncate
  before truncate on article_hash_only_projection_versions
  for each statement execute function dialektik_semantic_content_append_only();

-- A separate, versioned, projection-only path. Existing shared LLM route
-- authorization remains unchanged and continues to deny Cloudflare by default.
create table llm_cloudflare_projection_route_grants (
  decision_sequence bigint generated always as identity unique not null,
  id dialektik_ulid primary key,
  decision_scope text not null check (decision_scope in ('EXTERNAL_INFERENCE','DERIVED_SHADOW_PERSISTENCE')),
  decision_status text not null check (decision_status in ('APPROVED','REVOKED')),
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null references articles(id),
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  projection_version_id dialektik_ulid not null references article_hash_only_projection_versions(id),
  policy_id text not null,
  acquired_content_sha256 text not null check (acquired_content_sha256 ~ '^[0-9a-f]{64}$'),
  projection_policy_version text not null check (projection_policy_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  projection_sha256 text not null check (projection_sha256 ~ '^[0-9a-f]{64}$'),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id = '@cf/openai/gpt-oss-20b'),
  fulltext_persistence boolean not null check (not fulltext_persistence),
  source_fulltext_retained boolean not null check (not source_fulltext_retained),
  projection_text_retained boolean not null check (not projection_text_retained),
  prompt_retained boolean not null check (not prompt_retained),
  raw_response_retained boolean not null check (not raw_response_retained),
  quoted_source_text_retained boolean not null check (not quoted_source_text_retained),
  attribution_required boolean not null check (attribution_required),
  attribution_sha256 text not null check (attribution_sha256 ~ '^[0-9a-f]{64}$'),
  rights_receipt_sha256 text not null check (rights_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  controller_decision_sha256 text not null check (controller_decision_sha256 ~ '^[0-9a-f]{64}$'),
  cloudflare_terms_receipt_sha256 text not null check (cloudflare_terms_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz(3) not null,
  foreign key (source_id, policy_id) references content_access_policies(source_id, id)
);
create index llm_cloudflare_projection_grants_scope on llm_cloudflare_projection_route_grants(
  source_id, article_id, article_version_id, projection_version_id, decision_scope,
  provider_type, model_id, decision_sequence desc
);

create function dialektik_validate_cloudflare_projection_route_grant() returns trigger language plpgsql as $$
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
    or (new.decision_scope='DERIVED_SHADOW_PERSISTENCE'
      and not current_policy.derived_semantic_persistence)
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
create trigger llm_cloudflare_projection_grants_validate before insert on llm_cloudflare_projection_route_grants
  for each row execute function dialektik_validate_cloudflare_projection_route_grant();
create trigger llm_cloudflare_projection_grants_fence after insert on llm_cloudflare_projection_route_grants
  for each row execute function dialektik_fence_content_policy_append();

create function dialektik_cloudflare_projection_decision_allowed(
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
    or provider_identity is distinct from 'llm_cloudflare_workers_ai'
    or model_identity is distinct from '@cf/openai/gpt-oss-20b'
    or acquired_content_identity !~ '^[0-9a-f]{64}$'
    or projection_identity !~ '^[0-9a-f]{64}$'
    or projection_policy_identity !~ '^[A-Za-z0-9_.:-]{1,128}$' then return false; end if;
  select * into version_row from observed_article_content_versions where id=version_identity;
  select * into article_row from articles where id=article_identity;
  select * into source_row from sources where id=source_identity;
  perform 1 from article_hash_only_projection_versions where id=projection_version_identity
    and source_id=source_identity and article_id=article_identity and policy_id=policy_identity
    and acquired_content_sha256=acquired_content_identity
    and projection_policy_version=projection_policy_identity
    and projection_sha256=projection_identity;
  if not found then return false; end if;
  select * into current_policy from content_access_policies where source_id=source_identity
    and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  if version_row.id is null or article_row.id is null or source_row.id is null
    or version_row.article_id is distinct from article_identity
    or version_row.source_id is distinct from source_identity
    or version_row.policy_id is distinct from policy_identity
    or version_row.acquired_content_hash is distinct from acquired_content_identity
    or version_row.normalized_input_hash is distinct from (select normalized_body_sha256
      from article_hash_only_projection_versions where id=projection_version_identity)
    or version_row.title_input_hash is distinct from (select title_sha256
      from article_hash_only_projection_versions where id=projection_version_identity)
    or version_row.persisted_body is not null
    or article_row.source_id is distinct from source_identity
    or article_row.origin is distinct from 'LIVE_REAL'
    or article_row.event_id is not null
    or source_row.origin is distinct from 'LIVE_REAL'
    or current_policy.id is distinct from policy_identity
    or not current_policy.metadata_storage
    or not current_policy.fulltext_acquisition
    or not current_policy.fulltext_machine_processing
    or current_policy.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or current_policy.fulltext_persistence
    or (scope_identity='DERIVED_SHADOW_PERSISTENCE' and not current_policy.derived_semantic_persistence)
    or not exists(select 1 from live_exposure_exclusions e
      join live_exposure_exclusions identity_exclusion on identity_exclusion.id=article_row.live_exposure_id
      where e.canonical_url=article_row.url_canonical
        and e.registry_key=identity_exclusion.registry_key
        and e.content_hash=version_row.normalized_input_hash
        and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then return false; end if;
  select * into decision from llm_cloudflare_projection_route_grants
    where source_id=source_identity and article_id=article_identity
      and article_version_id=version_identity and projection_version_id=projection_version_identity
      and decision_scope=scope_identity and provider_type=provider_identity and model_id=model_identity
    order by decision_sequence desc limit 1;
  return decision.id is not null and decision.decision_status='APPROVED'
    and decision.policy_id=policy_identity
    and decision.acquired_content_sha256=acquired_content_identity
    and decision.projection_policy_version=projection_policy_identity
    and decision.projection_sha256=projection_identity
    and decision.attribution_sha256=(select attribution_sha256 from article_hash_only_projection_versions
      where id=projection_version_identity)
    and not decision.fulltext_persistence
    and not decision.source_fulltext_retained
    and not decision.projection_text_retained
    and not decision.prompt_retained
    and not decision.raw_response_retained
    and not decision.quoted_source_text_retained
    and decision.attribution_required;
end;
$$;

create function dialektik_cloudflare_projection_route_allowed(
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
) returns boolean language sql stable as $$
  select dialektik_cloudflare_projection_decision_allowed('EXTERNAL_INFERENCE',
    source_identity,article_identity,version_identity,projection_version_identity,policy_identity,
    acquired_content_identity,projection_policy_identity,projection_identity,provider_identity,model_identity)
$$;

create function dialektik_cloudflare_projection_persistence_allowed(
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
) returns boolean language sql stable as $$
  select dialektik_cloudflare_projection_decision_allowed('DERIVED_SHADOW_PERSISTENCE',
    source_identity,article_identity,version_identity,projection_version_identity,policy_identity,
    acquired_content_identity,projection_policy_identity,projection_identity,provider_identity,model_identity)
$$;

create trigger llm_cloudflare_projection_grants_append_only before update or delete on llm_cloudflare_projection_route_grants
  for each row execute function dialektik_semantic_content_append_only();
create trigger llm_cloudflare_projection_grants_no_truncate before truncate on llm_cloudflare_projection_route_grants
  for each statement execute function dialektik_semantic_content_append_only();
`;

export const cloudflareProjectionRouteGrantMigration: Migration = {
  async up(database) {
    await sql.raw(SCHEMA).execute(database);
  },
  down() {
    throw new Error('Cloudflare projection route grant migration is forward-only.');
  },
};
