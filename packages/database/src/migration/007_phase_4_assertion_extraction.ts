import { sql, type Migration } from 'kysely';

/**
 * Phase 4 retains non-authoritative, source-grounded extraction proposals.
 *
 * Canonical ClaimSpan, Assertion, and ClaimInterpretation rows deliberately
 * remain untouched: authority has not defined AI proposal promotion or the
 * canonical Unicode offset unit.  These rows are operational generations that
 * an internal reviewer may inspect against immutable Article.text_original.
 */
const PHASE_4_ASSERTION_EXTRACTION_SQL = String.raw`
create type assertion_extraction_generation_state as enum ('active', 'superseded');
create type assertion_extraction_outcome as enum (
  'proposed', 'no_claim_worthy_content', 'failed'
);
create type assertion_extraction_reprocessing_status as enum (
  'queued', 'running', 'succeeded', 'partial', 'failed'
);
create type assertion_extraction_reprocessing_job_state as enum (
  'queued', 'running', 'succeeded', 'failed', 'skipped'
);

create table assertion_extraction_generations (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  input_hash text not null,
  text_basis text not null check (text_basis = 'article.text_original'),
  offset_encoding text not null,
  segmentation_version text not null,
  provider_id text not null,
  model_id text not null,
  model_revision text not null,
  config_version text not null,
  schema_version text not null,
  outcome assertion_extraction_outcome not null,
  failure_category text,
  proposal_payload jsonb,
  proposal_hash text,
  state assertion_extraction_generation_state not null default 'active',
  supersedes_id dialektik_ulid,
  created_at timestamptz(3) not null,
  completed_at timestamptz(3) not null,
  constraint assertion_extraction_generations_identity_nonempty check (
    btrim(input_hash) <> ''
    and btrim(offset_encoding) <> ''
    and btrim(segmentation_version) <> ''
    and btrim(provider_id) <> ''
    and btrim(model_id) <> ''
    and btrim(model_revision) <> ''
    and btrim(config_version) <> ''
    and btrim(schema_version) <> ''
  ),
  constraint assertion_extraction_generations_outcome_coherent check (
    (
      outcome in ('proposed', 'no_claim_worthy_content')
      and proposal_payload is not null
      and proposal_hash is not null
      and failure_category is null
    )
    or (
      outcome = 'failed'
      and proposal_payload is null
      and proposal_hash is null
      and failure_category is not null
      and btrim(failure_category) <> ''
    )
  ),
  constraint assertion_extraction_generations_payload_object check (
    proposal_payload is null or jsonb_typeof(proposal_payload) = 'object'
  ),
  constraint assertion_extraction_generations_not_self_superseding check (
    supersedes_id is null or supersedes_id <> id
  ),
  unique (id, article_id),
  unique (
    article_id, input_hash, segmentation_version, provider_id, model_id,
    model_revision, config_version, schema_version
  ),
  foreign key (supersedes_id, article_id)
    references assertion_extraction_generations(id, article_id)
);

create unique index assertion_extraction_generations_one_active_per_article
  on assertion_extraction_generations (article_id)
  where state = 'active';
create unique index assertion_extraction_generations_no_lineage_branch
  on assertion_extraction_generations (supersedes_id)
  where supersedes_id is not null;

create function dialektik_validate_assertion_extraction_generation()
returns trigger
language plpgsql
as $$
declare article_text text;
declare source_hash text;
declare span jsonb;
declare span_start integer;
declare span_end integer;
declare span_text text;
begin
  select text_original into article_text from articles where id = new.article_id;
  if article_text is null then
    raise exception using errcode = '23503', message = 'Article not found for extraction generation';
  end if;
  source_hash := encode(digest(article_text, 'sha256'), 'hex');
  if new.input_hash <> source_hash then
    raise exception using
      errcode = '23514',
      message = 'extraction generation input_hash must match Article.text_original';
  end if;
  if new.outcome not in ('proposed', 'no_claim_worthy_content') then
    return new;
  end if;
  if new.proposal_payload ->> 'schema_version' <> new.schema_version
    or jsonb_typeof(new.proposal_payload -> 'spans') <> 'array' then
    raise exception using
      errcode = '23514',
      message = 'extraction proposal payload must have matching schema_version and spans array';
  end if;
  for span in select value from jsonb_array_elements(new.proposal_payload -> 'spans') loop
    if jsonb_typeof(span) <> 'object'
      or not (span ? 'start' and span ? 'end' and span ? 'quoted_text') then
      raise exception using errcode = '23514', message = 'extraction proposal span is malformed';
    end if;
    begin
      span_start := (span ->> 'start')::integer;
      span_end := (span ->> 'end')::integer;
    exception when invalid_text_representation then
      raise exception using errcode = '23514', message = 'extraction proposal offsets must be integers';
    end;
    span_text := span ->> 'quoted_text';
    if span_start < 0 or span_end <= span_start or span_end > char_length(article_text)
      or substring(article_text from span_start + 1 for span_end - span_start) <> span_text then
      raise exception using
        errcode = '23514',
        message = 'extraction proposal span must exactly resolve from Article.text_original';
    end if;
  end loop;
  return new;
end;
$$;

create trigger assertion_extraction_generations_validate_source_fidelity
before insert on assertion_extraction_generations
for each row execute function dialektik_validate_assertion_extraction_generation();

create function dialektik_preserve_assertion_extraction_generation_history()
returns trigger
language plpgsql
as $$
begin
  if old.state = 'active' and new.state = 'superseded' then
    new.state := old.state;
    if new is distinct from old then
      raise exception 'assertion extraction history is immutable except active to superseded';
    end if;
    new.state := 'superseded';
    return new;
  end if;
  raise exception 'assertion extraction history is immutable except active to superseded';
end;
$$;

create trigger assertion_extraction_generations_history_immutable
before update or delete on assertion_extraction_generations
for each row execute function dialektik_preserve_assertion_extraction_generation_history();

create table assertion_extraction_reprocessing_runs (
  id dialektik_ulid primary key,
  segmentation_version text not null,
  provider_id text not null,
  model_id text not null,
  model_revision text not null,
  config_version text not null,
  schema_version text not null,
  status assertion_extraction_reprocessing_status not null default 'queued',
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz(3) not null,
  started_at timestamptz(3),
  finished_at timestamptz(3),
  constraint assertion_extraction_reprocessing_runs_identity_nonempty check (
    btrim(segmentation_version) <> '' and btrim(provider_id) <> ''
    and btrim(model_id) <> '' and btrim(model_revision) <> ''
    and btrim(config_version) <> '' and btrim(schema_version) <> ''
  )
);

create table assertion_extraction_reprocessing_jobs (
  id dialektik_ulid primary key,
  run_id dialektik_ulid not null references assertion_extraction_reprocessing_runs(id),
  article_id dialektik_ulid not null references articles(id),
  state assertion_extraction_reprocessing_job_state not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_category text,
  error_detail text,
  queued_at timestamptz(3) not null,
  started_at timestamptz(3),
  finished_at timestamptz(3),
  unique (run_id, article_id)
);
`;

export const phase4AssertionExtractionMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_4_ASSERTION_EXTRACTION_SQL).execute(database);
  },
};
