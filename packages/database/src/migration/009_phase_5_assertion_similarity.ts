import { sql, type Migration } from 'kysely';

/**
 * Provider-free Phase 5 run provenance. The accepted input-provenance values
 * intentionally exclude production Phase-4 output until that phase closes.
 */
const PHASE_5_ASSERTION_SIMILARITY_SQL = String.raw`
create type assertion_similarity_input_provenance as enum (
  'fixture_contract',
  'human_authored_contract'
);

create table assertion_similarity_runs (
  id dialektik_ulid primary key,
  event_id dialektik_ulid not null references events(id),
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  input_provenance assertion_similarity_input_provenance not null,
  embedding_provider_id text not null check (btrim(embedding_provider_id) <> ''),
  embedding_model_id text not null check (btrim(embedding_model_id) <> ''),
  embedding_model_version text not null check (btrim(embedding_model_version) <> ''),
  similarity_policy_version text not null check (btrim(similarity_policy_version) <> ''),
  candidate_policy_version text not null check (btrim(candidate_policy_version) <> ''),
  similarity_threshold similarity_score not null,
  relation_confidence relation_confidence not null,
  interpretation_count integer not null check (interpretation_count >= 2),
  relationship_count integer not null check (relationship_count >= 0),
  candidate_class_count integer not null check (candidate_class_count >= 0),
  created_at timestamptz(3) not null,
  constraint assertion_similarity_runs_identity_unique unique (
    event_id,
    input_fingerprint,
    input_provenance,
    embedding_provider_id,
    embedding_model_id,
    embedding_model_version,
    similarity_policy_version,
    candidate_policy_version,
    similarity_threshold,
    relation_confidence
  )
);

create table assertion_similarity_run_relationships (
  run_id dialektik_ulid not null references assertion_similarity_runs(id),
  relationship_id dialektik_ulid not null unique references relationships(id),
  primary key (run_id, relationship_id)
);

create table assertion_similarity_run_candidate_classes (
  run_id dialektik_ulid not null references assertion_similarity_runs(id),
  candidate_class_id dialektik_ulid not null unique references candidate_classes(id),
  primary key (run_id, candidate_class_id)
);

create index idx_assertion_similarity_runs_event_created
  on assertion_similarity_runs (event_id, created_at desc, id);

create function dialektik_assert_phase5_similarity_run_integrity()
returns void
language plpgsql
as $$
begin
  if exists (
    select 1
    from assertion_similarity_run_relationships link
    join assertion_similarity_runs run on run.id = link.run_id
    join relationships relationship on relationship.id = link.relationship_id
    where relationship.event_id <> run.event_id
      or relationship.rel_type <> 'R01b'
      or relationship.publication_state <> 'proposed'
      or relationship.similarity_score is null
      or relationship.confidence is null
      or relationship.declared_by is not null
      or relationship.confirmed_by is not null
      or relationship.confirmed_at is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 run may link only same-Event unconfirmed proposed R01b';
  end if;

  if exists (
    select 1
    from assertion_similarity_run_candidate_classes link
    join assertion_similarity_runs run on run.id = link.run_id
    join candidate_classes candidate on candidate.id = link.candidate_class_id
    where candidate.event_id <> run.event_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 run CandidateClass must belong to the same Event';
  end if;

  if exists (
    select 1
    from assertion_similarity_runs run
    where run.relationship_count <> (
      select count(*) from assertion_similarity_run_relationships link
      where link.run_id = run.id
    )
      or run.candidate_class_count <> (
        select count(*) from assertion_similarity_run_candidate_classes link
        where link.run_id = run.id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 run counts must match its normalized links';
  end if;

  if exists (
    select 1
    from assertion_similarity_run_candidate_classes link
    where (select count(*) from candidate_class_members member
           where member.candidate_class_id = link.candidate_class_id) < 2
      or not exists (
        select 1 from moderation_tasks task
        where task.target_type = 'CandidateClass'
          and task.target_id = link.candidate_class_id
          and task.task_type = 'equivalence_review'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 CandidateClass requires members and an equivalence-review task';
  end if;
end;
$$;

create function dialektik_validate_phase5_similarity_run_integrity()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_phase5_similarity_run_integrity();
  return null;
end;
$$;

create constraint trigger assertion_similarity_runs_integrity
after insert on assertion_similarity_runs
deferrable initially deferred
for each row execute function dialektik_validate_phase5_similarity_run_integrity();

create constraint trigger assertion_similarity_run_relationships_integrity
after insert or update or delete on assertion_similarity_run_relationships
deferrable initially deferred
for each row execute function dialektik_validate_phase5_similarity_run_integrity();

create constraint trigger assertion_similarity_run_candidate_classes_integrity
after insert or update or delete on assertion_similarity_run_candidate_classes
deferrable initially deferred
for each row execute function dialektik_validate_phase5_similarity_run_integrity();

create constraint trigger assertion_similarity_candidate_members_integrity
after insert or update or delete on candidate_class_members
deferrable initially deferred
for each row execute function dialektik_validate_phase5_similarity_run_integrity();

create constraint trigger assertion_similarity_moderation_tasks_integrity
after insert or update or delete on moderation_tasks
deferrable initially deferred
for each row execute function dialektik_validate_phase5_similarity_run_integrity();

create constraint trigger assertion_similarity_relationships_integrity
after update or delete on relationships
deferrable initially deferred
for each row execute function dialektik_validate_phase5_similarity_run_integrity();

create function dialektik_reject_phase5_similarity_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'Phase 5 assertion-similarity run history is append-only';
end;
$$;

create trigger assertion_similarity_runs_immutable
before update or delete on assertion_similarity_runs
for each row execute function dialektik_reject_phase5_similarity_history_mutation();

create trigger assertion_similarity_run_relationships_immutable
before update or delete on assertion_similarity_run_relationships
for each row execute function dialektik_reject_phase5_similarity_history_mutation();

create trigger assertion_similarity_run_candidate_classes_immutable
before update or delete on assertion_similarity_run_candidate_classes
for each row execute function dialektik_reject_phase5_similarity_history_mutation();
`;

export const phase5AssertionSimilarityMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_5_ASSERTION_SIMILARITY_SQL).execute(database);
  },
};
