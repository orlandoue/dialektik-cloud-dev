import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
-- Store database-clock values at the table's millisecond precision without
-- rounding a valid instant into the future. Authorization checks remain strict.
create or replace function dialektik_reserve_cloudflare_title_only_attempt(
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
    provider_identity, model_identity, date_trunc('milliseconds', clock_timestamp())
  ) on conflict do nothing;
  if not found then return null; end if;
  return reservation_identity;
end;
$$;

create or replace function dialektik_record_cloudflare_title_only_attempt_outcome(
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
    error_category_identity, date_trunc('milliseconds', recorded_identity)
  ) on conflict do nothing;
  return found;
end;
$$;
`;

export const titleOnlyTimestampPrecisionMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down() {
    throw new Error('Title-only timestamp precision migration is forward-only.');
  },
};
