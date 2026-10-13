import { sql } from 'kysely';
import type { Migration } from 'kysely';

const SCHEMA = String.raw`
-- A narrowly scoped, append-only successor for the existing local-only
-- hash-only GOV.UK title decision. Canonical-Article grants retain their
-- existing schema and policy path.
alter table llm_cloudflare_projection_route_grants
  add column operator_authorization_sha256 text,
  add column approval_bundle_sha256 text,
  add column controller_signer_id text,
  add column controller_key_fingerprint_sha256 text,
  add column controller_signature_sha256 text,
  add column operator_signer_id text,
  add column operator_key_fingerprint_sha256 text,
  add column operator_signature_sha256 text,
  add column authorization_expires_at timestamptz(3),
  add column authorized_request_count integer;

alter table llm_cloudflare_projection_route_grants
  add constraint llm_cloudflare_title_only_auth_evidence check (
    (route_kind = 'CANONICAL_ARTICLE'
      and operator_authorization_sha256 is null
      and approval_bundle_sha256 is null
      and controller_signer_id is null
      and controller_key_fingerprint_sha256 is null
      and controller_signature_sha256 is null
      and operator_signer_id is null
      and operator_key_fingerprint_sha256 is null
      and operator_signature_sha256 is null
      and authorization_expires_at is null
      and authorized_request_count is null)
    or
    (route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE'
      and operator_authorization_sha256 is not null and operator_authorization_sha256 ~ '^[0-9a-f]{64}$'
      and approval_bundle_sha256 is not null and approval_bundle_sha256 ~ '^[0-9a-f]{64}$'
      and controller_signer_id is not null and controller_signer_id ~ '^[A-Za-z0-9_.:@/-]{3,160}$'
      and controller_key_fingerprint_sha256 is not null and controller_key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      and controller_signature_sha256 is not null and controller_signature_sha256 ~ '^[0-9a-f]{64}$'
      and operator_signer_id is not null and operator_signer_id ~ '^[A-Za-z0-9_.:@/-]{3,160}$'
      and operator_key_fingerprint_sha256 is not null and operator_key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      and operator_signature_sha256 is not null and operator_signature_sha256 ~ '^[0-9a-f]{64}$'
      and controller_signer_id <> operator_signer_id
      and controller_key_fingerprint_sha256 <> operator_key_fingerprint_sha256
      and authorization_expires_at is not null
      and authorization_expires_at > recorded_at
      and authorization_expires_at <= recorded_at + interval '24 hours'
      and authorized_request_count is not null and authorized_request_count = 1)
  );

create unique index llm_cloudflare_title_only_approval_event_unique
  on llm_cloudflare_projection_route_grants(approval_bundle_sha256, decision_status)
  where route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE';

create table llm_cloudflare_title_only_attempt_reservations (
  id dialektik_ulid primary key,
  route_grant_id dialektik_ulid not null references llm_cloudflare_projection_route_grants(id),
  approval_bundle_sha256 text not null check (approval_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  run_id text not null unique check (run_id ~ '^[A-Za-z0-9-]{16,64}$'),
  source_id dialektik_ulid not null references sources(id),
  article_id dialektik_ulid not null references official_api_hash_only_articles(article_id),
  article_version_id dialektik_ulid not null references official_api_hash_only_article_versions(id),
  projection_version_id dialektik_ulid not null references official_api_hash_only_projection_versions(id),
  projection_sha256 text not null check (projection_sha256 ~ '^[0-9a-f]{64}$'),
  provider_type text not null check (provider_type = 'llm_cloudflare_workers_ai'),
  model_id text not null check (model_id = '@cf/openai/gpt-oss-20b'),
  reserved_at timestamptz(3) not null,
  unique(route_grant_id),
  unique(approval_bundle_sha256)
);

create table llm_cloudflare_title_only_attempt_outcomes (
  reservation_id dialektik_ulid primary key references llm_cloudflare_title_only_attempt_reservations(id),
  outcome_state text not null check (outcome_state in ('RESPONSE_RECEIVED','UNKNOWN_SENT')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  latency_ms integer not null check (latency_ms >= 0 and latency_ms <= 600000),
  error_category text check (error_category is null or error_category ~ '^LLM_[A-Z_]{1,80}$'),
  recorded_at timestamptz(3) not null
);

create function dialektik_validate_cloudflare_title_only_attempt_outcome()
returns trigger language plpgsql as $$
declare reservation public.llm_cloudflare_title_only_attempt_reservations;
begin
  select * into reservation from public.llm_cloudflare_title_only_attempt_reservations
    where id = new.reservation_id;
  if reservation.id is null
    or new.recorded_at < reservation.reserved_at
    or (new.outcome_state = 'RESPONSE_RECEIVED' and new.http_status is null)
    or (new.outcome_state = 'UNKNOWN_SENT' and new.error_category is null)
    then raise exception using errcode = '23514', message = 'title-only attempt outcome must match its durable reservation';
  end if;
  return new;
end;
$$;
create trigger llm_cloudflare_title_only_attempt_outcomes_validate
  before insert on llm_cloudflare_title_only_attempt_outcomes
  for each row execute function dialektik_validate_cloudflare_title_only_attempt_outcome();

create function dialektik_title_only_external_authorization_available(
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
) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select exists (
    select 1
    from public.llm_cloudflare_projection_route_grants g
    where g.route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE'
      and g.decision_scope = 'EXTERNAL_INFERENCE'
      and g.decision_status = 'APPROVED'
      and g.source_id = source_identity
      and g.hash_only_article_id = article_identity
      and g.hash_only_article_version_id = version_identity
      and g.hash_only_projection_version_id = projection_version_identity
      and g.policy_id = policy_identity
      and g.acquired_content_sha256 = acquired_content_identity
      and g.projection_policy_version = projection_policy_identity
      and g.projection_sha256 = projection_identity
      and g.provider_type = provider_identity
      and g.model_id = model_identity
      and g.authorized_request_count = 1
      and g.authorization_expires_at > statement_timestamp()
      and g.controller_signer_id <> g.operator_signer_id
      and g.controller_key_fingerprint_sha256 <> g.operator_key_fingerprint_sha256
      and g.fulltext_persistence = false
      and g.source_fulltext_retained = false
      and g.projection_text_retained = false
      and g.prompt_retained = false
      and g.raw_response_retained = false
      and g.quoted_source_text_retained = false
      and g.attribution_required = true
      and not exists (
        select 1 from public.llm_cloudflare_projection_route_grants newer
        where newer.route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE'
          and newer.decision_scope = 'EXTERNAL_INFERENCE'
          and newer.source_id = g.source_id
          and newer.hash_only_article_id = g.hash_only_article_id
          and newer.hash_only_article_version_id = g.hash_only_article_version_id
          and newer.hash_only_projection_version_id = g.hash_only_projection_version_id
          and newer.provider_type = g.provider_type
          and newer.model_id = g.model_id
          and newer.decision_sequence > g.decision_sequence
      )
      and not exists (
        select 1 from public.llm_cloudflare_title_only_attempt_reservations r
        where r.approval_bundle_sha256 = g.approval_bundle_sha256
      )
    order by g.decision_sequence desc
    limit 1
  )
$$;

create function dialektik_validate_cloudflare_title_only_attempt_reservation()
returns trigger language plpgsql as $$
declare g public.llm_cloudflare_projection_route_grants;
begin
  select * into g from public.llm_cloudflare_projection_route_grants where id = new.route_grant_id;
  if g.id is null
    or g.route_kind is distinct from 'OFFICIAL_API_HASH_ONLY_TITLE'
    or g.decision_scope is distinct from 'EXTERNAL_INFERENCE'
    or g.decision_status is distinct from 'APPROVED'
    or g.approval_bundle_sha256 is distinct from new.approval_bundle_sha256
    or g.source_id is distinct from new.source_id
    or g.hash_only_article_id is distinct from new.article_id
    or g.hash_only_article_version_id is distinct from new.article_version_id
    or g.hash_only_projection_version_id is distinct from new.projection_version_id
    or g.projection_sha256 is distinct from new.projection_sha256
    or g.provider_type is distinct from new.provider_type
    or g.model_id is distinct from new.model_id
    or new.reserved_at > clock_timestamp()
    or new.reserved_at >= g.authorization_expires_at
    or not public.dialektik_cloudflare_official_api_hash_only_decision_allowed(
      'EXTERNAL_INFERENCE', new.source_id, new.article_id, new.article_version_id,
      new.projection_version_id, g.policy_id, g.acquired_content_sha256,
      g.projection_policy_version, new.projection_sha256, new.provider_type, new.model_id
    ) then
    raise exception using errcode = '23514', message = 'title-only attempt reservation lacks a current exact authorization';
  end if;
  return new;
end;
$$;

create trigger llm_cloudflare_title_only_attempt_reservations_validate
  before insert on llm_cloudflare_title_only_attempt_reservations
  for each row execute function dialektik_validate_cloudflare_title_only_attempt_reservation();

create function dialektik_title_only_attempt_reservation_append_only()
returns trigger language plpgsql as $$
begin
  raise exception using errcode = '23514', message = 'title-only attempt reservations and outcomes are append-only';
end;
$$;
create trigger llm_cloudflare_title_only_attempt_reservations_append_only
  before update or delete on llm_cloudflare_title_only_attempt_reservations
  for each row execute function dialektik_title_only_attempt_reservation_append_only();
create trigger llm_cloudflare_title_only_attempt_reservations_no_truncate
  before truncate on llm_cloudflare_title_only_attempt_reservations
  for each statement execute function dialektik_title_only_attempt_reservation_append_only();
create trigger llm_cloudflare_title_only_attempt_outcomes_append_only
  before update or delete on llm_cloudflare_title_only_attempt_outcomes
  for each row execute function dialektik_title_only_attempt_reservation_append_only();
create trigger llm_cloudflare_title_only_attempt_outcomes_no_truncate
  before truncate on llm_cloudflare_title_only_attempt_outcomes
  for each statement execute function dialektik_title_only_attempt_reservation_append_only();

create function dialektik_reserve_cloudflare_title_only_attempt(
  reservation_identity dialektik_ulid,
  run_identity text,
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
) returns dialektik_ulid language plpgsql volatile security definer
set search_path = pg_catalog, public as $$
declare g public.llm_cloudflare_projection_route_grants;
begin
  if run_identity !~ '^[A-Za-z0-9-]{16,64}$'
    or not public.dialektik_cloudflare_official_api_hash_only_route_allowed(
      source_identity, article_identity, version_identity, projection_version_identity,
      policy_identity, acquired_content_identity, projection_policy_identity,
      projection_identity, provider_identity, model_identity
    ) then return null; end if;
  select * into g from public.llm_cloudflare_projection_route_grants
    where route_kind = 'OFFICIAL_API_HASH_ONLY_TITLE'
      and decision_scope = 'EXTERNAL_INFERENCE'
      and decision_status = 'APPROVED'
      and source_id = source_identity
      and hash_only_article_id = article_identity
      and hash_only_article_version_id = version_identity
      and hash_only_projection_version_id = projection_version_identity
      and policy_id = policy_identity
      and acquired_content_sha256 = acquired_content_identity
      and projection_policy_version = projection_policy_identity
      and projection_sha256 = projection_identity
      and provider_type = provider_identity and model_id = model_identity
    order by decision_sequence desc limit 1;
  if g.id is null then return null; end if;
  insert into public.llm_cloudflare_title_only_attempt_reservations (
    id, route_grant_id, approval_bundle_sha256, run_id, source_id, article_id,
    article_version_id, projection_version_id, projection_sha256, provider_type,
    model_id, reserved_at
  ) values (
    reservation_identity, g.id, g.approval_bundle_sha256, run_identity, source_identity,
    article_identity, version_identity, projection_version_identity, projection_identity,
    provider_identity, model_identity, clock_timestamp()
  ) on conflict do nothing;
  if not found then return null; end if;
  return reservation_identity;
end;
$$;

create function dialektik_record_cloudflare_title_only_attempt_outcome(
  reservation_identity dialektik_ulid,
  outcome_identity text,
  http_status_identity integer,
  latency_identity integer,
  error_category_identity text,
  recorded_identity timestamptz
) returns boolean language plpgsql volatile security definer
set search_path = pg_catalog, public as $$
begin
  if outcome_identity not in ('RESPONSE_RECEIVED','UNKNOWN_SENT')
    or (http_status_identity is not null and http_status_identity not between 100 and 599)
    or latency_identity is null or latency_identity < 0 or latency_identity > 600000
    or (error_category_identity is not null and error_category_identity !~ '^LLM_[A-Z_]{1,80}$')
    or (outcome_identity = 'RESPONSE_RECEIVED' and http_status_identity is null)
    or (outcome_identity = 'UNKNOWN_SENT' and error_category_identity is null)
    or recorded_identity > clock_timestamp()
    or not exists(select 1 from public.llm_cloudflare_title_only_attempt_reservations
      where id=reservation_identity and recorded_identity>=reserved_at)
    or exists(select 1 from public.llm_cloudflare_title_only_attempt_outcomes where reservation_id=reservation_identity)
    then return false; end if;
  insert into public.llm_cloudflare_title_only_attempt_outcomes(
    reservation_id, outcome_state, http_status, latency_ms, error_category, recorded_at
  ) values (
    reservation_identity, outcome_identity, http_status_identity, latency_identity,
    error_category_identity, recorded_identity
  ) on conflict do nothing;
  return found;
end;
$$;

alter function dialektik_cloudflare_official_api_hash_only_decision_allowed(
  text, dialektik_ulid, dialektik_ulid, dialektik_ulid, dialektik_ulid,
  text, text, text, text, text, text
) rename to dialektik_cloudflare_official_api_hash_only_decision_allowed_pre028;
revoke all on function dialektik_cloudflare_official_api_hash_only_decision_allowed_pre028(
  text, dialektik_ulid, dialektik_ulid, dialektik_ulid, dialektik_ulid,
  text, text, text, text, text, text
) from public;

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
) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select scope_identity = 'EXTERNAL_INFERENCE'
    and public.dialektik_cloudflare_official_api_hash_only_decision_allowed_pre028(
      scope_identity, source_identity, article_identity, version_identity,
      projection_version_identity, policy_identity, acquired_content_identity,
      projection_policy_identity, projection_identity, provider_identity, model_identity
    )
    and public.dialektik_title_only_external_authorization_available(
      source_identity, article_identity, version_identity, projection_version_identity,
      policy_identity, acquired_content_identity, projection_policy_identity,
      projection_identity, provider_identity, model_identity
    )
$$;

create or replace function dialektik_cloudflare_official_api_hash_only_route_allowed(
  source_identity dialektik_ulid, article_identity dialektik_ulid,
  version_identity dialektik_ulid, projection_version_identity dialektik_ulid,
  policy_identity text, acquired_content_identity text, projection_policy_identity text,
  projection_identity text, provider_identity text, model_identity text
) returns boolean language sql stable as $$
  select public.dialektik_cloudflare_official_api_hash_only_decision_allowed('EXTERNAL_INFERENCE',
    source_identity,article_identity,version_identity,projection_version_identity,policy_identity,
    acquired_content_identity,projection_policy_identity,projection_identity,provider_identity,model_identity)
$$;

create or replace function dialektik_cloudflare_official_api_hash_only_persistence_allowed(
  source_identity dialektik_ulid, article_identity dialektik_ulid,
  version_identity dialektik_ulid, projection_version_identity dialektik_ulid,
  policy_identity text, acquired_content_identity text, projection_policy_identity text,
  projection_identity text, provider_identity text, model_identity text
) returns boolean language sql stable as $$ select false $$;
`;

export const titleOnlyExternalAuthorizationMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down() {
    throw new Error('Title-only external authorization migration is forward-only.');
  },
};
