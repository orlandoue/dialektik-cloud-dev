import { sql, type Migration } from 'kysely';

/**
 * Phase 3 stores semantic-intelligence artefacts as immutable, versioned
 * proposals.  These tables deliberately do not participate in Article.event_id
 * membership or in any Assertion/Position relationship.
 *
 * PostgreSQL's built-in double precision[] is used instead of pgvector.  The
 * array shape and finite-value checks make the storage portable to ordinary
 * PostgreSQL installations; callers can add a provider-specific nearest-
 * neighbour index later without changing the provenance contract.
 */
const PHASE_3_SCHEMA_SQL = String.raw`
create type semantic_embedding_status as enum ('succeeded', 'failed');
create type semantic_proposal_outcome as enum (
  'propose_existing_event',
  'propose_new_event',
  'ambiguous_review',
  'insufficient_signal',
  'defer_retry'
);
create type semantic_proposal_state as enum ('active', 'superseded', 'retired');
create type semantic_reprocessing_status as enum (
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed'
);
create type semantic_reprocessing_job_state as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped'
);

create table article_representations (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  representation_version text not null,
  input_hash text not null,
  title text not null,
  body text not null,
  language text,
  published_at timestamptz(3),
  canonical_text text not null,
  created_at timestamptz(3) not null,
  constraint article_representations_version_nonempty
    check (btrim(representation_version) <> ''),
  constraint article_representations_input_hash_sha256
    check (input_hash ~ '^[0-9a-f]{64}$'),
  unique (article_id, representation_version, input_hash),
  unique (id, article_id, representation_version, input_hash),
  unique (id, article_id)
);

create function dialektik_semantic_vector_is_finite(
  vector_values double precision[],
  expected_dimensions integer
)
returns boolean
language sql
immutable
strict
as $$
  select coalesce(array_ndims(vector_values), 0) = 1
    and cardinality(vector_values) = expected_dimensions
    and not exists (
      select 1
      from unnest(vector_values) as element
      where element is null
        or not (element > '-Infinity'::double precision
        and element < 'Infinity'::double precision)
    )
$$;

create table article_embeddings (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  representation_id dialektik_ulid not null,
  representation_version text not null,
  config_version text not null,
  input_hash text not null,
  provider_id text not null,
  model_id text not null,
  model_version text not null,
  dimensions integer not null,
  vector double precision[],
  status semantic_embedding_status not null,
  error_category text,
  error_detail text,
  generated_at timestamptz(3) not null,
  constraint article_embeddings_dimensions_nonnegative check (dimensions >= 0),
  constraint article_embeddings_input_hash_sha256
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint article_embeddings_provenance_nonempty check (
    btrim(representation_version) <> ''
    and btrim(provider_id) <> ''
    and btrim(model_id) <> ''
    and btrim(model_version) <> ''
    and btrim(config_version) <> ''
  ),
  constraint article_embeddings_representation_fk
    foreign key (representation_id, article_id, representation_version, input_hash)
    references article_representations(id, article_id, representation_version, input_hash),
  constraint article_embeddings_status_coherent check (
    (
      status = 'succeeded'
      and vector is not null
      and dimensions > 0
      and error_category is null
      and error_detail is null
      and dialektik_semantic_vector_is_finite(vector, dimensions)
    )
    or (
      status = 'failed'
      and vector is null
      and btrim(coalesce(error_category, '')) <> ''
    )
  ),
  unique (
    article_id,
    representation_id,
    provider_id,
    model_id,
    model_version,
    config_version
  ),
  unique (id, article_id)
);

create function dialektik_prevent_semantic_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable semantic provenance rows cannot be deleted';
  end if;
  if new is distinct from old then
    raise exception 'immutable semantic provenance rows cannot be updated';
  end if;
  return old;
end;
$$;

create trigger article_representations_immutable
before update or delete on article_representations
for each row execute function dialektik_prevent_semantic_version_mutation();
create trigger article_embeddings_immutable
before update or delete on article_embeddings
for each row execute function dialektik_prevent_semantic_version_mutation();

create table event_intelligence_proposals (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  representation_id dialektik_ulid not null,
  embedding_id dialektik_ulid,
  policy_version text not null,
  feature_version text not null,
  model_version text,
  outcome semantic_proposal_outcome not null,
  state semantic_proposal_state not null default 'active',
  candidate_event_id dialektik_ulid references events(id),
  proposed_event_key text,
  score_internal double precision,
  reason_codes jsonb not null default '[]'::jsonb,
  feature_snapshot jsonb not null default '{}'::jsonb,
  supersedes_id dialektik_ulid references event_intelligence_proposals(id),
  correlation_id dialektik_ulid,
  created_at timestamptz(3) not null,
  constraint event_intelligence_proposals_representation_fk
    foreign key (representation_id, article_id)
    references article_representations(id, article_id),
  constraint event_intelligence_proposals_embedding_fk
    foreign key (embedding_id, article_id)
    references article_embeddings(id, article_id),
  constraint event_intelligence_proposals_model_nonempty check (
    btrim(policy_version) <> ''
    and btrim(feature_version) <> ''
    and (model_version is null or btrim(model_version) <> '')
  ),
  constraint event_intelligence_proposals_reason_codes_array
    check (jsonb_typeof(reason_codes) = 'array'),
  constraint event_intelligence_proposals_feature_snapshot_object
    check (jsonb_typeof(feature_snapshot) = 'object'),
  constraint event_intelligence_proposals_score_finite check (
    score_internal is null
    or (score_internal > '-Infinity'::double precision
      and score_internal < 'Infinity'::double precision)
  ),
  constraint event_intelligence_proposals_outcome_target_coherent check (
    (
      outcome = 'propose_existing_event'
      and candidate_event_id is not null
      and proposed_event_key is null
    )
    or (
      outcome = 'propose_new_event'
      and candidate_event_id is null
      and btrim(coalesce(proposed_event_key, '')) <> ''
    )
    or outcome in ('ambiguous_review', 'insufficient_signal', 'defer_retry')
  ),
  constraint event_intelligence_proposals_key_nonempty check (
    proposed_event_key is null or btrim(proposed_event_key) <> ''
  ),
  constraint event_intelligence_proposals_supersedes_not_self check (
    supersedes_id is null or supersedes_id <> id
  ),
  unique (id, article_id)
);

create unique index event_intelligence_proposals_active_key
  on event_intelligence_proposals (
    article_id,
    representation_id,
    policy_version,
    feature_version,
    coalesce(model_version, ''),
    outcome,
    coalesce(candidate_event_id, '00000000000000000000000000'::dialektik_ulid),
    coalesce(proposed_event_key, '')
  )
  where state = 'active';

create index event_intelligence_proposals_by_article
  on event_intelligence_proposals (article_id, created_at desc);

create function dialektik_prevent_semantic_proposal_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'semantic intelligence proposals are historical and cannot be deleted';
end;
$$;

create trigger event_intelligence_proposals_no_delete
before delete on event_intelligence_proposals
for each row execute function dialektik_prevent_semantic_proposal_delete();

create table event_intelligence_features (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  event_id dialektik_ulid not null references events(id),
  proposal_id dialektik_ulid references event_intelligence_proposals(id),
  representation_id dialektik_ulid not null,
  embedding_id dialektik_ulid,
  feature_version text not null,
  embedding_cosine double precision,
  title_lexical_similarity double precision,
  body_lexical_similarity double precision,
  entity_overlap double precision not null,
  publication_delta_seconds double precision,
  event_recency_seconds double precision,
  active_window_compatibility double precision not null,
  language_compatibility double precision not null,
  syndication_relation boolean not null,
  syndicated_signal_cap double precision not null,
  embedding_error text,
  representation_input_hash text,
  embedding_input_hash text,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz(3) not null,
  constraint event_intelligence_features_representation_fk
    foreign key (representation_id, article_id)
    references article_representations(id, article_id),
  constraint event_intelligence_features_embedding_fk
    foreign key (embedding_id, article_id)
    references article_embeddings(id, article_id),
  constraint event_intelligence_features_proposal_article_fk
    foreign key (proposal_id, article_id)
    references event_intelligence_proposals(id, article_id),
  constraint event_intelligence_features_config_nonempty
    check (btrim(feature_version) <> ''),
  constraint event_intelligence_features_similarity_finite check (
    (embedding_cosine is null or (
      embedding_cosine >= -1 and embedding_cosine <= 1
      and embedding_cosine > '-Infinity'::double precision
      and embedding_cosine < 'Infinity'::double precision
    ))
    and (title_lexical_similarity is null or (
      title_lexical_similarity >= 0 and title_lexical_similarity <= 1
      and title_lexical_similarity > '-Infinity'::double precision
      and title_lexical_similarity < 'Infinity'::double precision
    ))
    and (body_lexical_similarity is null or (
      body_lexical_similarity >= 0 and body_lexical_similarity <= 1
      and body_lexical_similarity > '-Infinity'::double precision
      and body_lexical_similarity < 'Infinity'::double precision
    ))
    and (entity_overlap >= 0 and entity_overlap <= 1
      and entity_overlap > '-Infinity'::double precision
      and entity_overlap < 'Infinity'::double precision
    )
    and (publication_delta_seconds is null or (
      publication_delta_seconds >= 0
      and publication_delta_seconds > '-Infinity'::double precision
      and publication_delta_seconds < 'Infinity'::double precision
    ))
    and (event_recency_seconds is null or (
      event_recency_seconds >= 0
      and event_recency_seconds > '-Infinity'::double precision
      and event_recency_seconds < 'Infinity'::double precision
    ))
    and active_window_compatibility >= 0
    and active_window_compatibility <= 1
    and active_window_compatibility > '-Infinity'::double precision
    and active_window_compatibility < 'Infinity'::double precision
    and language_compatibility >= 0
    and language_compatibility <= 1
    and language_compatibility > '-Infinity'::double precision
    and language_compatibility < 'Infinity'::double precision
    and syndicated_signal_cap > 0
    and syndicated_signal_cap <= 1
    and syndicated_signal_cap > '-Infinity'::double precision
    and syndicated_signal_cap < 'Infinity'::double precision
    and (representation_input_hash is null or representation_input_hash ~ '^[0-9a-f]{64}$')
    and (embedding_input_hash is null or embedding_input_hash ~ '^[0-9a-f]{64}$')
    and (embedding_error is null or btrim(embedding_error) <> '')
  ),
  constraint event_intelligence_features_embedding_provenance_coherent check (
    (embedding_error is null and embedding_id is not null)
    or (embedding_error is not null and embedding_id is null)
    or (embedding_error is null and embedding_id is null)
  ),
  constraint event_intelligence_features_signal_cap_coherent check (
    (syndication_relation and syndicated_signal_cap < 1)
    or (not syndication_relation and syndicated_signal_cap = 1)
  ),
  constraint event_intelligence_features_temporal_values_coherent check (
    publication_delta_seconds is null or publication_delta_seconds >= 0
  ),
  constraint event_intelligence_features_snapshot_object
    check (jsonb_typeof(features) = 'object'),
  unique (article_id, event_id, representation_id, feature_version)
);

create trigger event_intelligence_features_immutable
before update or delete on event_intelligence_features
for each row execute function dialektik_prevent_semantic_version_mutation();

create table event_intelligence_proposal_candidates (
  proposal_id dialektik_ulid not null references event_intelligence_proposals(id),
  event_id dialektik_ulid not null references events(id),
  rank integer not null,
  internal_score double precision,
  feature_id dialektik_ulid references event_intelligence_features(id),
  retrieval_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz(3) not null,
  constraint event_intelligence_proposal_candidates_rank_positive check (rank > 0),
  constraint event_intelligence_proposal_candidates_score_finite check (
    internal_score is null
    or (internal_score > '-Infinity'::double precision
      and internal_score < 'Infinity'::double precision)
  ),
  constraint event_intelligence_proposal_candidates_metadata_object
    check (jsonb_typeof(retrieval_metadata) = 'object'),
  primary key (proposal_id, event_id),
  unique (proposal_id, rank)
);

create index event_intelligence_features_by_event
  on event_intelligence_features (event_id, created_at desc);
create index event_intelligence_proposal_candidates_by_proposal
  on event_intelligence_proposal_candidates (proposal_id, rank);

create table semantic_reprocessing_runs (
  id dialektik_ulid primary key,
  representation_version text not null,
  embedding_model_id text not null,
  embedding_model_version text not null,
  clustering_config_version text not null,
  status semantic_reprocessing_status not null,
  requested_count integer not null default 0,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  requested_at timestamptz(3) not null,
  started_at timestamptz(3),
  finished_at timestamptz(3),
  constraint semantic_reprocessing_runs_versions_nonempty check (
    btrim(representation_version) <> ''
    and btrim(embedding_model_id) <> ''
    and btrim(embedding_model_version) <> ''
    and btrim(clustering_config_version) <> ''
  ),
  constraint semantic_reprocessing_runs_counts_nonnegative check (
    requested_count >= 0 and completed_count >= 0 and failed_count >= 0
  ),
  constraint semantic_reprocessing_runs_counts_bounded check (
    completed_count + failed_count <= requested_count
  ),
  constraint semantic_reprocessing_runs_timing_coherent check (
    (status = 'queued' and started_at is null and finished_at is null)
    or (status = 'running' and started_at is not null and finished_at is null)
    or (status in ('succeeded', 'partial', 'failed')
      and started_at is not null and finished_at is not null)
  )
);

create table semantic_reprocessing_jobs (
  id dialektik_ulid primary key,
  run_id dialektik_ulid not null references semantic_reprocessing_runs(id),
  article_id dialektik_ulid not null references articles(id),
  state semantic_reprocessing_job_state not null,
  attempt_count integer not null default 0,
  error_category text,
  error_detail text,
  queued_at timestamptz(3) not null,
  started_at timestamptz(3),
  finished_at timestamptz(3),
  constraint semantic_reprocessing_jobs_attempts_nonnegative check (attempt_count >= 0),
  constraint semantic_reprocessing_jobs_timing_coherent check (
    (state = 'queued' and started_at is null and finished_at is null)
    or (state = 'running' and started_at is not null and finished_at is null)
    or (state in ('succeeded', 'failed', 'skipped')
      and started_at is not null and finished_at is not null)
  ),
  unique (run_id, article_id)
);

create index article_representations_by_article
  on article_representations (article_id, created_at desc);
create index article_embeddings_by_model
  on article_embeddings (model_id, model_version, dimensions);
create index semantic_reprocessing_jobs_by_run_state
  on semantic_reprocessing_jobs (run_id, state, queued_at);
`;

export const phase3SemanticIntelligenceMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_3_SCHEMA_SQL).execute(database);
  },
};
