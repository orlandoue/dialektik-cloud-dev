import { sql, type Migration } from 'kysely';

const INITIAL_SCHEMA_SQL = String.raw`
create domain dialektik_ulid as text collate "C"
  check (value ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$');

create domain similarity_score as double precision
  check (value >= 0 and value <= 1 and value <> 'NaN'::double precision);
create domain candidate_score as double precision
  check (value >= 0 and value <= 1 and value <> 'NaN'::double precision);
create domain event_clustering_score as double precision
  check (value >= 0 and value <= 1 and value <> 'NaN'::double precision);
create domain relationship_confidence as double precision
  check (value >= 0 and value <= 1 and value <> 'NaN'::double precision);
create domain extraction_confidence as double precision
  check (value >= 0 and value <= 1 and value <> 'NaN'::double precision);
create domain evidence_relevance as double precision
  check (value >= 0 and value <= 1 and value <> 'NaN'::double precision);

create type source_type as enum (
  'official_statistics',
  'wire_agency',
  'daily_newspaper',
  'digital_native',
  'radio',
  'tv',
  'other'
);
create type user_role as enum ('user', 'moderator', 'editor', 'system', 'auditor');
create type analysis_state as enum ('ANALYSIS_PENDING', 'PUBLISHED');
create type processing_error as enum ('extraction_failed', 'normalization_failed');
create type span_location as enum ('headline', 'lede', 'body', 'caption');
create type attributor_type as enum (
  'outlet',
  'person',
  'institution',
  'wire_agency',
  'automated_system'
);
create type assertion_type as enum (
  'magnitude',
  'comparison',
  'temporal_sequence',
  'causal_claim',
  'valuation',
  'prediction',
  'attribution',
  'existence'
);
create type persisted_epistemic_class as enum ('not_evaluable');
create type interpretation_creator as enum ('system', 'moderator');
create type position_publication_state as enum ('internal', 'published', 'superseded');
create type relationship_type as enum ('R01a', 'R01b', 'R05', 'R06', 'R07', 'R11a', 'R11b');
create type relationship_scope as enum ('intra_event', 'cross_event', 'intra_article');
create type relationship_publication_state as enum ('proposed', 'published', 'rejected');
create type relationship_endpoint_role as enum ('source', 'target', 'peer_a', 'peer_b');
create type rectified_by as enum ('SOURCE', 'MODERATION');
create type contradiction_publication_state as enum (
  'published',
  'requires_review',
  'retracted'
);
create type evidence_stance as enum ('supports', 'contradicts', 'contextualizes');
create type evidence_publication_state as enum ('pending_review', 'published', 'rejected');
create type evaluation_class as enum (
  'well_supported',
  'insufficiently_supported',
  'challenged_by_evidence',
  'not_evaluable'
);
create type position_tombstone_operation as enum ('split', 'merge', 'absorbed');
create type moderation_task_type as enum (
  'equivalence_review',
  'relationship_confirmation',
  'projection_publication',
  'title_review',
  'evidence_approval',
  'merge_split_review',
  'projection_stale_review'
);
create type moderation_task_state as enum (
  'pending',
  'partially_accepted',
  'rejected',
  'escalated',
  'resolved'
);

create table users (
  id dialektik_ulid primary key,
  role user_role not null,
  created_at timestamptz(3) not null
);

create table categories (
  id dialektik_ulid primary key
);

create table topics (
  id dialektik_ulid primary key
);

create table sources (
  id dialektik_ulid primary key,
  name text not null,
  source_type source_type not null,
  is_issuing_entity boolean not null,
  canonical_domain text not null,
  created_at timestamptz(3) not null
);

create table events (
  id dialektik_ulid primary key,
  title_descriptive text not null,
  category_id dialektik_ulid not null references categories(id),
  window_from timestamptz(3) not null,
  window_to timestamptz(3),
  detected_at timestamptz(3) not null,
  analysis_state analysis_state not null,
  merged_into dialektik_ulid references events(id),
  merged_by dialektik_ulid references users(id),
  merged_at timestamptz(3),
  constraint events_not_merged_into_self check (merged_into is null or merged_into <> id),
  constraint events_merge_metadata_coherent check (
    (merged_into is null and merged_by is null and merged_at is null)
    or
    (merged_into is not null and merged_by is not null and merged_at is not null)
  )
);

create table event_topics (
  event_id dialektik_ulid not null references events(id),
  topic_id dialektik_ulid not null references topics(id),
  primary key (event_id, topic_id)
);

create table articles (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  event_id dialektik_ulid references events(id),
  url_canonical text not null unique,
  text_original text not null,
  text_normalized text not null,
  lang text not null,
  published_at timestamptz(3) not null,
  captured_at timestamptz(3) not null,
  updated_at_source timestamptz(3),
  declares_wire text,
  syndication_of dialektik_ulid references articles(id),
  clustering_score event_clustering_score,
  processing_error processing_error,
  constraint articles_not_syndicated_from_self check (
    syndication_of is null or syndication_of <> id
  )
);

create table positions (
  id dialektik_ulid primary key,
  event_id dialektik_ulid not null references events(id),
  neutral_rank integer,
  title_text text not null,
  title_edited_by dialektik_ulid references users(id),
  title_edited_at timestamptz(3),
  title_previous text,
  publication_state position_publication_state not null,
  published_at timestamptz(3),
  published_by dialektik_ulid references users(id),
  tombstone_id dialektik_ulid,
  constraint positions_neutral_rank_positive check (
    neutral_rank is null or neutral_rank > 0
  ),
  constraint positions_title_edit_metadata_coherent check (
    (title_edited_by is null and title_edited_at is null and title_previous is null)
    or
    (title_edited_by is not null and title_edited_at is not null and title_previous is not null)
  ),
  constraint positions_publication_metadata_coherent check (
    publication_state <> 'published'
    or
    (neutral_rank is not null and published_at is not null and published_by is not null)
  )
);

create table claim_spans (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  text_offset_start integer not null,
  text_offset_end integer not null,
  quoted_text text not null,
  location span_location not null,
  captured_at timestamptz(3) not null,
  primary_position_id dialektik_ulid references positions(id),
  tombstone_id dialektik_ulid,
  constraint claim_spans_valid_offsets check (
    text_offset_start >= 0 and text_offset_end > text_offset_start
  )
);

create table attribution_chain (
  span_id dialektik_ulid not null references claim_spans(id),
  "order" integer not null check ("order" >= 1),
  attributor text not null,
  attributor_type attributor_type not null,
  primary key (span_id, "order")
);

create table assertions (
  id dialektik_ulid primary key,
  claim_span_id dialektik_ulid not null references claim_spans(id),
  ordinal integer not null check (ordinal >= 1),
  is_principal boolean not null,
  assertion_type assertion_type not null,
  subject_ref text not null,
  temporal_scope jsonb not null,
  population_scope jsonb,
  comparison_base text,
  position_id dialektik_ulid references positions(id),
  epistemic_class persisted_epistemic_class,
  epistemic_reason text,
  extraction_confidence extraction_confidence not null,
  version integer not null check (version >= 1),
  supersedes_id dialektik_ulid references assertions(id),
  constraint assertions_not_self_superseding check (
    supersedes_id is null or supersedes_id <> id
  ),
  constraint assertions_temporal_scope_shape check (
    jsonb_typeof(temporal_scope) = 'object'
    and temporal_scope ? 'from'
    and temporal_scope ? 'to'
    and temporal_scope ? 'granularity'
  ),
  constraint assertions_valuation_not_evaluable check (
    assertion_type <> 'valuation'
    or epistemic_class is not distinct from 'not_evaluable'::persisted_epistemic_class
  ),
  constraint assertions_epistemic_reason_required check (
    epistemic_class is null
    or (epistemic_reason is not null and btrim(epistemic_reason) <> '')
  )
);

create table claim_interpretations (
  id dialektik_ulid primary key,
  assertion_id dialektik_ulid not null references assertions(id),
  normalized_form text not null,
  model_ref text not null,
  model_version text not null,
  content_hash text not null,
  version integer not null check (version >= 1),
  supersedes_id dialektik_ulid references claim_interpretations(id),
  created_by interpretation_creator not null,
  constraint claim_interpretations_not_self_superseding check (
    supersedes_id is null or supersedes_id <> id
  )
);

create table evidence (
  id dialektik_ulid primary key,
  anchor_span_id dialektik_ulid not null references claim_spans(id),
  scope_assertion_id dialektik_ulid references assertions(id),
  stance evidence_stance not null,
  summary text not null,
  citable_source_url text,
  citable_source_title text,
  contributed_by dialektik_ulid references users(id),
  publication_state evidence_publication_state not null,
  approved_by dialektik_ulid references users(id),
  approved_at timestamptz(3),
  relevance evidence_relevance not null,
  constraint evidence_contradiction_is_citable check (
    stance <> 'contradicts'
    or (citable_source_url is not null and btrim(citable_source_url) <> '')
  ),
  constraint evidence_approval_metadata_coherent check (
    (approved_by is null and approved_at is null)
    or
    (approved_by is not null and approved_at is not null)
  ),
  constraint evidence_published_is_approved check (
    publication_state <> 'published'
    or (approved_by is not null and approved_at is not null)
  )
);

create table relationships (
  id dialektik_ulid primary key,
  rel_type relationship_type not null,
  event_id dialektik_ulid not null references events(id),
  scope relationship_scope not null,
  publication_state relationship_publication_state not null,
  confidence relationship_confidence not null,
  declared_by dialektik_ulid references users(id),
  confirmed_by dialektik_ulid references users(id),
  confirmed_at timestamptz(3),
  non_comparable_reason text,
  triggering_evidence_id dialektik_ulid references evidence(id),
  rectified_by rectified_by,
  constraint relationships_r01a_has_declarer check (
    rel_type <> 'R01a' or declared_by is not null
  ),
  constraint relationships_r01b_is_only_proposed check (
    rel_type <> 'R01b' or publication_state = 'proposed'
  ),
  constraint relationships_non_comparable_has_reason check (
    rel_type not in ('R06', 'R07')
    or (non_comparable_reason is not null and btrim(non_comparable_reason) <> '')
  ),
  constraint relationships_triggering_evidence_type check (
    triggering_evidence_id is null or rel_type = 'R11b'
  ),
  constraint relationships_rectifier_type check (
    rectified_by is null or rel_type = 'R11a'
  ),
  constraint relationships_confirmation_metadata_coherent check (
    (confirmed_by is null and confirmed_at is null)
    or
    (confirmed_by is not null and confirmed_at is not null)
  ),
  constraint relationships_published_is_confirmed check (
    publication_state <> 'published'
    or (confirmed_by is not null and confirmed_at is not null)
  )
);

create table relationship_endpoints (
  relationship_id dialektik_ulid not null references relationships(id),
  assertion_id dialektik_ulid not null references assertions(id),
  role relationship_endpoint_role not null,
  primary key (relationship_id, role),
  unique (relationship_id, assertion_id)
);

create table position_title_generated_from (
  position_id dialektik_ulid not null references positions(id),
  assertion_id dialektik_ulid not null references assertions(id),
  ordinal integer not null check (ordinal >= 1),
  primary key (position_id, assertion_id),
  unique (position_id, ordinal)
);

create table position_formed_by (
  position_id dialektik_ulid not null references positions(id),
  relationship_id dialektik_ulid not null references relationships(id),
  ordinal integer not null check (ordinal >= 1),
  primary key (position_id, relationship_id),
  unique (position_id, ordinal)
);

create table contradiction_publications (
  id dialektik_ulid primary key,
  event_id dialektik_ulid not null references events(id),
  position_a_id dialektik_ulid not null references positions(id),
  position_b_id dialektik_ulid not null references positions(id),
  projection_hash text not null,
  ratio_conflicting_at_publication integer not null check (
    ratio_conflicting_at_publication >= 0
  ),
  ratio_comparable_at_publication integer not null check (
    ratio_comparable_at_publication > 0
  ),
  threshold_rule_at_publication text not null,
  confirmed_by dialektik_ulid not null references users(id),
  confirmed_at timestamptz(3) not null,
  publication_state contradiction_publication_state not null,
  retracted_by dialektik_ulid references users(id),
  retracted_at timestamptz(3),
  retraction_reason text,
  constraint contradiction_publications_distinct_positions check (
    position_a_id <> position_b_id
  ),
  constraint contradiction_publications_snapshot_text_present check (
    btrim(projection_hash) <> ''
    and btrim(threshold_rule_at_publication) <> ''
  ),
  constraint contradiction_publications_ratio_is_valid check (
    ratio_conflicting_at_publication <= ratio_comparable_at_publication
  ),
  constraint contradiction_publications_retraction_coherent check (
    (
      publication_state = 'retracted'
      and retracted_by is not null
      and retracted_at is not null
      and retraction_reason is not null
      and btrim(retraction_reason) <> ''
    )
    or
    (
      publication_state <> 'retracted'
      and retracted_by is null
      and retracted_at is null
      and retraction_reason is null
    )
  )
);

create table primary_facts (
  id dialektik_ulid primary key,
  event_id dialektik_ulid not null references events(id),
  statement text not null,
  primary_publication_url text not null,
  primary_source_id dialektik_ulid not null references sources(id),
  klass text not null check (klass = 'observed'),
  constraint primary_facts_publication_url_present check (
    btrim(primary_publication_url) <> ''
  )
);

create table user_evaluations (
  id dialektik_ulid primary key,
  assertion_id dialektik_ulid not null references assertions(id),
  user_id dialektik_ulid not null references users(id),
  klass evaluation_class not null,
  attached_evidence_id dialektik_ulid references evidence(id),
  created_at timestamptz(3) not null,
  supersedes_id dialektik_ulid references user_evaluations(id),
  constraint user_evaluations_not_self_superseding check (
    supersedes_id is null or supersedes_id <> id
  )
);

create table position_tombstones (
  id dialektik_ulid primary key,
  position_id dialektik_ulid not null unique references positions(id),
  operation position_tombstone_operation not null,
  reason text not null check (btrim(reason) <> ''),
  actor_id dialektik_ulid not null references users(id),
  occurred_at timestamptz(3) not null
);

create table position_tombstone_successors (
  tombstone_id dialektik_ulid not null references position_tombstones(id),
  successor_position_id dialektik_ulid not null references positions(id),
  ordinal integer not null check (ordinal >= 1),
  primary key (tombstone_id, successor_position_id),
  unique (tombstone_id, ordinal)
);

create table span_tombstones (
  id dialektik_ulid primary key,
  span_id dialektik_ulid not null unique references claim_spans(id),
  successor_span_id dialektik_ulid not null references claim_spans(id),
  rectified_by rectified_by not null,
  occurred_at timestamptz(3) not null,
  constraint span_tombstones_distinct_successor check (span_id <> successor_span_id)
);

alter table positions
  add constraint positions_tombstone_fk
  foreign key (tombstone_id) references position_tombstones(id);

alter table claim_spans
  add constraint claim_spans_tombstone_fk
  foreign key (tombstone_id) references span_tombstones(id);

create table moderation_tasks (
  id dialektik_ulid primary key,
  task_type moderation_task_type not null,
  target_type text not null,
  target_id dialektik_ulid not null,
  state moderation_task_state not null,
  priority candidate_score not null,
  assigned_to dialektik_ulid references users(id),
  created_at timestamptz(3) not null,
  resolved_at timestamptz(3),
  resolution_reason text,
  constraint moderation_tasks_unblocked_target_type check (
    target_type in ('Event', 'Position')
  )
);

create table audit_entries (
  id dialektik_ulid primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_id dialektik_ulid not null references users(id),
  actor_type text not null,
  before jsonb,
  after jsonb,
  occurred_at timestamptz(3) not null
);

create index idx_event_detected
  on events (category_id, detected_at desc);
create index idx_contradiction_index
  on contradiction_publications (confirmed_at desc)
  where publication_state = 'published';
create index idx_span_article
  on claim_spans (article_id);
create index idx_assertion_span
  on assertions (claim_span_id, ordinal);
create index idx_assertion_position
  on assertions (position_id)
  where position_id is not null;
create index idx_position_event
  on positions (event_id, neutral_rank);
create index idx_rel_event_type
  on relationships (event_id, rel_type, publication_state);
create index idx_rel_endpoint
  on relationship_endpoints (assertion_id);
create index idx_evidence_anchor
  on evidence (anchor_span_id, stance)
  where publication_state = 'published';
create index idx_task_queue
  on moderation_tasks (state, priority desc, created_at);

create function dialektik_actor_must_be_human(actor dialektik_ulid, context_name text)
returns void
language plpgsql
stable
as $$
declare
  actor_role user_role;
begin
  select role into actor_role from users where id = actor;
  if actor_role is null then
    raise exception using
      errcode = '23503',
      message = context_name || ' actor does not exist';
  end if;
  if actor_role = 'system' then
    raise exception using
      errcode = '23514',
      message = context_name || ' requires a human actor';
  end if;
end;
$$;

create function dialektik_validate_moderation_targets()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from moderation_tasks task
    where (
      task.target_type = 'Event'
      and not exists (
        select 1 from events event_row where event_row.id = task.target_id
      )
    ) or (
      task.target_type = 'Position'
      and not exists (
        select 1 from positions position_row where position_row.id = task.target_id
      )
    )
  ) then
    raise exception using
      errcode = '23503',
      message = 'moderation task target must resolve to its declared entity';
  end if;
  return null;
end;
$$;

create constraint trigger moderation_tasks_targets_resolve
after insert or update on moderation_tasks
deferrable initially deferred
for each row execute function dialektik_validate_moderation_targets();
create constraint trigger events_preserve_moderation_targets
after update or delete on events
deferrable initially deferred
for each row execute function dialektik_validate_moderation_targets();
create constraint trigger positions_preserve_moderation_targets
after update or delete on positions
deferrable initially deferred
for each row execute function dialektik_validate_moderation_targets();

create function dialektik_validate_sensitive_actors()
returns trigger
language plpgsql
as $$
declare
  row_data jsonb;
begin
  row_data := to_jsonb(new);
  if tg_table_name = 'events' and row_data ->> 'merged_by' is not null then
    perform dialektik_actor_must_be_human(
      (row_data ->> 'merged_by')::dialektik_ulid,
      'event merge'
    );
  elsif tg_table_name = 'positions' then
    if row_data ->> 'published_by' is not null then
      perform dialektik_actor_must_be_human(
        (row_data ->> 'published_by')::dialektik_ulid,
        'position publication'
      );
    end if;
    if row_data ->> 'title_edited_by' is not null then
      perform dialektik_actor_must_be_human(
        (row_data ->> 'title_edited_by')::dialektik_ulid,
        'position title edit'
      );
    end if;
  elsif tg_table_name = 'relationships' then
    if row_data ->> 'rel_type' = 'R01a' then
      perform dialektik_actor_must_be_human(
        (row_data ->> 'declared_by')::dialektik_ulid,
        'strict equivalence declaration'
      );
    end if;
    if row_data ->> 'confirmed_by' is not null then
      perform dialektik_actor_must_be_human(
        (row_data ->> 'confirmed_by')::dialektik_ulid,
        'relationship confirmation'
      );
    end if;
  elsif tg_table_name = 'evidence' and row_data ->> 'approved_by' is not null then
    perform dialektik_actor_must_be_human(
      (row_data ->> 'approved_by')::dialektik_ulid,
      'evidence approval'
    );
  elsif tg_table_name = 'contradiction_publications' then
    perform dialektik_actor_must_be_human(
      (row_data ->> 'confirmed_by')::dialektik_ulid,
      'contradiction publication'
    );
    if row_data ->> 'retracted_by' is not null then
      perform dialektik_actor_must_be_human(
        (row_data ->> 'retracted_by')::dialektik_ulid,
        'contradiction retraction'
      );
    end if;
  elsif tg_table_name = 'position_tombstones' then
    perform dialektik_actor_must_be_human(
      (row_data ->> 'actor_id')::dialektik_ulid,
      'position tombstone'
    );
  end if;
  return new;
end;
$$;

create trigger events_sensitive_actor
before insert or update on events
for each row execute function dialektik_validate_sensitive_actors();
create trigger positions_sensitive_actor
before insert or update on positions
for each row execute function dialektik_validate_sensitive_actors();
create trigger relationships_sensitive_actor
before insert or update on relationships
for each row execute function dialektik_validate_sensitive_actors();
create trigger evidence_sensitive_actor
before insert or update on evidence
for each row execute function dialektik_validate_sensitive_actors();
create trigger contradiction_publications_sensitive_actor
before insert or update on contradiction_publications
for each row execute function dialektik_validate_sensitive_actors();
create trigger position_tombstones_sensitive_actor
before insert or update on position_tombstones
for each row execute function dialektik_validate_sensitive_actors();

create function dialektik_validate_event_merge_lineage()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:event-merge', 0));
  if new.merged_into is null then
    return new;
  end if;
  if exists (
    with recursive successors(id, path) as (
      select event_row.id, array[event_row.id::text]
      from events event_row
      where event_row.id = new.merged_into
      union all
      select event_row.merged_into, successors.path || event_row.merged_into::text
      from events event_row
      join successors on event_row.id = successors.id
      where event_row.merged_into is not null
        and not event_row.merged_into::text = any(successors.path)
    )
    select 1 from successors where id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'event merge lineage must be acyclic';
  end if;
  return new;
end;
$$;

create trigger events_merge_lineage_acyclic
before insert or update of id, merged_into on events
for each row execute function dialektik_validate_event_merge_lineage();

create function dialektik_preserve_event_merge_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.merged_into is not null then
      raise exception using
        errcode = '55000',
        message = 'merged event is retained historical data';
    end if;
    return old;
  end if;
  if old.merged_into is not null and (
    new.merged_into is distinct from old.merged_into
    or new.merged_by is distinct from old.merged_by
    or new.merged_at is distinct from old.merged_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'event merge lineage is immutable history';
  end if;
  return new;
end;
$$;

create trigger events_merge_history_immutable
before update of merged_into, merged_by, merged_at or delete on events
for each row execute function dialektik_preserve_event_merge_history();

create function dialektik_guard_user_system_role()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'system' and old.role <> 'system' and (
    exists (select 1 from events where merged_by = new.id)
    or exists (
      select 1 from positions
      where published_by = new.id or title_edited_by = new.id
    )
    or exists (
      select 1 from relationships
      where confirmed_by = new.id or (rel_type = 'R01a' and declared_by = new.id)
    )
    or exists (select 1 from evidence where approved_by = new.id)
    or exists (
      select 1 from contradiction_publications
      where confirmed_by = new.id or retracted_by = new.id
    )
    or exists (select 1 from position_tombstones where actor_id = new.id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'a human epistemic actor cannot be converted to system';
  end if;
  return new;
end;
$$;

create trigger users_preserve_sensitive_actor_kind
before update of role on users
for each row execute function dialektik_guard_user_system_role();

create function dialektik_prevent_article_original_mutation()
returns trigger
language plpgsql
as $$
begin
  if new.text_original is distinct from old.text_original then
    raise exception using
      errcode = '55000',
      message = 'article original text is immutable';
  end if;
  return new;
end;
$$;

create trigger articles_original_text_immutable
before update on articles
for each row execute function dialektik_prevent_article_original_mutation();

create function dialektik_prevent_claim_span_mutation()
returns trigger
language plpgsql
as $$
begin
  if new.article_id is distinct from old.article_id
    or new.text_offset_start is distinct from old.text_offset_start
    or new.text_offset_end is distinct from old.text_offset_end
    or new.quoted_text is distinct from old.quoted_text
    or new.captured_at is distinct from old.captured_at then
    raise exception using
      errcode = '55000',
      message = 'claim span observed fields are immutable';
  end if;
  return new;
end;
$$;

create trigger claim_spans_observed_fields_immutable
before update on claim_spans
for each row execute function dialektik_prevent_claim_span_mutation();

create function dialektik_prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'audit entries are append-only';
end;
$$;

create trigger audit_entries_append_only
before update or delete on audit_entries
for each row execute function dialektik_prevent_audit_mutation();

create function dialektik_prevent_evaluation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'user evaluations are immutable history';
end;
$$;

create trigger user_evaluations_immutable_history
before update or delete on user_evaluations
for each row execute function dialektik_prevent_evaluation_mutation();

create function dialektik_prevent_interpretation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'claim interpretations are immutable versions';
end;
$$;

create trigger claim_interpretations_immutable_versions
before update or delete on claim_interpretations
for each row execute function dialektik_prevent_interpretation_mutation();

create function dialektik_validate_interpretation_supersession()
returns trigger
language plpgsql
as $$
declare
  prior_assertion_id dialektik_ulid;
begin
  if new.supersedes_id is null then
    return new;
  end if;
  select assertion_id into prior_assertion_id
  from claim_interpretations
  where id = new.supersedes_id;
  if prior_assertion_id is not null
    and prior_assertion_id <> new.assertion_id then
    raise exception using
      errcode = '23514',
      message = 'interpretation supersession must preserve its assertion';
  end if;
  return new;
end;
$$;

create trigger claim_interpretations_validate_supersession
before insert on claim_interpretations
for each row execute function dialektik_validate_interpretation_supersession();

create function dialektik_validate_assertion_supersession()
returns trigger
language plpgsql
as $$
declare
  prior_span_id dialektik_ulid;
begin
  if new.supersedes_id is null then
    return new;
  end if;
  select claim_span_id into prior_span_id
  from assertions
  where id = new.supersedes_id;
  if prior_span_id is not null and prior_span_id <> new.claim_span_id then
    raise exception using
      errcode = '23514',
      message = 'assertion supersession must preserve its claim span';
  end if;
  return new;
end;
$$;

create trigger assertions_validate_supersession
before insert or update of claim_span_id, supersedes_id on assertions
for each row execute function dialektik_validate_assertion_supersession();

create function dialektik_preserve_superseded_assertion()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'assertions are retained version history';
  end if;
  if exists (select 1 from assertions where supersedes_id = old.id) then
    raise exception using
      errcode = '55000',
      message = 'a superseded assertion is immutable history';
  end if;
  return new;
end;
$$;

create trigger assertions_preserve_superseded_history
before update or delete on assertions
for each row execute function dialektik_preserve_superseded_assertion();

create function dialektik_validate_evaluation_supersession()
returns trigger
language plpgsql
as $$
declare
  prior user_evaluations%rowtype;
begin
  if new.supersedes_id is null then
    return new;
  end if;
  select * into prior from user_evaluations where id = new.supersedes_id;
  if prior.id is null then
    return new;
  end if;
  if prior.assertion_id <> new.assertion_id or prior.user_id <> new.user_id then
    raise exception using
      errcode = '23514',
      message = 'evaluation supersession must preserve assertion and user';
  end if;
  return new;
end;
$$;

create trigger user_evaluations_validate_supersession
before insert on user_evaluations
for each row execute function dialektik_validate_evaluation_supersession();

create function dialektik_validate_article_syndication()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('dialektik:article-syndication', 0)
  );
  if new.syndication_of is null then
    return new;
  end if;
  if new.syndication_of = new.id then
    raise exception using
      errcode = '23514',
      message = 'article cannot syndicate itself';
  end if;
  if exists (
    with recursive ancestors(id, path) as (
      select a.id, array[a.id::text]
      from articles a
      where a.id = new.syndication_of
      union all
      select a.syndication_of, ancestors.path || a.syndication_of::text
      from articles a
      join ancestors on a.id = ancestors.id
      where a.syndication_of is not null
        and not a.syndication_of::text = any(ancestors.path)
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'article syndication must be acyclic';
  end if;
  return new;
end;
$$;

create trigger articles_syndication_acyclic
before insert or update of id, syndication_of on articles
for each row execute function dialektik_validate_article_syndication();

create function dialektik_validate_primary_fact_source()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from sources
    where id = new.primary_source_id and is_issuing_entity
  ) then
    raise exception using
      errcode = '23514',
      message = 'primary fact requires an issuing source';
  end if;
  return new;
end;
$$;

create trigger primary_facts_issuing_source
before insert or update of primary_source_id on primary_facts
for each row execute function dialektik_validate_primary_fact_source();

create function dialektik_preserve_primary_fact_source()
returns trigger
language plpgsql
as $$
begin
  if old.is_issuing_entity and not new.is_issuing_entity
    and exists (select 1 from primary_facts where primary_source_id = new.id) then
    raise exception using
      errcode = '23514',
      message = 'source is referenced by a primary fact as its issuing entity';
  end if;
  return new;
end;
$$;

create trigger sources_preserve_primary_fact_issuer
before update of is_issuing_entity on sources
for each row execute function dialektik_preserve_primary_fact_source();

create function dialektik_validate_evidence_scope()
returns trigger
language plpgsql
as $$
begin
  if new.scope_assertion_id is not null and not exists (
    select 1 from assertions
    where id = new.scope_assertion_id
      and claim_span_id = new.anchor_span_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'evidence scope assertion must belong to its anchor span';
  end if;
  return new;
end;
$$;

create trigger evidence_scope_matches_anchor
before insert or update of anchor_span_id, scope_assertion_id on evidence
for each row execute function dialektik_validate_evidence_scope();

create function dialektik_preserve_evidence_scope()
returns trigger
language plpgsql
as $$
begin
  if new.claim_span_id is distinct from old.claim_span_id and exists (
    select 1 from evidence
    where scope_assertion_id = new.id and anchor_span_id <> new.claim_span_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'assertion move would invalidate evidence scope';
  end if;
  return new;
end;
$$;

create trigger assertions_preserve_evidence_scope
before update of claim_span_id on assertions
for each row execute function dialektik_preserve_evidence_scope();

create function dialektik_validate_event_publication()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from events event_row
    where (event_row.analysis_state = 'PUBLISHED') is distinct from exists (
      select 1
      from positions position_row
      where position_row.event_id = event_row.id
        and position_row.publication_state = 'published'
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'event publication must exactly match published position existence';
  end if;
  return null;
end;
$$;

create constraint trigger events_publication_matches_positions
after insert or update of analysis_state or delete on events
deferrable initially deferred
for each row execute function dialektik_validate_event_publication();
create constraint trigger positions_publication_matches_event
after insert or update of event_id, publication_state or delete on positions
deferrable initially deferred
for each row execute function dialektik_validate_event_publication();

create function dialektik_validate_position_formation()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from positions position_row
    where not exists (
      select 1
      from position_formed_by formation
      join relationships relationship_row on relationship_row.id = formation.relationship_id
      where formation.position_id = position_row.id
        and relationship_row.rel_type = 'R01a'
        and relationship_row.publication_state = 'published'
        and relationship_row.event_id = position_row.event_id
        and (
          select count(*)
          from relationship_endpoints endpoint
          where endpoint.relationship_id = relationship_row.id
            and exists (
              select 1
              from assertions assertion_row
              where assertion_row.id = endpoint.assertion_id
                and assertion_row.position_id = position_row.id
            )
        ) >= 2
    )
    or exists (
      select 1
      from position_formed_by formation
      join relationships relationship_row on relationship_row.id = formation.relationship_id
      where formation.position_id = position_row.id
        and (
          relationship_row.rel_type <> 'R01a'
          or relationship_row.publication_state <> 'published'
          or relationship_row.event_id <> position_row.event_id
          or exists (
            select 1
            from relationship_endpoints endpoint
            join assertions assertion_row on assertion_row.id = endpoint.assertion_id
            where endpoint.relationship_id = relationship_row.id
              and assertion_row.position_id is distinct from position_row.id
          )
        )
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'position requires non-empty published human R01a formation';
  end if;
  return null;
end;
$$;

create constraint trigger positions_have_valid_formation
after insert or update of event_id or delete on positions
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();
create constraint trigger position_formed_by_remains_valid
after insert or update or delete on position_formed_by
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();
create constraint trigger forming_relationships_remain_valid
after update of rel_type, event_id, publication_state or delete on relationships
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();
create constraint trigger forming_endpoints_remain_valid
after insert or update or delete on relationship_endpoints
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();
create constraint trigger forming_assertions_remain_valid
after update of position_id or delete on assertions
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();

create function dialektik_prevent_published_rank_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null
    and new.neutral_rank is distinct from old.neutral_rank then
    raise exception using
      errcode = '55000',
      message = 'published position neutral rank is immutable';
  end if;
  if old.published_at is not null and (
    new.published_at is distinct from old.published_at
    or new.published_by is distinct from old.published_by
  ) then
    raise exception using
      errcode = '55000',
      message = 'position publication metadata is immutable history';
  end if;
  return new;
end;
$$;

create trigger positions_published_rank_immutable
before update on positions
for each row execute function dialektik_prevent_published_rank_mutation();

create function dialektik_validate_r05_comparability()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from relationships relationship_row
    join relationship_endpoints endpoint_a
      on endpoint_a.relationship_id = relationship_row.id
    join relationship_endpoints endpoint_b
      on endpoint_b.relationship_id = relationship_row.id
      and endpoint_a.assertion_id < endpoint_b.assertion_id
    join assertions assertion_a on assertion_a.id = endpoint_a.assertion_id
    join assertions assertion_b on assertion_b.id = endpoint_b.assertion_id
    where relationship_row.rel_type = 'R05'
      and (
        assertion_a.comparison_base is distinct from assertion_b.comparison_base
        or (
          assertion_a.assertion_type = 'temporal_sequence'
          and assertion_b.assertion_type = 'causal_claim'
        )
        or (
          assertion_a.assertion_type = 'causal_claim'
          and assertion_b.assertion_type = 'temporal_sequence'
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'R05 endpoints must have compatible comparison bases';
  end if;
  return null;
end;
$$;

create constraint trigger relationships_r05_comparable
after insert or update of rel_type on relationships
deferrable initially deferred
for each row execute function dialektik_validate_r05_comparability();
create constraint trigger relationship_endpoints_r05_comparable
after insert or update or delete on relationship_endpoints
deferrable initially deferred
for each row execute function dialektik_validate_r05_comparability();
create constraint trigger assertions_r05_comparable
after update of comparison_base, assertion_type on assertions
deferrable initially deferred
for each row execute function dialektik_validate_r05_comparability();

create function dialektik_validate_contradiction_positions()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from positions position_a
    join positions position_b on position_b.id = new.position_b_id
    where position_a.id = new.position_a_id
      and position_a.event_id = new.event_id
      and position_b.event_id = new.event_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'contradiction publication positions must belong to its event';
  end if;
  return new;
end;
$$;

create trigger contradiction_publications_event_positions
before insert or update of event_id, position_a_id, position_b_id
on contradiction_publications
for each row execute function dialektik_validate_contradiction_positions();

create function dialektik_validate_all_contradiction_positions()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from contradiction_publications publication
    join positions position_a on position_a.id = publication.position_a_id
    join positions position_b on position_b.id = publication.position_b_id
    where position_a.event_id <> publication.event_id
      or position_b.event_id <> publication.event_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'position move would invalidate contradiction publication event';
  end if;
  return null;
end;
$$;

create constraint trigger positions_preserve_contradiction_event
after update on positions
deferrable initially deferred
for each row execute function dialektik_validate_all_contradiction_positions();

create function dialektik_preserve_contradiction_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.event_id is distinct from old.event_id
    or new.position_a_id is distinct from old.position_a_id
    or new.position_b_id is distinct from old.position_b_id
    or new.projection_hash is distinct from old.projection_hash
    or new.ratio_conflicting_at_publication is distinct from old.ratio_conflicting_at_publication
    or new.ratio_comparable_at_publication is distinct from old.ratio_comparable_at_publication
    or new.threshold_rule_at_publication is distinct from old.threshold_rule_at_publication
    or new.confirmed_by is distinct from old.confirmed_by
    or new.confirmed_at is distinct from old.confirmed_at then
    raise exception using
      errcode = '55000',
      message = 'contradiction publication snapshot is immutable history';
  end if;
  if old.publication_state = 'retracted' and (
    new.publication_state is distinct from old.publication_state
    or new.retracted_by is distinct from old.retracted_by
    or new.retracted_at is distinct from old.retracted_at
    or new.retraction_reason is distinct from old.retraction_reason
  ) then
    raise exception using
      errcode = '55000',
      message = 'contradiction retraction is terminal immutable history';
  end if;
  return new;
end;
$$;

create trigger contradiction_publications_snapshot_immutable
before update on contradiction_publications
for each row execute function dialektik_preserve_contradiction_snapshot();

create function dialektik_validate_tombstone_links()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from positions position_row
    where position_row.tombstone_id is not null
      and not exists (
        select 1 from position_tombstones tombstone
        where tombstone.id = position_row.tombstone_id
          and tombstone.position_id = position_row.id
      )
  ) or exists (
    select 1 from position_tombstones tombstone
    where not exists (
      select 1 from positions position_row
      where position_row.id = tombstone.position_id
        and position_row.tombstone_id = tombstone.id
    )
  ) or exists (
    select 1 from position_tombstones tombstone
    where not exists (
      select 1 from position_tombstone_successors successor
      where successor.tombstone_id = tombstone.id
    )
  ) or exists (
    select 1
    from position_tombstone_successors successor
    join position_tombstones tombstone on tombstone.id = successor.tombstone_id
    where successor.successor_position_id = tombstone.position_id
  ) or exists (
    select 1 from claim_spans span_row
    where span_row.tombstone_id is not null
      and not exists (
        select 1 from span_tombstones tombstone
        where tombstone.id = span_row.tombstone_id
          and tombstone.span_id = span_row.id
      )
  ) or exists (
    select 1 from span_tombstones tombstone
    where not exists (
      select 1 from claim_spans span_row
      where span_row.id = tombstone.span_id
        and span_row.tombstone_id = tombstone.id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'tombstone links must be reciprocal and preserve distinct successors';
  end if;
  return null;
end;
$$;

create constraint trigger positions_tombstone_links
after insert or update of tombstone_id or delete on positions
deferrable initially deferred
for each row execute function dialektik_validate_tombstone_links();
create constraint trigger position_tombstones_links
after insert or update or delete on position_tombstones
deferrable initially deferred
for each row execute function dialektik_validate_tombstone_links();
create constraint trigger position_tombstone_successors_links
after insert or update or delete on position_tombstone_successors
deferrable initially deferred
for each row execute function dialektik_validate_tombstone_links();
create constraint trigger claim_spans_tombstone_links
after insert or update of tombstone_id or delete on claim_spans
deferrable initially deferred
for each row execute function dialektik_validate_tombstone_links();
create constraint trigger span_tombstones_links
after insert or update or delete on span_tombstones
deferrable initially deferred
for each row execute function dialektik_validate_tombstone_links();

create function dialektik_prevent_historical_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '55000',
    message = tg_table_name || ' is retained historical data';
end;
$$;

create trigger claim_spans_history_no_delete
before delete on claim_spans
for each row execute function dialektik_prevent_historical_mutation();
create trigger positions_history_no_delete
before delete on positions
for each row execute function dialektik_prevent_historical_mutation();
create trigger contradiction_publications_history_no_delete
before delete on contradiction_publications
for each row execute function dialektik_prevent_historical_mutation();
create trigger position_tombstones_history_immutable
before update or delete on position_tombstones
for each row execute function dialektik_prevent_historical_mutation();
create trigger position_tombstone_successors_history_immutable
before update or delete on position_tombstone_successors
for each row execute function dialektik_prevent_historical_mutation();
create trigger span_tombstones_history_immutable
before update or delete on span_tombstones
for each row execute function dialektik_prevent_historical_mutation();
`;

export const initialSchemaMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(INITIAL_SCHEMA_SQL).execute(database);
  },
};
