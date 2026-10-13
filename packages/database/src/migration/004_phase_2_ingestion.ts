import { sql, type Migration } from 'kysely';

const PHASE_2_SCHEMA_SQL = String.raw`
create type ingestion_provider_type as enum ('fixture', 'rss_atom');
create type ingestion_run_status as enum ('running', 'succeeded', 'partial', 'failed');
create type ingestion_item_status as enum ('discovered', 'fetched', 'persisted', 'skipped', 'failed');
create type ingestion_error_category as enum (
  'provider_parse_error',
  'dns_error',
  'connect_timeout',
  'read_timeout',
  'http_client_error',
  'http_server_error',
  'blocked_or_disallowed',
  'unsupported_content_type',
  'response_too_large',
  'extraction_failed',
  'normalization_failed',
  'persistence_conflict',
  'unknown_internal_error'
);
create type syndication_candidate_signal as enum ('exact_content', 'title_overlap', 'declared_original');
create type syndication_candidate_direction as enum ('unknown', 'a_to_b', 'b_to_a');

create table ingestion_source_configs (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  provider_type ingestion_provider_type not null,
  feed_url text not null,
  config_metadata jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  poll_interval_seconds integer not null default 300,
  cursor text,
  cursor_updated_at timestamptz(3),
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  constraint ingestion_source_configs_poll_interval_positive check (poll_interval_seconds > 0),
  constraint ingestion_source_configs_http_feed check (
    provider_type = 'fixture' or feed_url ~* '^https?://'
  ),
  constraint ingestion_source_configs_no_secret_metadata check (
    not (config_metadata::text ~* '(password|secret|token|api[_-]?key|cookie|authorization)')
  ),
  unique (source_id, provider_type, feed_url)
);

create table ingestion_runs (
  id dialektik_ulid primary key,
  source_config_id dialektik_ulid not null references ingestion_source_configs(id),
  status ingestion_run_status not null,
  started_at timestamptz(3) not null,
  finished_at timestamptz(3),
  discovered_count integer not null default 0,
  persisted_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  candidate_count integer not null default 0,
  error_category ingestion_error_category,
  constraint ingestion_runs_counts_nonnegative check (
    discovered_count >= 0 and persisted_count >= 0 and skipped_count >= 0
    and failed_count >= 0 and candidate_count >= 0
  ),
  constraint ingestion_runs_completion_coherent check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create unique index ingestion_runs_one_active_per_source
  on ingestion_runs (source_config_id)
  where status = 'running';

create table ingestion_items (
  id dialektik_ulid primary key,
  source_config_id dialektik_ulid not null references ingestion_source_configs(id),
  identity_key text not null,
  provider_item_id text,
  discovered_url text not null,
  canonical_url text not null,
  title text,
  author text,
  published_at timestamptz(3),
  updated_at_source timestamptz(3),
  declares_wire text,
  declared_original_url text,
  provider_payload_hash text not null,
  first_seen_at timestamptz(3) not null,
  last_seen_at timestamptz(3) not null,
  status ingestion_item_status not null,
  article_id dialektik_ulid references articles(id),
  error_category ingestion_error_category,
  unique (source_config_id, identity_key),
  unique (source_config_id, canonical_url)
);

create table ingestion_run_items (
  run_id dialektik_ulid not null references ingestion_runs(id),
  ingestion_item_id dialektik_ulid not null references ingestion_items(id),
  status ingestion_item_status not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  article_id dialektik_ulid references articles(id),
  error_category ingestion_error_category,
  primary key (run_id, ingestion_item_id)
);

create table fetch_attempts (
  id dialektik_ulid primary key,
  run_id dialektik_ulid not null,
  ingestion_item_id dialektik_ulid not null,
  attempt_number integer not null check (attempt_number > 0),
  requested_url text not null,
  final_url text,
  fetched_at timestamptz(3) not null,
  http_status integer,
  content_type text,
  etag text,
  last_modified text,
  response_bytes bigint check (response_bytes is null or response_bytes >= 0),
  response_body_hash text,
  extraction_version text,
  normalization_version text,
  error_category ingestion_error_category,
  error_detail text,
  foreign key (run_id, ingestion_item_id)
    references ingestion_run_items(run_id, ingestion_item_id),
  unique (run_id, ingestion_item_id, attempt_number)
);

create table article_content_fingerprints (
  article_id dialektik_ulid primary key references articles(id),
  normalized_content_hash text not null check (normalized_content_hash ~ '^[0-9a-f]{64}$'),
  normalization_version text not null,
  created_at timestamptz(3) not null
);

create index article_content_fingerprints_by_hash
  on article_content_fingerprints (normalized_content_hash);

create table syndication_candidates (
  id dialektik_ulid primary key,
  article_a_id dialektik_ulid not null references articles(id),
  article_b_id dialektik_ulid not null references articles(id),
  signal syndication_candidate_signal not null,
  direction syndication_candidate_direction not null,
  confidence syndication_confidence not null,
  created_at timestamptz(3) not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint syndication_candidates_canonical_pair check (article_a_id < article_b_id),
  unique (article_a_id, article_b_id, signal)
);

create index ingestion_items_by_source_status
  on ingestion_items (source_config_id, status, last_seen_at desc);
create index fetch_attempts_by_item_time
  on fetch_attempts (ingestion_item_id, fetched_at desc);
create index syndication_candidates_by_article
  on syndication_candidates (article_a_id, article_b_id);
`;

export const phase2IngestionMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_2_SCHEMA_SQL).execute(database);
  },
};
