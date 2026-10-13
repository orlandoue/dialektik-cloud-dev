import { sql, type Migration } from 'kysely';

const PRECONDITION_SQL = String.raw`
do $$
begin
  if exists (
    select 1 from categories
    where id in (
      '00000000000000000000000001',
      '00000000000000000000000002',
      '00000000000000000000000003',
      '00000000000000000000000004',
      '00000000000000000000000005',
      '00000000000000000000000006',
      '00000000000000000000000007'
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 1C deterministic Category seed identity collides with a legacy row';
  end if;
  if exists (select 1 from evidence where scope_assertion_id is null) then
    raise exception using
      errcode = '23514',
      message = 'Phase 1C requires explicit Assertion scope for every legacy Evidence row';
  end if;
  if exists (select 1 from relationships where rel_type = 'R01b') then
    raise exception using
      errcode = '23514',
      message = 'Phase 1C cannot reinterpret legacy numeric Relationship confidence as SimilarityScore';
  end if;
  if exists (
    select 1 from audit_entries
    where actor_type not in ('user', 'moderator', 'editor', 'system', 'auditor')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 1C cannot map an unknown legacy AuditEntry actor type';
  end if;
  if exists (
    select 1
    from audit_entries audit_row
    join users actor on actor.id = audit_row.actor_id
    where audit_row.actor_type <> actor.role::text
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 1C cannot preserve a legacy AuditEntry whose actor type disagrees with its user role';
  end if;
end;
$$;
`;

const CLOSURE_SCHEMA_SQL = String.raw`
create extension if not exists pgcrypto;

create type assertion_lifecycle_state as enum ('active', 'invalidated', 'withdrawn');
create type position_lifecycle_status as enum ('active', 'merged', 'split', 'withdrawn');
create type topic_status as enum ('active', 'merged', 'archived');
create type relation_confidence as enum ('low', 'medium', 'high');
create type syndication_confidence as enum ('low', 'medium', 'high');
create type candidate_class_state as enum (
  'proposed',
  'partially_accepted',
  'accepted',
  'rejected',
  'superseded'
);
create type evidence_assessment_value as enum ('inconclusive');
create type projection_outcome as enum (
  'non_comparable',
  'no_confirmed_conflict',
  'conflict_present'
);
create type moderation_target_type as enum (
  'Event',
  'Position',
  'CandidateClass',
  'PositionRelationProjection'
);
create type audit_actor_type as enum ('user', 'moderator', 'editor', 'system', 'auditor');
create type audit_action_type as enum (
  'created',
  'metadata_updated',
  'confirmed',
  'dismissed',
  'published',
  'retracted',
  'merged',
  'split',
  'superseded',
  'invalidated',
  'membership_changed',
  'relationship_reclassified',
  'evidence_published',
  'evaluation_superseded',
  'moderation_decision',
  'withdrawn',
  'requires_review'
);

alter table categories
  add column slug text,
  add column sort_order integer,
  add column is_active boolean,
  add column created_at timestamptz(3);

with legacy_category as (
  select id, row_number() over (order by id) as ordinal
  from categories
)
update categories category_row
set
  slug = 'legacy-' || lower(category_row.id::text),
  sort_order = 100000 + legacy_category.ordinal,
  is_active = false,
  created_at = transaction_timestamp()
from legacy_category
where legacy_category.id = category_row.id;

alter table categories
  alter column slug set not null,
  alter column sort_order set not null,
  alter column is_active set not null,
  alter column created_at set not null,
  add constraint categories_slug_present check (btrim(slug) <> ''),
  add constraint categories_slug_unique unique (slug);

create table category_localizations (
  category_id dialektik_ulid not null references categories(id),
  locale text not null check (btrim(locale) <> ''),
  name text not null check (btrim(name) <> ''),
  primary key (category_id, locale)
);

insert into categories (id, slug, sort_order, is_active, created_at) values
  ('00000000000000000000000001', 'pais', 1, true, '2026-09-09T00:00:00.000Z'),
  ('00000000000000000000000002', 'politica', 2, true, '2026-09-09T00:00:00.000Z'),
  ('00000000000000000000000003', 'internacional', 3, true, '2026-09-09T00:00:00.000Z'),
  ('00000000000000000000000004', 'deportes', 4, true, '2026-09-09T00:00:00.000Z'),
  ('00000000000000000000000005', 'ciencia', 5, true, '2026-09-09T00:00:00.000Z'),
  ('00000000000000000000000006', 'tecnologia', 6, true, '2026-09-09T00:00:00.000Z'),
  ('00000000000000000000000007', 'economia', 7, true, '2026-09-09T00:00:00.000Z');

alter table topics
  add column canonical_slug text,
  add column canonical_name text,
  add column status topic_status,
  add column merged_into_id dialektik_ulid references topics(id),
  add column created_at timestamptz(3);

update topics topic_row
set
  canonical_slug = 'legacy-' || lower(topic_row.id::text),
  canonical_name = topic_row.id::text,
  status = 'active',
  created_at = transaction_timestamp();

alter table topics
  alter column canonical_slug set not null,
  alter column canonical_name set not null,
  alter column status set not null,
  alter column created_at set not null,
  add constraint topics_canonical_slug_present check (btrim(canonical_slug) <> ''),
  add constraint topics_canonical_name_present check (btrim(canonical_name) <> ''),
  add constraint topics_canonical_slug_unique unique (canonical_slug),
  add constraint topics_merge_coherent check (
    (status = 'merged' and merged_into_id is not null and merged_into_id <> id)
    or (status <> 'merged' and merged_into_id is null)
  );

alter table event_topics drop constraint event_topics_pkey;
alter table event_topics
  add column id dialektik_ulid,
  add column valid_from timestamptz,
  add column valid_to timestamptz,
  add column reason_code text,
  add column actor_id dialektik_ulid references users(id),
  add column correlation_id dialektik_ulid,
  add column recorded_at timestamptz(3);

update event_topics membership
set
  id = '0' || upper(substr(encode(digest('event-topic:' || membership.event_id || ':' || membership.topic_id, 'sha256'), 'hex'), 2, 25)),
  valid_from = transaction_timestamp(),
  reason_code = 'phase_1c_migration',
  correlation_id = '0' || upper(substr(encode(digest('event-topic-correlation:' || membership.event_id || ':' || membership.topic_id, 'sha256'), 'hex'), 2, 25)),
  recorded_at = transaction_timestamp();

alter table event_topics
  alter column id set not null,
  alter column valid_from set not null,
  alter column reason_code set not null,
  alter column correlation_id set not null,
  alter column recorded_at set not null,
  add constraint event_topics_pkey primary key (id),
  add constraint event_topics_valid_interval check (valid_to is null or valid_to > valid_from),
  add constraint event_topics_reason_present check (btrim(reason_code) <> ''),
  add constraint event_topics_interval_identity unique (event_id, topic_id, valid_from);
create unique index event_topics_one_open_interval
  on event_topics (event_id, topic_id)
  where valid_to is null;
create index idx_event_topics_current
  on event_topics (event_id, topic_id)
  where valid_to is null;

alter table assertions
  add column lineage_root_id dialektik_ulid references assertions(id),
  add column lifecycle_state assertion_lifecycle_state not null default 'active';
alter table assertions disable trigger user;
with recursive lineage(id, root_id) as (
  select assertion_row.id, assertion_row.id
  from assertions assertion_row
  where assertion_row.supersedes_id is null
  union all
  select child.id, lineage.root_id
  from assertions child
  join lineage on lineage.id = child.supersedes_id
)
update assertions assertion_row
set lineage_root_id = lineage.root_id
from lineage
where lineage.id = assertion_row.id;
alter table assertions enable trigger user;
alter table assertions alter column lineage_root_id set not null;
create unique index assertions_one_successor
  on assertions (supersedes_id)
  where supersedes_id is not null;
create unique index assertions_lineage_version_unique
  on assertions (lineage_root_id, version);
create index idx_assertion_lineage_current
  on assertions (lineage_root_id, id)
  where lifecycle_state = 'active';

create table assertion_position_membership_history (
  id dialektik_ulid primary key,
  assertion_id dialektik_ulid not null references assertions(id),
  position_id dialektik_ulid references positions(id),
  valid_from timestamptz not null,
  valid_to timestamptz,
  reason_code text not null check (btrim(reason_code) <> ''),
  actor_id dialektik_ulid references users(id),
  correlation_id dialektik_ulid not null,
  recorded_at timestamptz(3) not null,
  constraint assertion_position_history_valid_interval check (
    valid_to is null or valid_to > valid_from
  )
);
create unique index assertion_position_history_one_open
  on assertion_position_membership_history (assertion_id)
  where valid_to is null;
create index idx_assertion_position_history_lookup
  on assertion_position_membership_history (assertion_id, valid_from, valid_to);

insert into assertion_position_membership_history (
  id,
  assertion_id,
  position_id,
  valid_from,
  valid_to,
  reason_code,
  actor_id,
  correlation_id,
  recorded_at
)
select
  '0' || upper(substr(encode(digest('assertion-position:' || assertion_row.id, 'sha256'), 'hex'), 2, 25)),
  assertion_row.id,
  assertion_row.position_id,
  transaction_timestamp(),
  null,
  'phase_1c_migration',
  null,
  '0' || upper(substr(encode(digest('assertion-position-correlation:' || assertion_row.id, 'sha256'), 'hex'), 2, 25)),
  transaction_timestamp()
from assertions assertion_row
where assertion_row.position_id is not null;

create unique index user_evaluations_one_root
  on user_evaluations (user_id, assertion_id)
  where supersedes_id is null;
create unique index user_evaluations_one_successor
  on user_evaluations (supersedes_id)
  where supersedes_id is not null;

alter table articles
  add column syndication_confidence syndication_confidence;

alter table relationships
  rename column confidence to legacy_numeric_confidence;
alter table relationships
  add column confidence relation_confidence,
  add column similarity_score similarity_score,
  add constraint relationships_similarity_score_type check (
    (rel_type = 'R01b' and similarity_score is not null)
    or (rel_type <> 'R01b' and similarity_score is null)
  );

alter table relationship_endpoints drop constraint relationship_endpoints_pkey;
alter table relationship_endpoints disable trigger user;
alter table relationship_endpoints
  drop constraint relationship_endpoints_relationship_id_assertion_id_key;
alter table relationship_endpoints add column endpoint_order smallint;
update relationship_endpoints
set endpoint_order = case role
  when 'peer_a' then 1
  when 'source' then 1
  when 'peer_b' then 2
  when 'target' then 2
end;
alter table relationship_endpoints alter column role type text using role::text;
drop type relationship_endpoint_role;
update relationship_endpoints set role = 'peer' where role in ('peer_a', 'peer_b');
create type relationship_endpoint_role as enum ('source', 'target', 'peer');
alter table relationship_endpoints
  alter column role type relationship_endpoint_role using role::relationship_endpoint_role,
  alter column endpoint_order set not null,
  add constraint relationship_endpoints_pkey primary key (relationship_id, assertion_id),
  add constraint relationship_endpoints_order_unique unique (relationship_id, endpoint_order),
  add constraint relationship_endpoints_order_exact check (endpoint_order in (1, 2));
alter table relationship_endpoints enable trigger user;

alter table evidence alter column scope_assertion_id set not null;
alter table evidence add column supersedes_id dialektik_ulid references evidence(id);
alter table evidence
  add constraint evidence_not_self_superseding check (
    supersedes_id is null or supersedes_id <> id
  );
create unique index evidence_one_successor
  on evidence (supersedes_id)
  where supersedes_id is not null;

create table evidence_assessments (
  id dialektik_ulid primary key,
  assertion_id dialektik_ulid not null references assertions(id),
  assessment evidence_assessment_value not null,
  rationale text,
  confirmed_by dialektik_ulid not null references users(id),
  confirmed_at timestamptz(3) not null,
  supersedes_id dialektik_ulid references evidence_assessments(id),
  created_at timestamptz(3) not null,
  constraint evidence_assessments_not_self_superseding check (
    supersedes_id is null or supersedes_id <> id
  )
);
create unique index evidence_assessments_one_root
  on evidence_assessments (assertion_id)
  where supersedes_id is null;
create unique index evidence_assessments_one_successor
  on evidence_assessments (supersedes_id)
  where supersedes_id is not null;

create table candidate_classes (
  id dialektik_ulid primary key,
  event_id dialektik_ulid not null references events(id),
  model_ref text not null check (btrim(model_ref) <> ''),
  model_version text not null check (btrim(model_version) <> ''),
  created_at timestamptz(3) not null,
  state candidate_class_state not null
);
create table candidate_class_members (
  candidate_class_id dialektik_ulid not null references candidate_classes(id),
  assertion_id dialektik_ulid not null references assertions(id),
  primary key (candidate_class_id, assertion_id)
);

alter table positions
  add column status position_lifecycle_status not null default 'active';
update positions position_row
set status = case tombstone.operation
  when 'split' then 'split'::position_lifecycle_status
  else 'merged'::position_lifecycle_status
end
from position_tombstones tombstone
where tombstone.position_id = position_row.id;

alter table moderation_tasks
  drop constraint moderation_tasks_unblocked_target_type,
  alter column target_id drop not null,
  alter column target_type type moderation_target_type using target_type::moderation_target_type,
  add column projection_event_id dialektik_ulid references events(id),
  add column projection_position_a_id dialektik_ulid references positions(id),
  add column projection_position_b_id dialektik_ulid references positions(id),
  add column projection_hash text,
  add constraint moderation_tasks_typed_target check (
    (
      target_type in ('Event', 'Position', 'CandidateClass')
      and target_id is not null
      and projection_event_id is null
      and projection_position_a_id is null
      and projection_position_b_id is null
      and projection_hash is null
    )
    or
    (
      target_type = 'PositionRelationProjection'
      and target_id is null
      and projection_event_id is not null
      and projection_position_a_id is not null
      and projection_position_b_id is not null
      and projection_position_a_id < projection_position_b_id
      and projection_hash is not null
      and btrim(projection_hash) <> ''
    )
  );
create index idx_task_projection_snapshot
  on moderation_tasks (
    projection_event_id,
    projection_position_a_id,
    projection_position_b_id,
    projection_hash
  )
  where target_type = 'PositionRelationProjection';

alter table audit_entries disable trigger user;
alter table audit_entries rename column action to legacy_action_type;
alter table audit_entries alter column actor_id drop not null;
alter table audit_entries alter column actor_type type audit_actor_type using actor_type::audit_actor_type;
alter table audit_entries
  add column action_type audit_action_type,
  add column correlation_id dialektik_ulid,
  add column reason_code text,
  add column before_hash text,
  add column after_hash text,
  add column metadata jsonb;

update audit_entries audit_row
set
  action_type = case
    when audit_row.legacy_action_type in (
      'created', 'metadata_updated', 'confirmed', 'dismissed', 'published',
      'retracted', 'merged', 'split', 'superseded', 'invalidated',
      'membership_changed', 'relationship_reclassified', 'evidence_published',
      'evaluation_superseded', 'moderation_decision', 'withdrawn', 'requires_review'
    ) then audit_row.legacy_action_type::audit_action_type
    else 'metadata_updated'::audit_action_type
  end,
  correlation_id = audit_row.id,
  reason_code = case
    when audit_row.legacy_action_type in (
      'created', 'metadata_updated', 'confirmed', 'dismissed', 'published',
      'retracted', 'merged', 'split', 'superseded', 'invalidated',
      'membership_changed', 'relationship_reclassified', 'evidence_published',
      'evaluation_superseded', 'moderation_decision', 'withdrawn', 'requires_review'
    ) then null
    else 'phase_1c_legacy_action'
  end,
  before_hash = case
    when audit_row.before is null then null
    else encode(digest(convert_to(audit_row.before::text, 'UTF8'), 'sha256'), 'hex')
  end,
  after_hash = case
    when audit_row.after is null then null
    else encode(digest(convert_to(audit_row.after::text, 'UTF8'), 'sha256'), 'hex')
  end,
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'legacy_action_type', audit_row.legacy_action_type,
    'legacy_before', audit_row.before,
    'legacy_after', audit_row.after
  ));

alter table audit_entries
  drop column legacy_action_type,
  drop column before,
  drop column after,
  alter column action_type set not null,
  alter column correlation_id set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  add constraint audit_entries_metadata_object check (jsonb_typeof(metadata) = 'object'),
  add constraint audit_entries_actor_identity check (
    actor_type = 'system' or actor_id is not null
  );
alter table audit_entries enable trigger user;
create index idx_audit_correlation on audit_entries (correlation_id, occurred_at, id);
create index idx_audit_entity on audit_entries (entity_type, entity_id, occurred_at);

insert into audit_entries (
  id,
  occurred_at,
  actor_type,
  actor_id,
  action_type,
  entity_type,
  entity_id,
  correlation_id,
  reason_code,
  before_hash,
  after_hash,
  metadata
)
select
  '0' || upper(substr(encode(digest('relationship-confidence:' || relationship_row.id, 'sha256'), 'hex'), 2, 25)),
  transaction_timestamp(),
  'system',
  null,
  'metadata_updated',
  'Relationship',
  relationship_row.id,
  '0' || upper(substr(encode(digest('relationship-confidence-correlation:' || relationship_row.id, 'sha256'), 'hex'), 2, 25)),
  'phase_1c_numeric_confidence_retired',
  null,
  null,
  jsonb_build_object('legacy_numeric_confidence', relationship_row.legacy_numeric_confidence)
from relationships relationship_row;

alter table relationships drop column legacy_numeric_confidence;
drop domain relationship_confidence;
`;

const AUDIT_COUPLING_SQL = String.raw`
create function dialektik_generate_ulid()
returns dialektik_ulid
language plpgsql
volatile
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  milliseconds bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  random_bits bit(80) := ('x' || encode(gen_random_bytes(10), 'hex'))::bit(80);
  result text := '';
  digit_index integer;
begin
  for digit_index in 1..10 loop
    result := result || substr(
      alphabet,
      ((milliseconds / power(32, 10 - digit_index)::bigint) % 32)::integer + 1,
      1
    );
  end loop;
  for digit_index in 0..15 loop
    result := result || substr(
      alphabet,
      (substring(random_bits from digit_index * 5 + 1 for 5)::integer) + 1,
      1
    );
  end loop;
  return result::dialektik_ulid;
end;
$$;

create function dialektik_set_audit_context(
  request_actor_type audit_actor_type,
  request_actor_id dialektik_ulid,
  request_correlation_id dialektik_ulid,
  request_action audit_action_type,
  request_reason_code text default null
)
returns void
language plpgsql
as $$
declare
  stored_role user_role;
begin
  if request_correlation_id is null then
    raise exception using
      errcode = '22004',
      message = 'audit correlation_id is required';
  end if;
  if request_actor_type <> 'system' and request_actor_id is null then
    raise exception using
      errcode = '22004',
      message = 'audit actor_id is required for a non-system actor';
  end if;
  if request_actor_id is not null then
    select role into stored_role from users where id = request_actor_id;
    if stored_role is null then
      raise exception using
        errcode = '23503',
        message = 'audit actor does not exist';
    end if;
    if stored_role::text <> request_actor_type::text then
      raise exception using
        errcode = '23514',
        message = 'audit actor type must match the stored user role';
    end if;
  end if;

  perform set_config('dialektik.actor_type', request_actor_type::text, true);
  perform set_config('dialektik.actor_id', coalesce(request_actor_id::text, ''), true);
  perform set_config('dialektik.correlation_id', request_correlation_id::text, true);
  perform set_config('dialektik.action_type', request_action::text, true);
  perform set_config('dialektik.reason_code', coalesce(request_reason_code, ''), true);
end;
$$;

create function dialektik_require_audit_context(allowed_actions audit_action_type[])
returns void
language plpgsql
as $$
declare
  context_actor_type text := current_setting('dialektik.actor_type', true);
  context_actor_id text := current_setting('dialektik.actor_id', true);
  context_correlation text := current_setting('dialektik.correlation_id', true);
  context_action text := current_setting('dialektik.action_type', true);
  stored_role user_role;
begin
  if nullif(context_actor_type, '') is null
    or nullif(context_correlation, '') is null
    or nullif(context_action, '') is null then
    raise exception using
      errcode = '55000',
      message = 'protected mutation requires transaction-local audit context';
  end if;
  if context_actor_type not in ('user', 'moderator', 'editor', 'system', 'auditor')
    or context_action::audit_action_type <> all(allowed_actions) then
    raise exception using
      errcode = '23514',
      message = 'audit context actor/action is not permitted for this mutation';
  end if;
  if context_actor_type = 'system'
    and context_action not in ('created', 'metadata_updated', 'requires_review') then
    raise exception using
      errcode = '42501',
      message = 'system actors cannot perform human-protected decisions';
  end if;
  if context_actor_type <> 'system' and nullif(context_actor_id, '') is null then
    raise exception using
      errcode = '22004',
      message = 'protected human mutation requires actor_id';
  end if;
  if nullif(context_actor_id, '') is not null then
    select role into stored_role from users where id = context_actor_id::dialektik_ulid;
    if stored_role is null or stored_role::text <> context_actor_type then
      raise exception using
        errcode = '23514',
        message = 'audit context actor no longer matches a stored user role';
    end if;
  end if;
end;
$$;

create function dialektik_require_context_actor(expected_actor dialektik_ulid)
returns void
language plpgsql
as $$
declare
  context_actor text := current_setting('dialektik.actor_id', true);
begin
  if expected_actor is not null
    and nullif(context_actor, '') is distinct from expected_actor::text then
    raise exception using
      errcode = '23514',
      message = 'domain actor must match transaction-local audit actor';
  end if;
end;
$$;

create function dialektik_require_human_audit_actor()
returns void
language plpgsql
as $$
begin
  if current_setting('dialektik.actor_type', true) = 'system'
    or nullif(current_setting('dialektik.actor_id', true), '') is null then
    raise exception using
      errcode = '42501',
      message = 'this protected mutation requires a human actor';
  end if;
end;
$$;

create function dialektik_emit_audit(
  audited_entity_type text,
  audited_entity_id text,
  before_value jsonb,
  after_value jsonb,
  allowed_actions audit_action_type[]
)
returns void
language plpgsql
as $$
declare
  context_actor_type audit_actor_type;
  context_actor_id dialektik_ulid;
  context_action audit_action_type;
  context_correlation dialektik_ulid;
  context_reason text;
begin
  perform dialektik_require_audit_context(allowed_actions);
  context_actor_type := current_setting('dialektik.actor_type')::audit_actor_type;
  context_actor_id := nullif(current_setting('dialektik.actor_id'), '')::dialektik_ulid;
  context_action := current_setting('dialektik.action_type')::audit_action_type;
  context_correlation := current_setting('dialektik.correlation_id')::dialektik_ulid;
  context_reason := nullif(current_setting('dialektik.reason_code', true), '');

  perform set_config('dialektik.audit_emitting', '1', true);
  insert into audit_entries (
    id,
    occurred_at,
    actor_type,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    correlation_id,
    reason_code,
    before_hash,
    after_hash,
    metadata
  ) values (
    dialektik_generate_ulid(),
    clock_timestamp(),
    context_actor_type,
    context_actor_id,
    context_action,
    audited_entity_type,
    audited_entity_id,
    context_correlation,
    context_reason,
    case when before_value is null then null
      else encode(digest(convert_to(before_value::text, 'UTF8'), 'sha256'), 'hex') end,
    case when after_value is null then null
      else encode(digest(convert_to(after_value::text, 'UTF8'), 'sha256'), 'hex') end,
    '{}'::jsonb
  );
  perform set_config('dialektik.audit_emitting', '', true);
end;
$$;

create function dialektik_guard_audit_insert()
returns trigger
language plpgsql
as $$
begin
  if current_setting('dialektik.audit_emitting', true) is distinct from '1' then
    raise exception using
      errcode = '42501',
      message = 'AuditEntry rows may only be emitted by protected database mutations';
  end if;
  return new;
end;
$$;

create trigger audit_entries_coupled_insert
before insert on audit_entries
for each row execute function dialektik_guard_audit_insert();

create function dialektik_audit_protected_mutation()
returns trigger
language plpgsql
as $$
declare
  before_value jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_value jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_value jsonb := coalesce(after_value, before_value);
  allowed_actions audit_action_type[];
  should_audit boolean := false;
  protected_changes integer := 0;
begin
  case tg_table_name
    when 'assertions' then
      if tg_op = 'INSERT' and new.supersedes_id is not null then
        should_audit := true;
        allowed_actions := array['superseded']::audit_action_type[];
        perform dialektik_require_human_audit_actor();
      elsif tg_op = 'INSERT' and new.position_id is not null then
        should_audit := true;
        allowed_actions := array['membership_changed']::audit_action_type[];
        perform dialektik_require_human_audit_actor();
      elsif tg_op = 'UPDATE' then
        if new.position_id is distinct from old.position_id then
          protected_changes := protected_changes + 1;
          allowed_actions := array['membership_changed']::audit_action_type[];
        end if;
        if new.lifecycle_state is distinct from old.lifecycle_state then
          protected_changes := protected_changes + 1;
          allowed_actions := case new.lifecycle_state
            when 'invalidated' then array['invalidated']::audit_action_type[]
            when 'withdrawn' then array['withdrawn']::audit_action_type[]
            else array[]::audit_action_type[]
          end;
        end if;
        should_audit := protected_changes > 0;
      end if;
    when 'positions' then
      if tg_op = 'INSERT' then
        should_audit := true;
        allowed_actions := array['created']::audit_action_type[];
        perform dialektik_require_human_audit_actor();
      elsif tg_op = 'UPDATE' then
        if new.publication_state is distinct from old.publication_state then
          protected_changes := protected_changes + 1;
          allowed_actions := case new.publication_state
            when 'published' then array['published']::audit_action_type[]
            when 'superseded' then array['superseded']::audit_action_type[]
            else array['retracted']::audit_action_type[]
          end;
          if new.publication_state = 'published' then
            perform dialektik_require_context_actor(new.published_by);
          end if;
        end if;
        if new.status is distinct from old.status then
          protected_changes := protected_changes + 1;
          allowed_actions := case new.status
            when 'merged' then array['merged']::audit_action_type[]
            when 'split' then array['split']::audit_action_type[]
            when 'withdrawn' then array['withdrawn']::audit_action_type[]
            else array[]::audit_action_type[]
          end;
        end if;
        should_audit := protected_changes > 0;
      end if;
    when 'relationships' then
      if tg_op = 'INSERT' and new.publication_state = 'published' then
        should_audit := true;
        allowed_actions := array['confirmed']::audit_action_type[];
        perform dialektik_require_context_actor(new.confirmed_by);
      elsif tg_op = 'UPDATE' then
        if new.rel_type is distinct from old.rel_type then
          protected_changes := protected_changes + 1;
          allowed_actions := array['relationship_reclassified']::audit_action_type[];
        end if;
        if new.publication_state is distinct from old.publication_state then
          protected_changes := protected_changes + 1;
          allowed_actions := case new.publication_state
            when 'published' then array['confirmed']::audit_action_type[]
            when 'rejected' then array['dismissed']::audit_action_type[]
            else array[]::audit_action_type[]
          end;
          if new.publication_state = 'published' then
            perform dialektik_require_context_actor(new.confirmed_by);
          end if;
        end if;
        should_audit := protected_changes > 0;
      end if;
    when 'contradiction_publications' then
      if tg_op = 'INSERT' then
        should_audit := true;
        allowed_actions := array['published']::audit_action_type[];
        perform dialektik_require_context_actor(new.confirmed_by);
      elsif tg_op = 'UPDATE' and new.publication_state is distinct from old.publication_state then
        should_audit := true;
        allowed_actions := case new.publication_state
          when 'requires_review' then array['requires_review']::audit_action_type[]
          when 'retracted' then array['retracted']::audit_action_type[]
          else array[]::audit_action_type[]
        end;
        if new.publication_state = 'retracted' then
          perform dialektik_require_context_actor(new.retracted_by);
        end if;
      end if;
    when 'primary_facts' then
      should_audit := true;
      allowed_actions := case tg_op
        when 'INSERT' then array['created', 'confirmed']::audit_action_type[]
        else array['metadata_updated', 'invalidated']::audit_action_type[]
      end;
    when 'evidence' then
      if tg_op = 'INSERT' and (new.publication_state = 'published' or new.supersedes_id is not null) then
        should_audit := true;
        allowed_actions := case
          when new.publication_state = 'published' then array['evidence_published']::audit_action_type[]
          else array['superseded']::audit_action_type[]
        end;
        perform dialektik_require_context_actor(new.approved_by);
      elsif tg_op = 'UPDATE' and new.publication_state is distinct from old.publication_state
        and new.publication_state = 'published' then
        should_audit := true;
        allowed_actions := array['evidence_published']::audit_action_type[];
        perform dialektik_require_context_actor(new.approved_by);
      end if;
    when 'user_evaluations' then
      if tg_op = 'INSERT' and new.supersedes_id is not null then
        should_audit := true;
        allowed_actions := array['evaluation_superseded']::audit_action_type[];
        perform dialektik_require_context_actor(new.user_id);
      end if;
    when 'events' then
      if tg_op = 'UPDATE' and new.merged_into is distinct from old.merged_into then
        should_audit := true;
        allowed_actions := array['merged']::audit_action_type[];
        perform dialektik_require_context_actor(new.merged_by);
      end if;
    when 'position_tombstones' then
      if tg_op = 'INSERT' then
        should_audit := true;
        allowed_actions := case new.operation
          when 'split' then array['split']::audit_action_type[]
          else array['merged']::audit_action_type[]
        end;
        perform dialektik_require_context_actor(new.actor_id);
      end if;
    when 'span_tombstones' then
      if tg_op = 'INSERT' then
        should_audit := true;
        allowed_actions := array['superseded']::audit_action_type[];
      end if;
    when 'moderation_tasks' then
      if (tg_op = 'INSERT' and new.state <> 'pending') or (
        tg_op = 'UPDATE' and (
          new.state is distinct from old.state
          or new.resolved_at is distinct from old.resolved_at
          or new.resolution_reason is distinct from old.resolution_reason
        )
      ) then
        should_audit := true;
        allowed_actions := array['moderation_decision']::audit_action_type[];
        perform dialektik_require_human_audit_actor();
      end if;
    when 'candidate_classes' then
      if tg_op = 'UPDATE' and new.state is distinct from old.state then
        should_audit := true;
        allowed_actions := array['moderation_decision']::audit_action_type[];
        perform dialektik_require_human_audit_actor();
      end if;
    when 'evidence_assessments' then
      if tg_op = 'INSERT' then
        should_audit := true;
        allowed_actions := array['confirmed']::audit_action_type[];
        perform dialektik_require_context_actor(new.confirmed_by);
      end if;
  end case;

  if protected_changes > 1 then
    raise exception using
      errcode = '23514',
      message = 'one command must not combine distinct protected transitions';
  end if;
  if should_audit then
    perform dialektik_emit_audit(
      tg_argv[0],
      coalesce(row_value ->> 'id', row_value ->> 'position_id', row_value ->> 'span_id'),
      before_value,
      after_value,
      allowed_actions
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger assertions_audit_protected
after insert or update on assertions
for each row execute function dialektik_audit_protected_mutation('Assertion');
create trigger positions_audit_protected
after insert or update on positions
for each row execute function dialektik_audit_protected_mutation('Position');
create trigger relationships_audit_protected
after insert or update on relationships
for each row execute function dialektik_audit_protected_mutation('Relationship');
create trigger contradiction_publications_audit_protected
after insert or update on contradiction_publications
for each row execute function dialektik_audit_protected_mutation('ContradictionPublication');
create trigger primary_facts_audit_protected
after insert or update or delete on primary_facts
for each row execute function dialektik_audit_protected_mutation('PrimaryFact');
create trigger evidence_audit_protected
after insert or update on evidence
for each row execute function dialektik_audit_protected_mutation('Evidence');
create trigger user_evaluations_audit_protected
after insert on user_evaluations
for each row execute function dialektik_audit_protected_mutation('UserEvaluation');
create trigger events_audit_protected
after update on events
for each row execute function dialektik_audit_protected_mutation('Event');
create trigger position_tombstones_audit_protected
after insert on position_tombstones
for each row execute function dialektik_audit_protected_mutation('PositionTombstone');
create trigger span_tombstones_audit_protected
after insert on span_tombstones
for each row execute function dialektik_audit_protected_mutation('SpanTombstone');
create trigger moderation_tasks_audit_protected
after insert or update on moderation_tasks
for each row execute function dialektik_audit_protected_mutation('ModerationTask');
create trigger candidate_classes_audit_protected
after update on candidate_classes
for each row execute function dialektik_audit_protected_mutation('CandidateClass');
create trigger evidence_assessments_audit_protected
after insert on evidence_assessments
for each row execute function dialektik_audit_protected_mutation('EvidenceAssessment');
`;

const DOMAIN_INVARIANTS_SQL = String.raw`
create view current_assertions as
select assertion_row.*
from assertions assertion_row
where assertion_row.lifecycle_state = 'active'
  and not exists (
    select 1 from assertions successor
    where successor.supersedes_id = assertion_row.id
  );

create view current_user_evaluations as
select evaluation.*
from user_evaluations evaluation
where not exists (
  select 1 from user_evaluations successor
  where successor.supersedes_id = evaluation.id
);

create view current_evidence_assessments as
select assessment.*
from evidence_assessments assessment
where not exists (
  select 1 from evidence_assessments successor
  where successor.supersedes_id = assessment.id
);

create function dialektik_require_nominal_relation_confidence()
returns trigger
language plpgsql
as $$
begin
  if new.confidence is null
    and (tg_op = 'INSERT' or old.confidence is not null) then
    raise exception 'new Relationship rows require nominal RelationConfidence';
  end if;
  return new;
end;
$$;

create trigger relationships_require_nominal_confidence
before insert or update of confidence on relationships
for each row execute function dialektik_require_nominal_relation_confidence();

create or replace function dialektik_assert_position_formation()
returns void
language plpgsql
as $$
begin
  perform dialektik_lock_phase_1b_graph();

  if exists (
    select 1
    from positions position_row
    where position_row.status = 'active'
      and (
        not exists (
          select 1
          from position_formed_by formation
          join relationships relationship_row
            on relationship_row.id = formation.relationship_id
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
            ) = 2
        )
        or exists (
          select 1
          from position_formed_by formation
          join relationships relationship_row
            on relationship_row.id = formation.relationship_id
          where formation.position_id = position_row.id
            and (
              relationship_row.rel_type <> 'R01a'
              or relationship_row.publication_state <> 'published'
              or relationship_row.event_id <> position_row.event_id
              or (
                select count(*)
                from relationship_endpoints endpoint
                where endpoint.relationship_id = relationship_row.id
              ) <> 2
              or exists (
                select 1
                from relationship_endpoints endpoint
                join assertions assertion_row on assertion_row.id = endpoint.assertion_id
                join claim_spans span_row on span_row.id = assertion_row.claim_span_id
                join articles article_row on article_row.id = span_row.article_id
                where endpoint.relationship_id = relationship_row.id
                  and (
                    assertion_row.position_id is distinct from position_row.id
                    or article_row.event_id is distinct from position_row.event_id
                  )
              )
            )
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'active Position requires non-empty published human R01a formation';
  end if;

  if exists (
    select 1
    from assertions assertion_row
    join positions position_row on position_row.id = assertion_row.position_id
    join claim_spans span_row on span_row.id = assertion_row.claim_span_id
    join articles article_row on article_row.id = span_row.article_id
    where article_row.event_id is distinct from position_row.event_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Position membership must remain inside the same Event';
  end if;

  if exists (
    select 1
    from current_assertions assertion_row
    join positions position_row on position_row.id = assertion_row.position_id
    where position_row.status <> 'active'
  ) then
    raise exception using
      errcode = '23514',
      message = 'current Assertion cannot remain in a non-active Position';
  end if;

  if exists (
    with recursive eligible_edges(event_id, assertion_a_id, assertion_b_id) as (
      select
        relationship_row.event_id,
        endpoint_a.assertion_id,
        endpoint_b.assertion_id
      from relationships relationship_row
      join relationship_endpoints endpoint_a
        on endpoint_a.relationship_id = relationship_row.id
      join relationship_endpoints endpoint_b
        on endpoint_b.relationship_id = relationship_row.id
        and endpoint_a.assertion_id < endpoint_b.assertion_id
      join assertions assertion_a on assertion_a.id = endpoint_a.assertion_id
      join claim_spans span_a on span_a.id = assertion_a.claim_span_id
      join articles article_a on article_a.id = span_a.article_id
      join assertions assertion_b on assertion_b.id = endpoint_b.assertion_id
      join claim_spans span_b on span_b.id = assertion_b.claim_span_id
      join articles article_b on article_b.id = span_b.article_id
      where relationship_row.rel_type = 'R01a'
        and relationship_row.publication_state = 'published'
        and article_a.event_id = relationship_row.event_id
        and article_b.event_id = relationship_row.event_id
    ),
    position_closure(position_id, event_id, assertion_id) as (
      select
        formation.position_id,
        position_row.event_id,
        endpoint.assertion_id
      from position_formed_by formation
      join positions position_row on position_row.id = formation.position_id
      join relationships relationship_row on relationship_row.id = formation.relationship_id
      join relationship_endpoints endpoint
        on endpoint.relationship_id = relationship_row.id
      where position_row.status = 'active'
        and relationship_row.rel_type = 'R01a'
        and relationship_row.publication_state = 'published'
        and relationship_row.event_id = position_row.event_id

      union

      select
        closure.position_id,
        closure.event_id,
        case
          when edge.assertion_a_id = closure.assertion_id then edge.assertion_b_id
          else edge.assertion_a_id
        end
      from position_closure closure
      join eligible_edges edge
        on edge.event_id = closure.event_id
        and (
          edge.assertion_a_id = closure.assertion_id
          or edge.assertion_b_id = closure.assertion_id
        )
    )
    select 1
    from assertions assertion_row
    join positions position_row on position_row.id = assertion_row.position_id
    where position_row.status = 'active'
      and not exists (
        select 1
        from position_closure closure
        where closure.position_id = assertion_row.position_id
          and closure.assertion_id = assertion_row.id
      )

    union all

    select 1
    from position_closure closure
    join assertions assertion_row on assertion_row.id = closure.assertion_id
    where assertion_row.position_id is distinct from closure.position_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Position membership must equal its published R01a closure';
  end if;
end;
$$;

create function dialektik_preserve_category_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception using
      errcode = '55000',
      message = 'Category slug is immutable';
  end if;
  return new;
end;
$$;
create trigger categories_slug_immutable
before update of slug on categories
for each row execute function dialektik_preserve_category_slug();

create function dialektik_validate_topic_merge()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:topic-merge', 0));
  if new.merged_into_id is not null and exists (
    with recursive successors(id, path) as (
      select topic_row.id, array[topic_row.id::text]
      from topics topic_row
      where topic_row.id = new.merged_into_id
      union all
      select topic_row.merged_into_id, successors.path || topic_row.merged_into_id::text
      from topics topic_row
      join successors on topic_row.id = successors.id
      where topic_row.merged_into_id is not null
        and not topic_row.merged_into_id::text = any(successors.path)
    )
    select 1 from successors where id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Topic merge lineage must be acyclic';
  end if;
  if tg_op = 'UPDATE' and old.merged_into_id is not null and (
    new.status is distinct from old.status
    or new.merged_into_id is distinct from old.merged_into_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'merged Topic lineage is immutable';
  end if;
  return new;
end;
$$;
create trigger topics_merge_valid
before insert or update of status, merged_into_id on topics
for each row execute function dialektik_validate_topic_merge();

create or replace function dialektik_validate_assertion_supersession()
returns trigger
language plpgsql
as $$
declare
  prior assertions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:assertion-lineage', 0));
  if new.supersedes_id is null then
    if new.lineage_root_id is distinct from new.id or new.version <> 1 then
      raise exception using
        errcode = '23514',
        message = 'root Assertion must identify itself as lineage root at version 1';
    end if;
    return new;
  end if;

  select * into prior from assertions where id = new.supersedes_id for update;
  if prior.id is null then
    return new;
  end if;
  if prior.claim_span_id <> new.claim_span_id
    or prior.lineage_root_id <> new.lineage_root_id
    or new.version <> prior.version + 1 then
    raise exception using
      errcode = '23514',
      message = 'Assertion successor must preserve span/root and increment the immediate version';
  end if;
  if new.id <= prior.id then
    raise exception using
      errcode = '23514',
      message = 'Assertion successor ULID must be newer than its immediate predecessor';
  end if;
  if prior.lifecycle_state <> 'active' or exists (
    select 1 from assertions successor where successor.supersedes_id = prior.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Assertion successor must point to the current immediate predecessor';
  end if;
  if new.position_id is not null then
    raise exception using
      errcode = '23514',
      message = 'Assertion successor never inherits Position membership';
  end if;
  return new;
end;
$$;

create or replace function dialektik_preserve_superseded_assertion()
returns trigger
language plpgsql
as $$
declare
  semantically_locked boolean;
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Assertions are retained version history';
  end if;
  if new.id is distinct from old.id
    or new.supersedes_id is distinct from old.supersedes_id
    or new.lineage_root_id is distinct from old.lineage_root_id
    or new.version is distinct from old.version then
    raise exception using
      errcode = '55000',
      message = 'Assertion identity and lineage fields are immutable';
  end if;

  semantically_locked := exists (
    select 1 from assertions successor where successor.supersedes_id = old.id
  ) or old.position_id is not null or exists (
    select 1
    from relationship_endpoints endpoint
    join relationships relationship_row on relationship_row.id = endpoint.relationship_id
    where endpoint.assertion_id = old.id
      and relationship_row.publication_state = 'published'
  );
  if semantically_locked and (
    new.claim_span_id is distinct from old.claim_span_id
    or new.ordinal is distinct from old.ordinal
    or new.is_principal is distinct from old.is_principal
    or new.assertion_type is distinct from old.assertion_type
    or new.subject_ref is distinct from old.subject_ref
    or new.temporal_scope is distinct from old.temporal_scope
    or new.population_scope is distinct from old.population_scope
    or new.comparison_base is distinct from old.comparison_base
    or new.epistemic_class is distinct from old.epistemic_class
    or new.epistemic_reason is distinct from old.epistemic_reason
    or new.extraction_confidence is distinct from old.extraction_confidence
  ) then
    raise exception using
      errcode = '55000',
      message = 'confirmed or published Assertion semantics are immutable';
  end if;
  if old.lifecycle_state <> 'active'
    and new.lifecycle_state is distinct from old.lifecycle_state then
    raise exception using
      errcode = '55000',
      message = 'Assertion invalidation or withdrawal is terminal';
  end if;
  return new;
end;
$$;

create function dialektik_assert_current_principal()
returns void
language plpgsql
as $$
begin
  if exists (
    select current_row.claim_span_id
    from current_assertions current_row
    group by current_row.claim_span_id
    having bool_or(current_row.position_id is not null)
      and count(*) filter (where current_row.is_principal) <> 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'a positioned ClaimSpan requires exactly one current principal Assertion';
  end if;
end;
$$;

create function dialektik_validate_current_principal()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_current_principal();
  return null;
end;
$$;
create constraint trigger assertions_current_principal_exact
after insert or update or delete on assertions
deferrable initially deferred
for each row execute function dialektik_validate_current_principal();
create constraint trigger positions_lifecycle_preserves_formation
after update of status on positions
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();

create function dialektik_validate_position_lifecycle_tombstone()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from positions position_row
    left join position_tombstones tombstone
      on tombstone.id = position_row.tombstone_id
      and tombstone.position_id = position_row.id
    where (
      position_row.status = 'active'
      and position_row.tombstone_id is not null
    ) or (
      position_row.status = 'split'
      and (tombstone.id is null or tombstone.operation <> 'split')
    ) or (
      position_row.status = 'merged'
      and (tombstone.id is null or tombstone.operation not in ('merge', 'absorbed'))
    ) or (
      position_row.status = 'withdrawn'
      and position_row.tombstone_id is not null
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Position lifecycle status must agree with its historical tombstone operation';
  end if;
  return null;
end;
$$;
create constraint trigger positions_lifecycle_tombstone_coherent
after insert or update or delete on positions
deferrable initially deferred
for each row execute function dialektik_validate_position_lifecycle_tombstone();
create constraint trigger position_tombstones_lifecycle_coherent
after insert or update or delete on position_tombstones
deferrable initially deferred
for each row execute function dialektik_validate_position_lifecycle_tombstone();

alter table claim_spans drop constraint claim_spans_primary_position_is_derived;

create function dialektik_guard_primary_position_write()
returns trigger
language plpgsql
as $$
begin
  if current_setting('dialektik.derived_primary_position', true) is distinct from '1' then
    raise exception using
      errcode = '42501',
      message = 'ClaimSpan.primary_position_id is derived and not independently writable';
  end if;
  return new;
end;
$$;
create trigger claim_spans_primary_position_derived
before update of primary_position_id on claim_spans
for each row execute function dialektik_guard_primary_position_write();

create function dialektik_refresh_primary_position()
returns trigger
language plpgsql
as $$
declare
  affected_span dialektik_ulid;
  derived_position dialektik_ulid;
begin
  affected_span := case when tg_op = 'DELETE' then old.claim_span_id else new.claim_span_id end;
  select current_row.position_id into derived_position
  from current_assertions current_row
  where current_row.claim_span_id = affected_span
    and current_row.is_principal
  order by current_row.id
  limit 1;
  perform set_config('dialektik.derived_primary_position', '1', true);
  update claim_spans
  set primary_position_id = derived_position
  where id = affected_span
    and primary_position_id is distinct from derived_position;
  perform set_config('dialektik.derived_primary_position', '', true);
  return null;
end;
$$;
create trigger assertions_refresh_primary_position
after insert or update of position_id, is_principal, lifecycle_state, supersedes_id or delete on assertions
for each row execute function dialektik_refresh_primary_position();

create or replace function dialektik_validate_evaluation_supersession()
returns trigger
language plpgsql
as $$
declare
  prior user_evaluations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:user-evaluation-lineage', 0));
  if new.supersedes_id is null then
    return new;
  end if;
  select * into prior from user_evaluations where id = new.supersedes_id for update;
  if prior.id is null then
    return new;
  end if;
  if prior.assertion_id <> new.assertion_id or prior.user_id <> new.user_id then
    raise exception using
      errcode = '23514',
      message = 'evaluation supersession must preserve exact Assertion and user';
  end if;
  if new.id <= prior.id or exists (
    select 1 from user_evaluations successor where successor.supersedes_id = prior.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'evaluation successor must point to the current immediate predecessor';
  end if;
  return new;
end;
$$;

create function dialektik_validate_evidence_assessment()
returns trigger
language plpgsql
as $$
declare
  prior evidence_assessments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:evidence-assessment-lineage', 0));
  perform dialektik_actor_must_be_human(new.confirmed_by, 'EvidenceAssessment confirmation');
  if new.supersedes_id is null then
    return new;
  end if;
  select * into prior from evidence_assessments where id = new.supersedes_id for update;
  if prior.id is null then
    return new;
  end if;
  if prior.assertion_id <> new.assertion_id
    or new.id <= prior.id
    or exists (select 1 from evidence_assessments successor where successor.supersedes_id = prior.id) then
    raise exception using
      errcode = '23514',
      message = 'EvidenceAssessment history must be linear for one exact Assertion';
  end if;
  return new;
end;
$$;
create trigger evidence_assessments_validate
before insert on evidence_assessments
for each row execute function dialektik_validate_evidence_assessment();
create trigger evidence_assessments_immutable
before update or delete on evidence_assessments
for each row execute function dialektik_prevent_historical_mutation();

create function dialektik_validate_evidence_supersession()
returns trigger
language plpgsql
as $$
declare
  prior evidence%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:evidence-lineage', 0));
  if new.supersedes_id is null then
    return new;
  end if;
  select * into prior from evidence where id = new.supersedes_id for update;
  if prior.id is null then
    return new;
  end if;
  if prior.anchor_span_id <> new.anchor_span_id
    or prior.scope_assertion_id <> new.scope_assertion_id
    or new.id <= prior.id
    or exists (select 1 from evidence successor where successor.supersedes_id = prior.id) then
    raise exception using
      errcode = '23514',
      message = 'Evidence supersession must preserve exact anchor/scope and remain linear';
  end if;
  return new;
end;
$$;
create trigger evidence_validate_supersession
before insert on evidence
for each row execute function dialektik_validate_evidence_supersession();

create function dialektik_preserve_evidence_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Evidence is retained history';
  end if;
  if exists (select 1 from evidence successor where successor.supersedes_id = old.id)
    or old.publication_state = 'published' then
    if new is distinct from old then
      raise exception using
        errcode = '55000',
        message = 'published or superseded Evidence is immutable';
    end if;
  end if;
  return new;
end;
$$;
create trigger evidence_history_immutable
before update or delete on evidence
for each row execute function dialektik_preserve_evidence_history();

create or replace function dialektik_validate_r05_comparability()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from relationships relationship_row
    join relationship_endpoints endpoint_a
      on endpoint_a.relationship_id = relationship_row.id
      and endpoint_a.endpoint_order = 1
    join relationship_endpoints endpoint_b
      on endpoint_b.relationship_id = relationship_row.id
      and endpoint_b.endpoint_order = 2
    join assertions assertion_a on assertion_a.id = endpoint_a.assertion_id
    join assertions assertion_b on assertion_b.id = endpoint_b.assertion_id
    where relationship_row.rel_type = 'R05'
      and (
        assertion_a.epistemic_class is not null
        or assertion_b.epistemic_class is not null
        or assertion_a.subject_ref <> assertion_b.subject_ref
        or assertion_a.population_scope is distinct from assertion_b.population_scope
        or assertion_a.temporal_scope <> assertion_b.temporal_scope
        or assertion_a.comparison_base is distinct from assertion_b.comparison_base
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
      message = 'R05 endpoints must be evaluable with compatible subject, population, time, and base';
  end if;
  return null;
end;
$$;

create function dialektik_assert_relationship_endpoint_matrix()
returns void
language plpgsql
as $$
begin
  perform dialektik_assert_relationship_endpoint_cardinality();
  if exists (
    select 1
    from relationships relationship_row
    join relationship_endpoints first_endpoint
      on first_endpoint.relationship_id = relationship_row.id
      and first_endpoint.endpoint_order = 1
    join relationship_endpoints second_endpoint
      on second_endpoint.relationship_id = relationship_row.id
      and second_endpoint.endpoint_order = 2
    join assertions first_assertion on first_assertion.id = first_endpoint.assertion_id
    join claim_spans first_span on first_span.id = first_assertion.claim_span_id
    join articles first_article on first_article.id = first_span.article_id
    join assertions second_assertion on second_assertion.id = second_endpoint.assertion_id
    join claim_spans second_span on second_span.id = second_assertion.claim_span_id
    join articles second_article on second_article.id = second_span.article_id
    where first_article.event_id is distinct from relationship_row.event_id
      or second_article.event_id is distinct from relationship_row.event_id
      or (
        relationship_row.rel_type in ('R01a', 'R01b', 'R05', 'R06', 'R07')
        and (
          first_endpoint.role <> 'peer'
          or second_endpoint.role <> 'peer'
          or first_endpoint.assertion_id >= second_endpoint.assertion_id
        )
      )
      or (
        relationship_row.rel_type in ('R11a', 'R11b')
        and (
          first_endpoint.role <> 'source'
          or second_endpoint.role <> 'target'
          or first_endpoint.assertion_id >= second_endpoint.assertion_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Relationship endpoints violate role, Event, canonical order, or temporal direction';
  end if;
end;
$$;
create function dialektik_validate_relationship_endpoint_matrix()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_relationship_endpoint_matrix();
  return null;
end;
$$;
create constraint trigger relationships_endpoint_matrix
after insert or update or delete on relationships
deferrable initially deferred
for each row execute function dialektik_validate_relationship_endpoint_matrix();
create constraint trigger relationship_endpoints_matrix
after insert or update or delete on relationship_endpoints
deferrable initially deferred
for each row execute function dialektik_validate_relationship_endpoint_matrix();
create constraint trigger assertions_preserve_endpoint_matrix
after update of id, claim_span_id or delete on assertions
deferrable initially deferred
for each row execute function dialektik_validate_relationship_endpoint_matrix();
create constraint trigger articles_preserve_endpoint_matrix
after update of event_id or delete on articles
deferrable initially deferred
for each row execute function dialektik_validate_relationship_endpoint_matrix();

create function dialektik_assert_candidate_members()
returns void
language plpgsql
as $$
begin
  if exists (
    select 1
    from candidate_class_members membership
    join candidate_classes candidate on candidate.id = membership.candidate_class_id
    join assertions assertion_row on assertion_row.id = membership.assertion_id
    join claim_spans span_row on span_row.id = assertion_row.claim_span_id
    join articles article_row on article_row.id = span_row.article_id
    where article_row.event_id is distinct from candidate.event_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'CandidateClass member Assertion must belong to the same Event';
  end if;
end;
$$;

create function dialektik_validate_candidate_member()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_candidate_members();
  return null;
end;
$$;
create constraint trigger candidate_class_members_same_event
after insert or update or delete on candidate_class_members
deferrable initially deferred
for each row execute function dialektik_validate_candidate_member();
create constraint trigger candidate_classes_preserve_member_event
after update of event_id or delete on candidate_classes
deferrable initially deferred
for each row execute function dialektik_validate_candidate_member();
create constraint trigger assertions_preserve_candidate_event
after update of claim_span_id or delete on assertions
deferrable initially deferred
for each row execute function dialektik_validate_candidate_member();
create constraint trigger articles_preserve_candidate_event
after update of event_id or delete on articles
deferrable initially deferred
for each row execute function dialektik_validate_candidate_member();

create or replace function dialektik_validate_moderation_targets()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from moderation_tasks task
    where (
      task.target_type = 'Event'
      and not exists (select 1 from events event_row where event_row.id = task.target_id)
    ) or (
      task.target_type = 'Position'
      and not exists (select 1 from positions position_row where position_row.id = task.target_id)
    ) or (
      task.target_type = 'CandidateClass'
      and not exists (select 1 from candidate_classes candidate where candidate.id = task.target_id)
    ) or (
      task.target_type = 'PositionRelationProjection'
      and not exists (
        select 1
        from positions first_position
        join positions second_position on second_position.id = task.projection_position_b_id
        where first_position.id = task.projection_position_a_id
          and first_position.event_id = task.projection_event_id
          and second_position.event_id = task.projection_event_id
      )
    )
  ) then
    raise exception using
      errcode = '23503',
      message = 'moderation task target must resolve to its typed entity or projection snapshot';
  end if;
  return null;
end;
$$;
create constraint trigger candidate_classes_preserve_moderation_targets
after update or delete on candidate_classes
deferrable initially deferred
for each row execute function dialektik_validate_moderation_targets();

create function dialektik_lock_membership_history()
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:temporal-membership', 0));
end;
$$;

create function dialektik_guard_membership_history()
returns trigger
language plpgsql
as $$
begin
  if current_setting('dialektik.membership_history_emitting', true) is distinct from '1' then
    raise exception using
      errcode = '42501',
      message = tg_table_name || ' is append-only, database-maintained history';
  end if;
  if tg_op = 'UPDATE' and (
    old.valid_to is not null
    or new.valid_to is null
    or new.valid_to <= old.valid_from
    or to_jsonb(new) - 'valid_to' is distinct from to_jsonb(old) - 'valid_to'
  ) then
    raise exception using
      errcode = '55000',
      message = tg_table_name || ' history may only close its current open interval';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger assertion_position_history_guard
before insert or update or delete on assertion_position_membership_history
for each row execute function dialektik_guard_membership_history();
create trigger event_topics_history_guard
before insert or update or delete on event_topics
for each row execute function dialektik_guard_membership_history();

create function dialektik_validate_membership_intervals()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_lock_membership_history();
  if tg_table_name = 'assertion_position_membership_history' then
    if exists (
      select 1
      from assertion_position_membership_history first_interval
      join assertion_position_membership_history second_interval
        on second_interval.assertion_id = first_interval.assertion_id
        and second_interval.id > first_interval.id
        and tstzrange(first_interval.valid_from, first_interval.valid_to, '[)')
          && tstzrange(second_interval.valid_from, second_interval.valid_to, '[)')
    ) or exists (
      select 1
      from assertion_position_membership_history later
      join assertion_position_membership_history earlier
        on earlier.assertion_id = later.assertion_id
        and earlier.valid_to = later.valid_from
        and earlier.position_id is not distinct from later.position_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'Assertion-Position history must not overlap or contain adjacent duplicates';
    end if;
  else
    if exists (
      select 1
      from event_topics first_interval
      join event_topics second_interval
        on second_interval.event_id = first_interval.event_id
        and second_interval.topic_id = first_interval.topic_id
        and second_interval.id > first_interval.id
        and tstzrange(first_interval.valid_from, first_interval.valid_to, '[)')
          && tstzrange(second_interval.valid_from, second_interval.valid_to, '[)')
    ) then
      raise exception using
        errcode = '23514',
        message = 'Event-Topic membership intervals must not overlap';
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger assertion_position_history_intervals_valid
after insert or update on assertion_position_membership_history
deferrable initially deferred
for each row execute function dialektik_validate_membership_intervals();
create constraint trigger event_topics_intervals_valid
after insert or update on event_topics
deferrable initially deferred
for each row execute function dialektik_validate_membership_intervals();

create function dialektik_record_assertion_position_membership()
returns trigger
language plpgsql
as $$
declare
  context_actor dialektik_ulid;
  context_correlation dialektik_ulid;
  context_reason text;
  change_time timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' and new.position_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.position_id is not distinct from old.position_id then
    return new;
  end if;
  perform dialektik_lock_membership_history();
  perform dialektik_require_audit_context(array['membership_changed']::audit_action_type[]);
  context_actor := nullif(current_setting('dialektik.actor_id'), '')::dialektik_ulid;
  if context_actor is null then
    raise exception using
      errcode = '22004',
      message = 'Assertion membership change requires a human actor';
  end if;
  context_correlation := current_setting('dialektik.correlation_id')::dialektik_ulid;
  context_reason := nullif(current_setting('dialektik.reason_code', true), '');
  if context_reason is null then
    raise exception using
      errcode = '22004',
      message = 'Assertion membership change requires reason_code';
  end if;

  perform set_config('dialektik.membership_history_emitting', '1', true);
  if tg_op = 'UPDATE' then
    update assertion_position_membership_history
    set valid_to = change_time
    where assertion_id = old.id and valid_to is null;
  end if;
  insert into assertion_position_membership_history (
    id, assertion_id, position_id, valid_from, valid_to, reason_code,
    actor_id, correlation_id, recorded_at
  ) values (
    dialektik_generate_ulid(), new.id, new.position_id, change_time, null,
    context_reason, context_actor, context_correlation, clock_timestamp()
  );
  perform set_config('dialektik.membership_history_emitting', '', true);
  return new;
end;
$$;
create trigger assertions_record_position_membership
after insert or update on assertions
for each row execute function dialektik_record_assertion_position_membership();

create function dialektik_set_event_topic_membership(
  requested_event_id dialektik_ulid,
  requested_topic_id dialektik_ulid,
  should_be_member boolean,
  effective_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
as $$
declare
  context_actor dialektik_ulid;
  context_correlation dialektik_ulid;
  context_reason text;
  open_membership event_topics%rowtype;
begin
  perform dialektik_lock_membership_history();
  perform dialektik_require_audit_context(array['membership_changed']::audit_action_type[]);
  context_actor := nullif(current_setting('dialektik.actor_id'), '')::dialektik_ulid;
  if context_actor is null then
    raise exception using
      errcode = '22004',
      message = 'Event-Topic membership change requires a human actor';
  end if;
  context_correlation := current_setting('dialektik.correlation_id')::dialektik_ulid;
  context_reason := nullif(current_setting('dialektik.reason_code', true), '');
  if context_reason is null then
    raise exception using
      errcode = '22004',
      message = 'Event-Topic membership change requires reason_code';
  end if;

  select * into open_membership
  from event_topics
  where event_id = requested_event_id
    and topic_id = requested_topic_id
    and valid_to is null
  for update;

  if should_be_member and open_membership.id is not null then
    return;
  end if;
  if not should_be_member and open_membership.id is null then
    return;
  end if;

  perform set_config('dialektik.membership_history_emitting', '1', true);
  if should_be_member then
    insert into event_topics (
      id, event_id, topic_id, valid_from, valid_to, reason_code,
      actor_id, correlation_id, recorded_at
    ) values (
      dialektik_generate_ulid(), requested_event_id, requested_topic_id,
      effective_at, null, context_reason, context_actor, context_correlation,
      clock_timestamp()
    );
  else
    if effective_at <= open_membership.valid_from then
      raise exception using
        errcode = '23514',
        message = 'Event-Topic close time must be after its open time';
    end if;
    update event_topics set valid_to = effective_at where id = open_membership.id;
  end if;
  perform set_config('dialektik.membership_history_emitting', '', true);

  perform dialektik_emit_audit(
    'EventTopicMembership',
    requested_event_id || ':' || requested_topic_id,
    case when should_be_member then null else to_jsonb(open_membership) end,
    case when should_be_member then jsonb_build_object(
      'event_id', requested_event_id,
      'topic_id', requested_topic_id,
      'valid_from', effective_at
    ) else to_jsonb(open_membership) || jsonb_build_object('valid_to', effective_at) end,
    array['membership_changed']::audit_action_type[]
  );
end;
$$;

create view position_evidence_absence as
select
  position_row.id as position_id,
  case
    when bool_or(current_assessment.id is not null) then 'inconclusive'::text
    when count(published_evidence.id) = 0 then 'no_evidence_yet'::text
    else null
  end as evidence_absence,
  count(published_evidence.id) filter (where published_evidence.stance = 'supports')::integer
    as supports_count,
  count(published_evidence.id) filter (where published_evidence.stance = 'contradicts')::integer
    as contradicts_count,
  count(published_evidence.id) filter (where published_evidence.stance = 'contextualizes')::integer
    as contextualizes_count
from positions position_row
join current_assertions assertion_row on assertion_row.position_id = position_row.id
left join current_evidence_assessments current_assessment
  on current_assessment.assertion_id = assertion_row.id
left join evidence published_evidence
  on published_evidence.scope_assertion_id = assertion_row.id
  and published_evidence.publication_state = 'published'
  and not exists (
    select 1 from evidence successor where successor.supersedes_id = published_evidence.id
  )
group by position_row.id;

select dialektik_assert_current_principal();
select dialektik_assert_relationship_endpoint_matrix();
`;

const PROJECTION_SQL = String.raw`
create view position_relation_projections as
with position_pairs as (
  select
    first_position.event_id,
    first_position.id as position_a_id,
    second_position.id as position_b_id
  from positions first_position
  join positions second_position
    on second_position.event_id = first_position.event_id
    and second_position.id > first_position.id
  where first_position.publication_state = 'published'
    and second_position.publication_state = 'published'
    and first_position.status = 'active'
    and second_position.status = 'active'
),
position_assertion_sets as (
  select
    position_row.id as position_id,
    coalesce(
      jsonb_agg(assertion_row.id order by assertion_row.id)
        filter (where assertion_row.id is not null),
      '[]'::jsonb
    ) as assertion_ids
  from positions position_row
  left join current_assertions assertion_row on assertion_row.position_id = position_row.id
  group by position_row.id
),
cross_pairs as (
  select
    position_pair.event_id,
    position_pair.position_a_id,
    position_pair.position_b_id,
    first_assertion.id as assertion_a_id,
    second_assertion.id as assertion_b_id,
    first_assertion.epistemic_class is null
      and second_assertion.epistemic_class is null
      and first_assertion.subject_ref = second_assertion.subject_ref
      and first_assertion.population_scope is not distinct from second_assertion.population_scope
      and first_assertion.temporal_scope = second_assertion.temporal_scope
      and first_assertion.comparison_base is not distinct from second_assertion.comparison_base
      and not exists (
        select 1
        from relationships exclusion
        join relationship_endpoints exclusion_a
          on exclusion_a.relationship_id = exclusion.id
          and exclusion_a.assertion_id = first_assertion.id
        join relationship_endpoints exclusion_b
          on exclusion_b.relationship_id = exclusion.id
          and exclusion_b.assertion_id = second_assertion.id
        where exclusion.rel_type in ('R06', 'R07')
          and exclusion.publication_state = 'published'
      ) as is_comparable,
    exists (
      select 1
      from relationships conflict
      join relationship_endpoints conflict_a
        on conflict_a.relationship_id = conflict.id
        and conflict_a.assertion_id = first_assertion.id
      join relationship_endpoints conflict_b
        on conflict_b.relationship_id = conflict.id
        and conflict_b.assertion_id = second_assertion.id
      where conflict.rel_type = 'R05'
        and conflict.publication_state = 'published'
        and conflict.confirmed_by is not null
        and conflict.confirmed_at is not null
    ) as has_confirmed_conflict,
    exists (
      select 1
      from relationships equivalence
      join relationship_endpoints equivalence_a
        on equivalence_a.relationship_id = equivalence.id
        and equivalence_a.assertion_id = first_assertion.id
      join relationship_endpoints equivalence_b
        on equivalence_b.relationship_id = equivalence.id
        and equivalence_b.assertion_id = second_assertion.id
      where equivalence.rel_type = 'R01a'
        and equivalence.publication_state = 'published'
    ) as has_cross_position_equivalence
  from position_pairs position_pair
  join current_assertions first_assertion
    on first_assertion.position_id = position_pair.position_a_id
  join current_assertions second_assertion
    on second_assertion.position_id = position_pair.position_b_id
),
contributing_relationships as (
  select distinct
    comparable_pair.event_id,
    comparable_pair.position_a_id,
    comparable_pair.position_b_id,
    conflict.id as relationship_id
  from cross_pairs comparable_pair
  join relationships conflict
    on conflict.rel_type = 'R05'
    and conflict.publication_state = 'published'
    and conflict.confirmed_by is not null
    and conflict.confirmed_at is not null
  join relationship_endpoints conflict_a
    on conflict_a.relationship_id = conflict.id
    and conflict_a.assertion_id = comparable_pair.assertion_a_id
  join relationship_endpoints conflict_b
    on conflict_b.relationship_id = conflict.id
    and conflict_b.assertion_id = comparable_pair.assertion_b_id
  where comparable_pair.is_comparable
),
r05_aggregates as (
  select
    contributing.event_id,
    contributing.position_a_id,
    contributing.position_b_id,
    jsonb_agg(contributing.relationship_id order by contributing.relationship_id)
      as contributing_r05_ids
  from contributing_relationships contributing
  group by
    contributing.event_id,
    contributing.position_a_id,
    contributing.position_b_id
),
pair_aggregates as (
  select
    position_pair.event_id,
    position_pair.position_a_id,
    position_pair.position_b_id,
    count(*) filter (where cross_pair.is_comparable)::integer as comparable_pairs,
    count(*) filter (
      where cross_pair.is_comparable and cross_pair.has_confirmed_conflict
    )::integer as conflict_pairs,
    coalesce(bool_or(cross_pair.has_cross_position_equivalence), false)
      as requires_review,
    coalesce(
      jsonb_agg(
        jsonb_build_array(cross_pair.assertion_a_id, cross_pair.assertion_b_id)
        order by cross_pair.assertion_a_id, cross_pair.assertion_b_id
      ) filter (where cross_pair.is_comparable),
      '[]'::jsonb
    ) as comparable_assertion_pairs,
    coalesce(r05_aggregate.contributing_r05_ids, '[]'::jsonb) as contributing_r05_ids
  from position_pairs position_pair
  left join cross_pairs cross_pair
    on cross_pair.event_id = position_pair.event_id
    and cross_pair.position_a_id = position_pair.position_a_id
    and cross_pair.position_b_id = position_pair.position_b_id
  left join r05_aggregates r05_aggregate
    on r05_aggregate.event_id = position_pair.event_id
    and r05_aggregate.position_a_id = position_pair.position_a_id
    and r05_aggregate.position_b_id = position_pair.position_b_id
  group by
    position_pair.event_id,
    position_pair.position_a_id,
    position_pair.position_b_id,
    r05_aggregate.contributing_r05_ids
),
projection_values as (
  select
    pair_aggregate.event_id,
    pair_aggregate.position_a_id,
    pair_aggregate.position_b_id,
    first_set.assertion_ids as position_a_assertion_ids,
    second_set.assertion_ids as position_b_assertion_ids,
    pair_aggregate.comparable_assertion_pairs,
    pair_aggregate.contributing_r05_ids,
    pair_aggregate.comparable_pairs,
    pair_aggregate.conflict_pairs,
    case when pair_aggregate.comparable_pairs = 0 then null
      else pair_aggregate.conflict_pairs::double precision
        / pair_aggregate.comparable_pairs::double precision end as conflict_ratio,
    case
      when pair_aggregate.comparable_pairs = 0 then 'non_comparable'::projection_outcome
      when pair_aggregate.conflict_pairs = 0 then 'no_confirmed_conflict'::projection_outcome
      else 'conflict_present'::projection_outcome
    end as outcome,
    'v1:any_confirmed_conflict'::text as threshold_rule,
    pair_aggregate.requires_review,
    not pair_aggregate.requires_review and pair_aggregate.conflict_pairs > 0
      as publication_eligible
  from pair_aggregates pair_aggregate
  join position_assertion_sets first_set
    on first_set.position_id = pair_aggregate.position_a_id
  join position_assertion_sets second_set
    on second_set.position_id = pair_aggregate.position_b_id
)
select
  projection_value.*,
  encode(
    digest(
      convert_to(
        jsonb_build_object(
          'schema_version', 'v1',
          'event_id', projection_value.event_id,
          'position_ids', jsonb_build_array(
            projection_value.position_a_id,
            projection_value.position_b_id
          ),
          'current_assertion_ids', jsonb_build_object(
            projection_value.position_a_id,
            projection_value.position_a_assertion_ids,
            projection_value.position_b_id,
            projection_value.position_b_assertion_ids
          ),
          'comparable_assertion_pairs', projection_value.comparable_assertion_pairs,
          'contributing_r05_ids', projection_value.contributing_r05_ids,
          'comparable_pairs', projection_value.comparable_pairs,
          'conflict_pairs', projection_value.conflict_pairs,
          'outcome', projection_value.outcome,
          'threshold_rule', projection_value.threshold_rule
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) as projection_hash
from projection_values projection_value;

create function dialektik_validate_contradiction_publication_projection()
returns trigger
language plpgsql
as $$
declare
  projection position_relation_projections%rowtype;
begin
  select * into projection
  from position_relation_projections current_projection
  where current_projection.event_id = new.event_id
    and current_projection.position_a_id = new.position_a_id
    and current_projection.position_b_id = new.position_b_id;
  if projection.event_id is null
    or not projection.publication_eligible
    or projection.requires_review
    or new.projection_hash <> projection.projection_hash
    or new.ratio_conflicting_at_publication <> projection.conflict_pairs
    or new.ratio_comparable_at_publication <> projection.comparable_pairs
    or new.threshold_rule_at_publication <> 'v1:any_confirmed_conflict' then
    raise exception using
      errcode = '23514',
      message = 'ContradictionPublication requires an exact eligible current projection snapshot';
  end if;
  return new;
end;
$$;
create trigger contradiction_publications_projection_eligible
before insert on contradiction_publications
for each row execute function dialektik_validate_contradiction_publication_projection();

create unique index moderation_tasks_one_open_projection_review
  on moderation_tasks (
    projection_event_id,
    projection_position_a_id,
    projection_position_b_id,
    task_type
  )
  where target_type = 'PositionRelationProjection'
    and task_type = 'projection_stale_review'
    and state in ('pending', 'partially_accepted', 'escalated');

create function dialektik_mark_stale_contradiction_publications()
returns trigger
language plpgsql
as $$
declare
  stale_publication record;
  generated_correlation dialektik_ulid;
  previous_actor_type text := current_setting('dialektik.actor_type', true);
  previous_actor_id text := current_setting('dialektik.actor_id', true);
  previous_correlation text := current_setting('dialektik.correlation_id', true);
  previous_action text := current_setting('dialektik.action_type', true);
  previous_reason text := current_setting('dialektik.reason_code', true);
begin
  for stale_publication in
    select
      publication.id,
      publication.event_id,
      publication.position_a_id,
      publication.position_b_id,
      publication.projection_hash as published_hash,
      current_projection.projection_hash as current_hash
    from contradiction_publications publication
    left join position_relation_projections current_projection
      on current_projection.event_id = publication.event_id
      and current_projection.position_a_id = publication.position_a_id
      and current_projection.position_b_id = publication.position_b_id
    where publication.publication_state = 'published'
      and (
        current_projection.projection_hash is distinct from publication.projection_hash
        or current_projection.requires_review
        or not coalesce(current_projection.publication_eligible, false)
      )
  loop
    generated_correlation := dialektik_generate_ulid();
    perform dialektik_set_audit_context(
      'system',
      null,
      generated_correlation,
      'requires_review',
      'projection_hash_changed'
    );
    update contradiction_publications
    set publication_state = 'requires_review'
    where id = stale_publication.id;

    if not exists (
      select 1 from moderation_tasks task
      where task.target_type = 'PositionRelationProjection'
        and task.task_type = 'projection_stale_review'
        and task.projection_event_id = stale_publication.event_id
        and task.projection_position_a_id = stale_publication.position_a_id
        and task.projection_position_b_id = stale_publication.position_b_id
        and task.state in ('pending', 'partially_accepted', 'escalated')
    ) then
      insert into moderation_tasks (
        id,
        task_type,
        target_type,
        target_id,
        state,
        priority,
        assigned_to,
        created_at,
        resolved_at,
        resolution_reason,
        projection_event_id,
        projection_position_a_id,
        projection_position_b_id,
        projection_hash
      ) values (
        dialektik_generate_ulid(),
        'projection_stale_review',
        'PositionRelationProjection',
        null,
        'pending',
        0,
        null,
        clock_timestamp(),
        null,
        null,
        stale_publication.event_id,
        stale_publication.position_a_id,
        stale_publication.position_b_id,
        coalesce(stale_publication.current_hash, stale_publication.published_hash)
      );
    end if;
  end loop;

  perform set_config('dialektik.actor_type', coalesce(previous_actor_type, ''), true);
  perform set_config('dialektik.actor_id', coalesce(previous_actor_id, ''), true);
  perform set_config('dialektik.correlation_id', coalesce(previous_correlation, ''), true);
  perform set_config('dialektik.action_type', coalesce(previous_action, ''), true);
  perform set_config('dialektik.reason_code', coalesce(previous_reason, ''), true);
  return null;
end;
$$;

create constraint trigger assertions_projection_staleness
after insert or update or delete on assertions
deferrable initially deferred
for each row execute function dialektik_mark_stale_contradiction_publications();
create constraint trigger relationships_projection_staleness
after insert or update or delete on relationships
deferrable initially deferred
for each row execute function dialektik_mark_stale_contradiction_publications();
create constraint trigger relationship_endpoints_projection_staleness
after insert or update or delete on relationship_endpoints
deferrable initially deferred
for each row execute function dialektik_mark_stale_contradiction_publications();
create constraint trigger positions_projection_staleness
after insert or update or delete on positions
deferrable initially deferred
for each row execute function dialektik_mark_stale_contradiction_publications();
`;

export const phase1cClosureMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PRECONDITION_SQL).execute(database);
    await sql.raw(CLOSURE_SCHEMA_SQL).execute(database);
    await sql.raw(AUDIT_COUPLING_SQL).execute(database);
    await sql.raw(DOMAIN_INVARIANTS_SQL).execute(database);
    await sql.raw(PROJECTION_SQL).execute(database);
  },
};
