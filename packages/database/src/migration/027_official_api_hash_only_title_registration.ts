import { sql, type Migration } from 'kysely';

/**
 * Adds a metadata-only official-API identity/version path for title-only
 * processing. Canonical Article constraints and the existing route-grant
 * ledger remain authoritative and unchanged for canonical Articles.
 */
const SCHEMA = String.raw`
-- The legacy live_acquisition_receipts.raw_payload_hash is a metadata hash,
-- not the full Content API response hash. Keep authentic API-byte provenance
-- in this body-free receipt rather than overloading that shared column.
create table official_api_hash_only_acquisition_receipts (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null,
  source_policy_id text not null,
  content_policy_id text not null,
  exclusion_id text not null references live_exposure_exclusions(id),
  source_item_exclusion_id text not null references live_exposure_exclusions(id),
  content_exclusion_id text not null references live_exposure_exclusions(id),
  title_exclusion_id text not null references live_exposure_exclusions(id),
  discovery_channel text not null check (discovery_channel = 'official_api'),
  discovery_url text not null,
  canonical_url text not null,
  source_item_id text not null,
  published_at timestamptz(3) not null,
  first_available_at timestamptz(3) not null,
  modified_at timestamptz(3),
  acquired_at timestamptz(3) not null,
  acquired_content_sha256 text not null check (acquired_content_sha256 ~ '^[0-9a-f]{64}$'),
  source_body_sha256 text not null check (source_body_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_body_sha256 text not null check (normalized_body_sha256 ~ '^[0-9a-f]{64}$'),
  title_sha256 text not null check (title_sha256 ~ '^[0-9a-f]{64}$'),
  source_receipt_sha256 text not null check (source_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  acquisition_manifest_sha256 text not null check (acquisition_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_manifest_sha256 text not null check (evidence_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  rights_receipt_sha256 text not null check (rights_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  local_authorization_receipt_sha256 text not null check (local_authorization_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  attribution_sha256 text not null check (attribution_sha256 ~ '^[0-9a-f]{64}$'),
  robots_sha256 text not null check (robots_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, id),
  unique (source_id, source_item_id),
  unique (source_id, canonical_url),
  foreign key (source_id, source_policy_id) references live_source_policies(source_id, id),
  foreign key (source_id, content_policy_id) references content_access_policies(source_id, id),
  check (published_at <= first_available_at and first_available_at <= acquired_at and published_at <= acquired_at)
);

create function dialektik_validate_official_api_hash_only_acquisition_receipt() returns trigger language plpgsql as $$
declare source_row sources; source_policy live_source_policies; policy_row content_access_policies;
  exclusion_row live_exposure_exclusions;
begin
  select * into strict source_row from sources where id = new.source_id;
  select * into strict source_policy from live_source_policies
    where id = new.source_policy_id and source_id = new.source_id;
  select * into strict policy_row from content_access_policies
    where id = new.content_policy_id and source_id = new.source_id;
  select * into strict exclusion_row from live_exposure_exclusions where id = new.exclusion_id;
  if source_row.origin is distinct from 'LIVE_REAL'
    or not source_policy.active or source_policy.rights_class is distinct from 'LIVE_READY'
    or source_policy.registry_key is distinct from exclusion_row.registry_key
    or source_policy.rights_verified_at > new.acquired_at
    or exclusion_row.canonical_url is distinct from new.canonical_url
    or (exclusion_row.source_item_id is not null and exclusion_row.source_item_id is distinct from new.source_item_id)
    or exclusion_row.first_seen_at is distinct from new.first_available_at
    or not exists (select 1 from live_exposure_exclusions e
      where e.id = new.source_item_exclusion_id
        and e.registry_key = exclusion_row.registry_key
        and e.canonical_url is null
        and e.source_item_id = new.source_item_id
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
    or not exists (select 1 from live_exposure_exclusions e
      where e.id = new.content_exclusion_id
        and e.registry_key = exclusion_row.registry_key
        and e.canonical_url = new.canonical_url
        and e.content_hash = new.normalized_body_sha256
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
    or not exists (select 1 from live_exposure_exclusions e
      where e.id = new.title_exclusion_id
        and e.registry_key = exclusion_row.registry_key
        and e.canonical_url = new.canonical_url
        and e.content_hash = new.title_sha256
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
    or policy_row.id is distinct from (select id from content_access_policies
      where source_id = new.source_id and recorded_at <= new.acquired_at
      order by recorded_at desc, id desc limit 1)
    or not policy_row.metadata_storage or not policy_row.fulltext_acquisition
    or not policy_row.fulltext_machine_processing
    or policy_row.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or policy_row.fulltext_persistence or policy_row.derived_semantic_persistence
    or not exists (select 1 from live_exposure_exclusions e
      where e.registry_key = exclusion_row.registry_key
        and e.source_item_id = new.source_item_id
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
    raise exception using errcode = '23514',
      message = 'official-API hash-only receipt requires verified Source, ephemeral rights and permanent identity exclusions';
  end if;
  return new;
end;
$$;
create trigger official_api_hash_only_acquisition_receipts_validate
  before insert on official_api_hash_only_acquisition_receipts
  for each row execute function dialektik_validate_official_api_hash_only_acquisition_receipt();
create trigger official_api_hash_only_acquisition_receipts_append_only
  before update or delete on official_api_hash_only_acquisition_receipts
  for each row execute function dialektik_semantic_content_append_only();
create trigger official_api_hash_only_acquisition_receipts_no_truncate
  before truncate on official_api_hash_only_acquisition_receipts
  for each statement execute function dialektik_semantic_content_append_only();

create table official_api_hash_only_articles (
  article_id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  receipt_id dialektik_ulid not null unique references official_api_hash_only_acquisition_receipts(id),
  exclusion_id text not null references live_exposure_exclusions(id),
  content_policy_id text not null,
  recorded_at timestamptz(3) not null,
  unique (source_id, article_id),
  foreign key (source_id, content_policy_id) references content_access_policies(source_id, id)
);

create function dialektik_validate_official_api_hash_only_article() returns trigger language plpgsql as $$
declare receipt_row official_api_hash_only_acquisition_receipts; source_row sources; source_policy live_source_policies;
  exclusion_row live_exposure_exclusions; content_policy content_access_policies;
begin
  select * into strict receipt_row from official_api_hash_only_acquisition_receipts where id = new.receipt_id;
  select * into strict source_row from sources where id = new.source_id;
  select * into strict source_policy from live_source_policies
    where id = receipt_row.source_policy_id and source_id = receipt_row.source_id;
  select * into strict exclusion_row from live_exposure_exclusions where id = new.exclusion_id;
  select * into strict content_policy from content_access_policies
    where id = new.content_policy_id and source_id = new.source_id;
  if new.recorded_at > clock_timestamp()
    or new.recorded_at < receipt_row.acquired_at
    or receipt_row.source_id is distinct from new.source_id
    or receipt_row.discovery_channel is distinct from 'official_api'
    or receipt_row.source_item_id is null or receipt_row.canonical_url is null
    or receipt_row.exclusion_id is distinct from new.exclusion_id
    or source_row.origin is distinct from 'LIVE_REAL'
    or not source_policy.active or source_policy.rights_class is distinct from 'LIVE_READY'
    or exclusion_row.registry_key is distinct from source_policy.registry_key
    or exclusion_row.canonical_url is distinct from receipt_row.canonical_url
    or (exclusion_row.source_item_id is not null
      and exclusion_row.source_item_id is distinct from receipt_row.source_item_id)
    or content_policy.id is distinct from (select id from content_access_policies
      where source_id = new.source_id and recorded_at <= receipt_row.acquired_at
      order by recorded_at desc, id desc limit 1)
    or not content_policy.metadata_storage
    or not content_policy.fulltext_acquisition
    or not content_policy.fulltext_machine_processing
    or content_policy.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or content_policy.fulltext_persistence or content_policy.derived_semantic_persistence
    or exists (select 1 from articles where id = new.article_id) then
    raise exception using errcode = '23514',
      message = 'official-API hash-only identity requires an exact body-free receipt, current rights and exclusion';
  end if;
  return new;
end;
$$;
create trigger official_api_hash_only_articles_validate before insert on official_api_hash_only_articles
  for each row execute function dialektik_validate_official_api_hash_only_article();
create trigger official_api_hash_only_articles_append_only before update or delete on official_api_hash_only_articles
  for each row execute function dialektik_semantic_content_append_only();
create trigger official_api_hash_only_articles_no_truncate before truncate on official_api_hash_only_articles
  for each statement execute function dialektik_semantic_content_append_only();

create table official_api_hash_only_article_versions (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null,
  source_id dialektik_ulid not null references sources(id),
  receipt_id dialektik_ulid not null references official_api_hash_only_acquisition_receipts(id),
  content_policy_id text not null,
  previous_version_id dialektik_ulid references official_api_hash_only_article_versions(id),
  version_number integer not null check (version_number > 0),
  published_at timestamptz(3) not null,
  first_available_at timestamptz(3) not null,
  modified_at timestamptz(3),
  acquired_at timestamptz(3) not null,
  language text check (language is null or language ~ '^[A-Za-z][A-Za-z0-9-]{0,34}$'),
  content_encoding text not null check (content_encoding = 'utf-8'),
  acquired_content_sha256 text not null check (acquired_content_sha256 ~ '^[0-9a-f]{64}$'),
  source_body_sha256 text not null check (source_body_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_body_sha256 text not null check (normalized_body_sha256 ~ '^[0-9a-f]{64}$'),
  title_sha256 text not null check (title_sha256 ~ '^[0-9a-f]{64}$'),
  normalization_version text not null check (normalization_version ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  input_codepoint_length integer not null check (input_codepoint_length > 0),
  title_codepoint_length integer not null check (title_codepoint_length > 0),
  recorded_at timestamptz(3) not null,
  unique (article_id, version_number),
  unique (article_id, id),
  foreign key (source_id, article_id) references official_api_hash_only_articles(source_id, article_id),
  foreign key (source_id, content_policy_id) references content_access_policies(source_id, id),
  check ((version_number = 1) = (previous_version_id is null)),
  check (first_available_at <= acquired_at and acquired_at >= published_at)
);
create unique index official_api_hash_only_article_versions_single_successor
  on official_api_hash_only_article_versions(previous_version_id) where previous_version_id is not null;
create index official_api_hash_only_article_versions_by_article
  on official_api_hash_only_article_versions(article_id, version_number desc);

create function dialektik_validate_official_api_hash_only_article_version() returns trigger language plpgsql as $$
declare identity_row official_api_hash_only_articles; receipt_row official_api_hash_only_acquisition_receipts;
  policy_row content_access_policies; source_policy live_source_policies; exclusion_row live_exposure_exclusions;
  prior official_api_hash_only_article_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_id::text, 27));
  select * into strict identity_row from official_api_hash_only_articles where article_id = new.article_id;
  select * into strict receipt_row from official_api_hash_only_acquisition_receipts where id = new.receipt_id;
  select * into strict policy_row from content_access_policies where id = new.content_policy_id
    and source_id = new.source_id;
  select * into strict source_policy from live_source_policies where id = receipt_row.source_policy_id
    and source_id = new.source_id;
  select * into strict exclusion_row from live_exposure_exclusions where id = identity_row.exclusion_id;
  if new.recorded_at > clock_timestamp()
    or new.source_id is distinct from identity_row.source_id
    or new.receipt_id is distinct from identity_row.receipt_id
    or new.content_policy_id is distinct from identity_row.content_policy_id
    or receipt_row.source_id is distinct from new.source_id
    or receipt_row.discovery_channel is distinct from 'official_api'
    or receipt_row.source_item_id is null
    or new.acquired_at is distinct from receipt_row.acquired_at
    or new.first_available_at is distinct from receipt_row.first_available_at
    or new.published_at is distinct from receipt_row.published_at
    or new.modified_at is distinct from receipt_row.modified_at
    or new.acquired_content_sha256 is distinct from receipt_row.acquired_content_sha256
    or new.source_body_sha256 is distinct from receipt_row.source_body_sha256
    or new.normalized_body_sha256 is distinct from receipt_row.normalized_body_sha256
    or new.title_sha256 is distinct from receipt_row.title_sha256
    or new.recorded_at < new.acquired_at
    or source_policy.rights_class is distinct from 'LIVE_READY'
    or not source_policy.active
    or policy_row.id is distinct from (select id from content_access_policies
      where source_id = new.source_id and recorded_at <= new.acquired_at
      order by recorded_at desc, id desc limit 1)
    or not policy_row.metadata_storage or not policy_row.fulltext_acquisition
    or not policy_row.fulltext_machine_processing
    or policy_row.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or policy_row.fulltext_persistence or policy_row.derived_semantic_persistence
    or exists (select 1 from articles where id = new.article_id)
    or exists (select 1 from observed_article_content_versions where id = new.id)
    or not exists (select 1 from live_exposure_exclusions e
      where e.id = receipt_row.content_exclusion_id
        and e.canonical_url = receipt_row.canonical_url
        and e.registry_key = exclusion_row.registry_key
        and e.content_hash = new.normalized_body_sha256
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
    raise exception using errcode = '23514',
      message = 'official-API hash-only version requires exact receipt, ephemeral rights and permanent content exclusion';
  end if;
  select * into prior from official_api_hash_only_article_versions
    where article_id = new.article_id order by version_number desc limit 1;
  if prior.id is null then
    if new.version_number <> 1 or new.previous_version_id is not null then
      raise exception using errcode = '23514', message = 'first official-API hash-only version must begin at one';
    end if;
  elsif new.previous_version_id is distinct from prior.id
    or new.version_number <> prior.version_number + 1
    or new.recorded_at < prior.recorded_at
    or (new.acquired_content_sha256 = prior.acquired_content_sha256
      and new.source_body_sha256 = prior.source_body_sha256
      and new.normalized_body_sha256 = prior.normalized_body_sha256
      and new.title_sha256 = prior.title_sha256
      and new.content_policy_id = prior.content_policy_id) then
    raise exception using errcode = '23514', message = 'changed official-API content requires a consecutive immutable version';
  end if;
  return new;
end;
$$;
create trigger official_api_hash_only_article_versions_validate before insert on official_api_hash_only_article_versions
  for each row execute function dialektik_validate_official_api_hash_only_article_version();
create trigger official_api_hash_only_article_versions_append_only before update or delete on official_api_hash_only_article_versions
  for each row execute function dialektik_semantic_content_append_only();
create trigger official_api_hash_only_article_versions_no_truncate before truncate on official_api_hash_only_article_versions
  for each statement execute function dialektik_semantic_content_append_only();

create table official_api_hash_only_projection_versions (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null,
  article_version_id dialektik_ulid not null,
  receipt_id dialektik_ulid not null references official_api_hash_only_acquisition_receipts(id),
  policy_id text not null,
  previous_version_id dialektik_ulid references official_api_hash_only_projection_versions(id),
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
  unique (article_id, id),
  foreign key (source_id, article_id) references official_api_hash_only_articles(source_id, article_id),
  foreign key (article_id, article_version_id) references official_api_hash_only_article_versions(article_id, id),
  foreign key (source_id, policy_id) references content_access_policies(source_id, id),
  check ((version_number = 1) = (previous_version_id is null))
);
create unique index official_api_hash_only_projection_single_successor
  on official_api_hash_only_projection_versions(previous_version_id) where previous_version_id is not null;
create index official_api_hash_only_projection_by_article
  on official_api_hash_only_projection_versions(article_id, version_number desc);

create function dialektik_validate_official_api_hash_only_projection() returns trigger language plpgsql as $$
declare identity_row official_api_hash_only_articles; version_row official_api_hash_only_article_versions;
  receipt_row official_api_hash_only_acquisition_receipts; policy_row content_access_policies; prior official_api_hash_only_projection_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_id::text, 28));
  select * into strict identity_row from official_api_hash_only_articles where article_id = new.article_id;
  select * into strict version_row from official_api_hash_only_article_versions
    where id = new.article_version_id and article_id = new.article_id;
  select * into strict receipt_row from official_api_hash_only_acquisition_receipts where id = new.receipt_id;
  select * into strict policy_row from content_access_policies where id = new.policy_id
    and source_id = new.source_id;
  if new.recorded_at > clock_timestamp()
    or new.recorded_at < version_row.recorded_at
    or new.source_id is distinct from identity_row.source_id
    or new.receipt_id is distinct from identity_row.receipt_id
    or new.receipt_id is distinct from version_row.receipt_id
    or new.policy_id is distinct from identity_row.content_policy_id
    or new.policy_id is distinct from version_row.content_policy_id
    or new.acquired_content_sha256 is distinct from version_row.acquired_content_sha256
    or new.source_body_sha256 is distinct from version_row.source_body_sha256
    or new.normalized_body_sha256 is distinct from version_row.normalized_body_sha256
    or new.title_sha256 is distinct from version_row.title_sha256
    or new.normalization_version is distinct from version_row.normalization_version
    or receipt_row.discovery_channel is distinct from 'official_api'
    or receipt_row.source_item_id is null
    or receipt_row.acquisition_manifest_sha256 is distinct from new.acquisition_receipt_sha256
    or receipt_row.evidence_manifest_sha256 is distinct from new.evidence_manifest_sha256
    or receipt_row.rights_receipt_sha256 is distinct from new.rights_receipt_sha256
    or receipt_row.local_authorization_receipt_sha256 is distinct from new.local_authorization_receipt_sha256
    or receipt_row.attribution_sha256 is distinct from new.attribution_sha256
    or policy_row.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or not policy_row.metadata_storage or not policy_row.fulltext_acquisition
    or not policy_row.fulltext_machine_processing
    or policy_row.fulltext_persistence or policy_row.derived_semantic_persistence
    or exists (select 1 from article_hash_only_projection_versions where id = new.id)
    or not exists (select 1 from live_exposure_exclusions e
      where e.id = receipt_row.content_exclusion_id
        and e.canonical_url = receipt_row.canonical_url
        and e.content_hash = new.normalized_body_sha256
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
    or not exists (select 1 from live_exposure_exclusions e
      where e.id = receipt_row.title_exclusion_id
        and e.canonical_url = receipt_row.canonical_url
        and e.content_hash = new.title_sha256
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
    raise exception using errcode = '23514',
      message = 'official-API title projection must match immutable body-null version and exact Final V2 exclusion';
  end if;
  select * into prior from official_api_hash_only_projection_versions
    where article_id = new.article_id order by version_number desc limit 1;
  if prior.id is null then
    if new.version_number <> 1 or new.previous_version_id is not null then
      raise exception using errcode = '23514', message = 'first official-API title projection must begin at one';
    end if;
  elsif new.previous_version_id is distinct from prior.id
    or new.version_number <> prior.version_number + 1
    or new.recorded_at < prior.recorded_at
    or (new.projection_sha256 = prior.projection_sha256
      and new.title_sha256 = prior.title_sha256
      and new.normalized_body_sha256 = prior.normalized_body_sha256
      and new.projection_policy_version = prior.projection_policy_version) then
    raise exception using errcode = '23514', message = 'changed title projection requires a consecutive immutable version';
  end if;
  return new;
end;
$$;
create trigger official_api_hash_only_projection_validate before insert on official_api_hash_only_projection_versions
  for each row execute function dialektik_validate_official_api_hash_only_projection();
create trigger official_api_hash_only_projection_append_only before update or delete on official_api_hash_only_projection_versions
  for each row execute function dialektik_semantic_content_append_only();
create trigger official_api_hash_only_projection_no_truncate before truncate on official_api_hash_only_projection_versions
  for each statement execute function dialektik_semantic_content_append_only();

-- Extend the existing exact-scope Cloudflare decision ledger rather than
-- creating a second grant system. Legacy canonical rows default to the
-- canonical path and retain their existing foreign keys and validation.
alter table llm_cloudflare_projection_route_grants
  alter column article_id drop not null,
  alter column article_version_id drop not null,
  alter column projection_version_id drop not null;
alter table llm_cloudflare_projection_route_grants
  add column route_kind text not null default 'CANONICAL_ARTICLE'
    check (route_kind in ('CANONICAL_ARTICLE','OFFICIAL_API_HASH_ONLY_TITLE')),
  add column hash_only_article_id dialektik_ulid references official_api_hash_only_articles(article_id),
  add column hash_only_article_version_id dialektik_ulid references official_api_hash_only_article_versions(id),
  add column hash_only_projection_version_id dialektik_ulid references official_api_hash_only_projection_versions(id),
  add constraint llm_cloudflare_projection_grants_route_identity check (
    (route_kind = 'CANONICAL_ARTICLE'
      and article_id is not null and article_version_id is not null and projection_version_id is not null
      and hash_only_article_id is null and hash_only_article_version_id is null
      and hash_only_projection_version_id is null)
    or
    (route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE'
      and article_id is null and article_version_id is null and projection_version_id is null
      and hash_only_article_id is not null and hash_only_article_version_id is not null
      and hash_only_projection_version_id is not null
      and decision_scope = 'EXTERNAL_INFERENCE')
  );
create index llm_cloudflare_hash_only_grants_scope on llm_cloudflare_projection_route_grants(
  source_id, hash_only_article_id, hash_only_article_version_id, hash_only_projection_version_id,
  decision_scope, provider_type, model_id, decision_sequence desc
) where route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE';

create or replace function dialektik_validate_cloudflare_projection_route_grant() returns trigger language plpgsql as $$
declare version_row observed_article_content_versions; article_row articles; source_row sources;
  projection_row article_hash_only_projection_versions; current_policy content_access_policies;
  hash_article official_api_hash_only_articles; hash_version official_api_hash_only_article_versions;
  hash_projection official_api_hash_only_projection_versions; receipt_row official_api_hash_only_acquisition_receipts;
  source_policy live_source_policies;
begin
  if new.route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE' then
    if new.decision_scope is distinct from 'EXTERNAL_INFERENCE' then
      raise exception using errcode='23514', message='hash-only title route does not grant semantic persistence';
    end if;
    select * into strict hash_article from official_api_hash_only_articles where article_id=new.hash_only_article_id;
    select * into strict hash_version from official_api_hash_only_article_versions
      where id=new.hash_only_article_version_id and article_id=new.hash_only_article_id;
    select * into strict hash_projection from official_api_hash_only_projection_versions
      where id=new.hash_only_projection_version_id and article_id=new.hash_only_article_id
        and article_version_id=new.hash_only_article_version_id;
    select * into strict receipt_row from official_api_hash_only_acquisition_receipts where id=hash_article.receipt_id;
    select * into strict source_row from sources where id=new.source_id;
    select * into strict source_policy from live_source_policies
      where id=receipt_row.source_policy_id and source_id=new.source_id;
    select * into current_policy from content_access_policies where source_id=new.source_id
      and recorded_at<=new.recorded_at order by recorded_at desc,id desc limit 1;
    if new.recorded_at > clock_timestamp()
      or new.recorded_at < hash_projection.recorded_at
      or new.source_id is distinct from hash_article.source_id
      or new.hash_only_article_id is distinct from hash_article.article_id
      or hash_version.source_id is distinct from new.source_id
      or hash_version.receipt_id is distinct from hash_article.receipt_id
      or hash_version.content_policy_id is distinct from new.policy_id
      or hash_projection.source_id is distinct from new.source_id
      or hash_projection.policy_id is distinct from new.policy_id
      or hash_projection.receipt_id is distinct from hash_article.receipt_id
      or hash_version.acquired_content_sha256 is distinct from new.acquired_content_sha256
      or hash_projection.acquired_content_sha256 is distinct from new.acquired_content_sha256
      or hash_projection.projection_policy_version is distinct from new.projection_policy_version
      or hash_projection.projection_sha256 is distinct from new.projection_sha256
      or hash_projection.attribution_sha256 is distinct from new.attribution_sha256
      or hash_projection.rights_receipt_sha256 is distinct from new.rights_receipt_sha256
      or receipt_row.discovery_channel is distinct from 'official_api'
      or source_row.origin is distinct from 'LIVE_REAL'
      or source_policy.rights_class is distinct from 'LIVE_READY' or not source_policy.active
      or current_policy.id is distinct from new.policy_id
      or not current_policy.metadata_storage or not current_policy.fulltext_acquisition
      or not current_policy.fulltext_machine_processing
      or current_policy.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
      or current_policy.fulltext_persistence or current_policy.derived_semantic_persistence
      or new.fulltext_persistence or new.source_fulltext_retained or new.projection_text_retained
      or new.prompt_retained or new.raw_response_retained or new.quoted_source_text_retained
      or not new.attribution_required
      or not exists (select 1 from live_exposure_exclusions e
        where e.id=receipt_row.content_exclusion_id
          and e.canonical_url=receipt_row.canonical_url
          and e.content_hash=hash_version.normalized_body_sha256
          and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
      or not exists (select 1 from live_exposure_exclusions e
        where e.id=receipt_row.title_exclusion_id
          and e.canonical_url=receipt_row.canonical_url
          and e.content_hash=hash_version.title_sha256
          and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then
      raise exception using errcode='23514',
        message='Cloudflare hash-only grant must bind current rights, official receipt and exact excluded projection';
    end if;
    return new;
  end if;

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

create function dialektik_cloudflare_official_api_hash_only_decision_allowed(
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
declare identity_row official_api_hash_only_articles; version_row official_api_hash_only_article_versions;
  projection_row official_api_hash_only_projection_versions; receipt_row official_api_hash_only_acquisition_receipts;
  source_policy live_source_policies; current_policy content_access_policies;
  source_row sources; decision llm_cloudflare_projection_route_grants;
begin
  if scope_identity is distinct from 'EXTERNAL_INFERENCE'
    or provider_identity is distinct from 'llm_cloudflare_workers_ai'
    or model_identity is distinct from '@cf/openai/gpt-oss-20b'
    or acquired_content_identity !~ '^[0-9a-f]{64}$'
    or projection_identity !~ '^[0-9a-f]{64}$'
    or projection_policy_identity !~ '^[A-Za-z0-9_.:-]{1,128}$' then return false; end if;
  select * into identity_row from official_api_hash_only_articles
    where article_id=article_identity and source_id=source_identity;
  select * into version_row from official_api_hash_only_article_versions
    where id=version_identity and article_id=article_identity and source_id=source_identity;
  select * into projection_row from official_api_hash_only_projection_versions
    where id=projection_version_identity and article_id=article_identity
      and article_version_id=version_identity and source_id=source_identity;
  if identity_row.article_id is null or version_row.id is null or projection_row.id is null then return false; end if;
  select * into receipt_row from official_api_hash_only_acquisition_receipts where id=identity_row.receipt_id;
  select * into source_row from sources where id=source_identity;
  select * into source_policy from live_source_policies where id=receipt_row.source_policy_id
    and source_id=source_identity;
  select * into current_policy from content_access_policies where source_id=source_identity
    and recorded_at<=statement_timestamp() order by recorded_at desc,id desc limit 1;
  if identity_row.content_policy_id is distinct from policy_identity
    or version_row.content_policy_id is distinct from policy_identity
    or projection_row.policy_id is distinct from policy_identity
    or version_row.acquired_content_sha256 is distinct from acquired_content_identity
    or projection_row.acquired_content_sha256 is distinct from acquired_content_identity
    or projection_row.projection_policy_version is distinct from projection_policy_identity
    or projection_row.projection_sha256 is distinct from projection_identity
    or version_row.normalized_body_sha256 is distinct from projection_row.normalized_body_sha256
    or version_row.title_sha256 is distinct from projection_row.title_sha256
    or version_row.source_body_sha256 is distinct from projection_row.source_body_sha256
    or version_row.acquired_at is distinct from receipt_row.acquired_at
    or receipt_row.source_id is distinct from source_identity
    or receipt_row.discovery_channel is distinct from 'official_api'
    or receipt_row.source_item_id is null
    or source_row.origin is distinct from 'LIVE_REAL'
    or source_policy.rights_class is distinct from 'LIVE_READY' or not source_policy.active
    or current_policy.id is distinct from policy_identity
    or not current_policy.metadata_storage or not current_policy.fulltext_acquisition
    or not current_policy.fulltext_machine_processing
    or current_policy.content_access_mode is distinct from 'FULLTEXT_EPHEMERAL'
    or current_policy.fulltext_persistence or current_policy.derived_semantic_persistence
    or exists (select 1 from articles where id=article_identity)
    or not exists (select 1 from live_exposure_exclusions e
      where e.id=receipt_row.content_exclusion_id
        and e.canonical_url=receipt_row.canonical_url
        and e.content_hash=version_row.normalized_body_sha256
        and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
    or not exists (select 1 from live_exposure_exclusions e
      where e.id=receipt_row.title_exclusion_id
        and e.canonical_url=receipt_row.canonical_url
        and e.content_hash=version_row.title_sha256
        and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') then return false; end if;
  select * into decision from llm_cloudflare_projection_route_grants
    where route_kind='OFFICIAL_API_HASH_ONLY_TITLE'
      and hash_only_article_id=article_identity
      and hash_only_article_version_id=version_identity
      and hash_only_projection_version_id=projection_version_identity
      and source_id=source_identity and policy_id=policy_identity
      and decision_scope=scope_identity and provider_type=provider_identity and model_id=model_identity
    order by decision_sequence desc limit 1;
  return decision.id is not null and decision.decision_status='APPROVED'
    and decision.acquired_content_sha256=acquired_content_identity
    and decision.projection_policy_version=projection_policy_identity
    and decision.projection_sha256=projection_identity
    and decision.attribution_sha256=projection_row.attribution_sha256
    and decision.rights_receipt_sha256=projection_row.rights_receipt_sha256
    and not decision.fulltext_persistence and not decision.source_fulltext_retained
    and not decision.projection_text_retained and not decision.prompt_retained
    and not decision.raw_response_retained and not decision.quoted_source_text_retained
    and decision.attribution_required;
end;
$$;

create function dialektik_cloudflare_official_api_hash_only_route_allowed(
  source_identity dialektik_ulid, article_identity dialektik_ulid,
  version_identity dialektik_ulid, projection_version_identity dialektik_ulid,
  policy_identity text, acquired_content_identity text, projection_policy_identity text,
  projection_identity text, provider_identity text, model_identity text
) returns boolean language sql stable as $$
  select dialektik_cloudflare_official_api_hash_only_decision_allowed('EXTERNAL_INFERENCE',
    source_identity,article_identity,version_identity,projection_version_identity,policy_identity,
    acquired_content_identity,projection_policy_identity,projection_identity,provider_identity,model_identity)
$$;

create function dialektik_cloudflare_official_api_hash_only_persistence_allowed(
  source_identity dialektik_ulid, article_identity dialektik_ulid,
  version_identity dialektik_ulid, projection_version_identity dialektik_ulid,
  policy_identity text, acquired_content_identity text, projection_policy_identity text,
  projection_identity text, provider_identity text, model_identity text
) returns boolean language sql stable as $$
  select false
$$;
`;

export const officialApiHashOnlyTitleRegistrationMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down() {
    throw new Error('Official API hash-only title registration migration is forward-only.');
  },
};
