import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
create type shadow_semantic_decision as enum ('MATCH', 'DISTINCT', 'UNKNOWN');
create type shadow_semantic_applicability as enum ('APPLICABLE', 'INAPPLICABLE', 'UNKNOWN_APPLICABILITY');
create table semantic_event_threads (
  id dialektik_ulid primary key,
  title text not null check (length(title) between 1 and 300),
  summary text not null check (length(summary) between 1 and 2000),
  mode text not null default 'fixture' check (mode = 'fixture'),
  created_at timestamptz(3) not null
);
create table semantic_occurrences (
  id dialektik_ulid primary key,
  event_id dialektik_ulid not null unique references events(id),
  thread_id dialektik_ulid not null references semantic_event_threads(id),
  title text not null check (length(title) between 1 and 300),
  event_at timestamptz(3) not null,
  created_at timestamptz(3) not null,
  unique (id, thread_id)
);
create table semantic_observations (
  id dialektik_ulid primary key,
  provider text not null check (provider = 'fixture'),
  provider_version text not null check (length(provider_version) between 1 and 100),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  article_id dialektik_ulid not null references articles(id),
  occurrence_id dialektik_ulid not null,
  thread_id dialektik_ulid not null,
  decision shadow_semantic_decision not null,
  applicability shadow_semantic_applicability not null,
  rationale text not null check (length(rationale) between 1 and 2000),
  observed_at timestamptz(3) not null,
  foreign key (occurrence_id, thread_id) references semantic_occurrences(id, thread_id),
  unique (provider, provider_version, idempotency_key),
  unique (id, article_id, occurrence_id, thread_id, decision, applicability)
);
create table semantic_memberships (
  id dialektik_ulid primary key,
  observation_id dialektik_ulid not null unique,
  article_id dialektik_ulid not null,
  occurrence_id dialektik_ulid not null,
  thread_id dialektik_ulid not null,
  decision shadow_semantic_decision not null,
  applicability shadow_semantic_applicability not null,
  observed_at timestamptz(3) not null,
  foreign key (observation_id, article_id, occurrence_id, thread_id, decision, applicability)
    references semantic_observations(id, article_id, occurrence_id, thread_id, decision, applicability)
);
create table semantic_provenance (
  id dialektik_ulid primary key,
  observation_id dialektik_ulid not null unique references semantic_observations(id),
  article_id dialektik_ulid not null references articles(id),
  source_id dialektik_ulid not null references sources(id),
  span_id dialektik_ulid references claim_spans(id),
  assertion_id dialektik_ulid references assertions(id),
  check (assertion_id is null or span_id is not null)
);
create table semantic_occurrence_states (
  id dialektik_ulid primary key,
  occurrence_id dialektik_ulid not null references semantic_occurrences(id),
  revision integer not null check (revision > 0),
  previous_state_id dialektik_ulid unique,
  description text not null check (length(description) between 1 and 500),
  decision shadow_semantic_decision not null,
  applicability shadow_semantic_applicability not null,
  observation_id dialektik_ulid not null unique references semantic_observations(id),
  observed_at timestamptz(3) not null,
  unique (occurrence_id, revision), unique (occurrence_id, id),
  foreign key (occurrence_id, previous_state_id) references semantic_occurrence_states(occurrence_id, id)
);
create table semantic_thread_states (
  id dialektik_ulid primary key,
  thread_id dialektik_ulid not null references semantic_event_threads(id),
  revision integer not null check (revision > 0),
  previous_state_id dialektik_ulid unique,
  description text not null check (length(description) between 1 and 500),
  decision shadow_semantic_decision not null,
  applicability shadow_semantic_applicability not null,
  observation_id dialektik_ulid not null unique references semantic_observations(id),
  observed_at timestamptz(3) not null,
  unique (thread_id, revision), unique (thread_id, id),
  foreign key (thread_id, previous_state_id) references semantic_thread_states(thread_id, id)
);
create table semantic_relations (
  id dialektik_ulid primary key,
  observation_id dialektik_ulid not null unique references semantic_observations(id),
  from_occurrence_id dialektik_ulid not null references semantic_occurrences(id),
  to_occurrence_id dialektik_ulid not null references semantic_occurrences(id),
  decision shadow_semantic_decision not null,
  applicability shadow_semantic_applicability not null,
  check (from_occurrence_id <> to_occurrence_id)
);
create table semantic_state_transitions (
  id dialektik_ulid primary key,
  entity_kind text not null check (entity_kind in ('occurrence', 'thread')),
  occurrence_state_id dialektik_ulid unique references semantic_occurrence_states(id),
  thread_state_id dialektik_ulid unique references semantic_thread_states(id),
  observation_id dialektik_ulid not null references semantic_observations(id),
  observed_at timestamptz(3) not null,
  unique (entity_kind, observation_id),
  check (
    (entity_kind = 'occurrence' and occurrence_state_id is not null and thread_state_id is null)
    or (entity_kind = 'thread' and thread_state_id is not null and occurrence_state_id is null)
  )
);
create index idx_shadow_occurrence_thread on semantic_occurrences(thread_id, event_at, id);
create index idx_shadow_observation_article on semantic_observations(article_id, observed_at, id);
create index idx_shadow_membership_occurrence on semantic_memberships(occurrence_id, observed_at, id);
create index idx_shadow_membership_thread on semantic_memberships(thread_id, observed_at, id);
create index idx_shadow_relation_to on semantic_relations(to_occurrence_id);

create function shadow_semantic_history_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'semantic shadow records are append-only' using errcode = '23514';
end; $$;
do $$ declare table_name text;
begin
  foreach table_name in array array[
    'semantic_event_threads', 'semantic_occurrences', 'semantic_observations',
    'semantic_memberships', 'semantic_provenance', 'semantic_occurrence_states',
    'semantic_thread_states', 'semantic_relations', 'semantic_state_transitions'
  ] loop
    execute format('create trigger shadow_history_immutable before update or delete on %I
      for each row execute function shadow_semantic_history_immutable()', table_name);
  end loop;
end; $$;
create function shadow_semantic_state_chain() returns trigger language plpgsql as $$
declare previous_id dialektik_ulid; previous_revision integer; previous_time timestamptz;
begin
  if tg_table_name = 'semantic_occurrence_states' then
    perform 1 from semantic_occurrences where id = new.occurrence_id for update;
    select id, revision, observed_at into previous_id, previous_revision, previous_time
      from semantic_occurrence_states where occurrence_id = new.occurrence_id order by revision desc limit 1;
    if not exists (select 1 from semantic_observations where id = new.observation_id
      and occurrence_id = new.occurrence_id and observed_at = new.observed_at
      and decision = new.decision and applicability = new.applicability) then
      raise exception 'occurrence state must match its causing observation' using errcode = '23514';
    end if;
  else
    perform 1 from semantic_event_threads where id = new.thread_id for update;
    select id, revision, observed_at into previous_id, previous_revision, previous_time
      from semantic_thread_states where thread_id = new.thread_id order by revision desc limit 1;
    if not exists (select 1 from semantic_observations where id = new.observation_id
      and thread_id = new.thread_id and observed_at = new.observed_at) then
      raise exception 'thread state must match its causing observation' using errcode = '23514';
    end if;
  end if;
  if new.revision <> coalesce(previous_revision, 0) + 1
    or new.previous_state_id is distinct from previous_id
    or new.observed_at < previous_time then
    raise exception 'semantic state history must be linear and ordered' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger shadow_occurrence_state_chain before insert on semantic_occurrence_states
  for each row execute function shadow_semantic_state_chain();
create trigger shadow_thread_state_chain before insert on semantic_thread_states
  for each row execute function shadow_semantic_state_chain();

create function shadow_semantic_linkage() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'semantic_observations' then
    if not exists (select 1 from articles where id = new.article_id
      and url_canonical like 'https://%.dialektik.invalid/%'
      and position('DEMOSTRACIÓN SINTÉTICA' in text_original) > 0) then
      raise exception 'fixture observation requires a synthetic development Article' using errcode = '23514';
    end if;
  elsif tg_table_name = 'semantic_provenance' then
    if not exists (select 1 from semantic_observations o join articles a on a.id = o.article_id
      where o.id = new.observation_id and a.id = new.article_id and a.source_id = new.source_id)
      or (new.span_id is not null and not exists (
        select 1 from claim_spans where id = new.span_id and article_id = new.article_id))
      or (new.assertion_id is not null and not exists (
        select 1 from assertions where id = new.assertion_id and claim_span_id = new.span_id)) then
      raise exception 'semantic provenance must preserve exact Article/Source/Span/Assertion linkage' using errcode = '23514';
    end if;
  elsif tg_table_name = 'semantic_relations' then
    if not exists (select 1 from semantic_observations where id = new.observation_id
      and occurrence_id = new.from_occurrence_id) then
      raise exception 'semantic relation must reference its causing observation' using errcode = '23514';
    end if;
  elsif tg_table_name = 'semantic_state_transitions' then
    if (new.entity_kind = 'occurrence' and not exists (
      select 1 from semantic_occurrence_states where id = new.occurrence_state_id
        and observation_id = new.observation_id and observed_at = new.observed_at))
      or (new.entity_kind = 'thread' and not exists (
      select 1 from semantic_thread_states where id = new.thread_state_id
        and observation_id = new.observation_id and observed_at = new.observed_at)) then
      raise exception 'transition must reference its exact new state and observation' using errcode = '23514';
    end if;
  elsif tg_table_name = 'semantic_memberships' then
    if not exists (select 1 from semantic_observations where id = new.observation_id
      and observed_at = new.observed_at) then
      raise exception 'membership time must match its observation' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger shadow_observation_linkage before insert on semantic_observations
  for each row execute function shadow_semantic_linkage();
create trigger shadow_provenance_linkage before insert on semantic_provenance
  for each row execute function shadow_semantic_linkage();
create trigger shadow_relation_linkage before insert on semantic_relations
  for each row execute function shadow_semantic_linkage();
create trigger shadow_transition_linkage before insert on semantic_state_transitions
  for each row execute function shadow_semantic_linkage();
create trigger shadow_membership_linkage before insert on semantic_memberships
  for each row execute function shadow_semantic_linkage();
create function shadow_semantic_complete_observation() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from semantic_memberships where observation_id = new.id)
    or not exists (select 1 from semantic_provenance where observation_id = new.id)
    or (select count(*) from semantic_state_transitions where observation_id = new.id) <> 2 then
    raise exception 'observation requires membership, provenance and both state transitions in one transaction'
      using errcode = '23514';
  end if;
  return null;
end; $$;
create constraint trigger shadow_complete_observation after insert on semantic_observations
  deferrable initially deferred for each row execute function shadow_semantic_complete_observation();
`;
export const productSemanticShadowMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
};
