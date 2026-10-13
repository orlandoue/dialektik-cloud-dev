import { sql, type Migration } from 'kysely';

/**
 * OD-12 v1 moderation authority. Human proposals remain non-authoritative;
 * only a distinct editor confirmation may create proposal-bound R01a.
 */
const PHASE_6_MODERATION_AUTHORITY_SQL = String.raw`
create type moderation_review_outcome as enum ('accept_subset', 'split');
create type moderation_review_proposal_state as enum ('submitted', 'confirmed', 'refused');
create type moderation_command_type as enum (
  'claim',
  'release',
  'reassign',
  'escalate',
  'submit_proposal',
  'confirm_proposal',
  'refuse_proposal'
);

create table moderation_auth_sessions (
  id dialektik_ulid primary key,
  user_id dialektik_ulid not null references users(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz(3) not null,
  expires_at timestamptz(3) not null,
  revoked_at timestamptz(3),
  constraint moderation_auth_sessions_time_order check (
    expires_at > created_at
    and (revoked_at is null or revoked_at >= created_at)
  )
);

create index moderation_auth_sessions_active_lookup
  on moderation_auth_sessions (token_hash, expires_at)
  where revoked_at is null;

create table moderation_review_proposals (
  id dialektik_ulid primary key,
  task_id dialektik_ulid not null references moderation_tasks(id),
  candidate_class_id dialektik_ulid not null references candidate_classes(id),
  outcome moderation_review_outcome not null,
  proposer_id dialektik_ulid not null references users(id),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  state moderation_review_proposal_state not null default 'submitted',
  submitted_at timestamptz(3) not null,
  decided_by dialektik_ulid references users(id),
  decided_at timestamptz(3),
  decision_reason text,
  constraint moderation_review_proposals_decision_coherent check (
    (state = 'submitted' and decided_by is null and decided_at is null and decision_reason is null)
    or
    (state = 'confirmed' and decided_by is not null and decided_at is not null and decision_reason is null)
    or
    (state = 'refused' and decided_by is not null and decided_at is not null
      and decision_reason is not null and btrim(decision_reason) <> '')
  ),
  constraint moderation_review_proposals_dual_control check (
    decided_by is null or decided_by <> proposer_id
  )
);

create unique index moderation_review_proposals_one_submitted_per_task
  on moderation_review_proposals (task_id)
  where state = 'submitted';

create table moderation_review_proposal_members (
  proposal_id dialektik_ulid not null,
  assertion_id dialektik_ulid not null references assertions(id),
  partition_ordinal integer check (partition_ordinal is null or partition_ordinal >= 1),
  primary key (proposal_id, assertion_id),
  foreign key (proposal_id) references moderation_review_proposals(id)
    deferrable initially deferred
);

create table moderation_command_receipts (
  actor_id dialektik_ulid not null references users(id),
  task_id dialektik_ulid not null references moderation_tasks(id),
  command_id dialektik_ulid not null,
  command_type moderation_command_type not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  response_payload jsonb not null,
  created_at timestamptz(3) not null,
  primary key (actor_id, task_id, command_id)
);

alter table relationships
  add column moderation_proposal_id dialektik_ulid references moderation_review_proposals(id);

create index relationships_moderation_proposal
  on relationships (moderation_proposal_id)
  where moderation_proposal_id is not null;

alter table candidate_classes
  add column origin_proposal_id dialektik_ulid references moderation_review_proposals(id);

create unique index candidate_classes_one_remainder_per_proposal
  on candidate_classes (origin_proposal_id)
  where origin_proposal_id is not null;

alter table moderation_tasks
  add column origin_proposal_id dialektik_ulid references moderation_review_proposals(id);

create unique index moderation_tasks_one_remainder_task_per_proposal
  on moderation_tasks (origin_proposal_id)
  where origin_proposal_id is not null;

create or replace function dialektik_set_audit_context(
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
    raise exception using errcode = '22004', message = 'audit correlation_id is required';
  end if;
  if request_actor_type <> 'system' and request_actor_id is null then
    raise exception using errcode = '22004', message = 'audit actor_id is required for a non-system actor';
  end if;
  if request_actor_id is not null then
    select role into stored_role from users where id = request_actor_id;
    if stored_role is null then
      raise exception using errcode = '23503', message = 'audit actor does not exist';
    end if;
    if stored_role::text <> request_actor_type::text then
      raise exception using errcode = '23514', message = 'audit actor type must match the stored user role';
    end if;
  end if;

  perform set_config('dialektik.actor_type', request_actor_type::text, true);
  perform set_config('dialektik.actor_id', coalesce(request_actor_id::text, ''), true);
  perform set_config('dialektik.correlation_id', request_correlation_id::text, true);
  perform set_config('dialektik.action_type', request_action::text, true);
  perform set_config('dialektik.reason_code', coalesce(request_reason_code, ''), true);
  perform set_config('dialektik.audit_metadata', '{}', true);
end;
$$;

create or replace function dialektik_require_audit_context(allowed_actions audit_action_type[])
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
    raise exception using errcode = '55000', message = 'protected mutation requires transaction-local audit context';
  end if;
  if context_actor_type not in ('user', 'moderator', 'editor', 'system', 'auditor')
    or (
      context_action::audit_action_type <> all(allowed_actions)
      and not (
        context_action = 'confirmed'
        and 'moderation_decision'::audit_action_type = any(allowed_actions)
      )
    ) then
    raise exception using errcode = '23514', message = 'audit context actor/action is not permitted for this mutation';
  end if;
  if context_actor_type = 'system'
    and context_action not in ('created', 'metadata_updated', 'requires_review') then
    raise exception using errcode = '42501', message = 'system actors cannot perform human-protected decisions';
  end if;
  if context_actor_type <> 'system' and nullif(context_actor_id, '') is null then
    raise exception using errcode = '22004', message = 'protected human mutation requires actor_id';
  end if;
  if nullif(context_actor_id, '') is not null then
    select role into stored_role from users where id = context_actor_id::dialektik_ulid;
    if stored_role is null or stored_role::text <> context_actor_type then
      raise exception using errcode = '23514', message = 'audit context actor no longer matches a stored user role';
    end if;
  end if;
end;
$$;

create or replace function dialektik_emit_audit(
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
  context_metadata jsonb;
begin
  perform dialektik_require_audit_context(allowed_actions);
  context_actor_type := current_setting('dialektik.actor_type')::audit_actor_type;
  context_actor_id := nullif(current_setting('dialektik.actor_id'), '')::dialektik_ulid;
  context_action := current_setting('dialektik.action_type')::audit_action_type;
  context_correlation := current_setting('dialektik.correlation_id')::dialektik_ulid;
  context_reason := nullif(current_setting('dialektik.reason_code', true), '');
  context_metadata := coalesce(
    nullif(current_setting('dialektik.audit_metadata', true), '')::jsonb,
    '{}'::jsonb
  );

  perform set_config('dialektik.audit_emitting', '1', true);
  insert into audit_entries (
    id, occurred_at, actor_type, actor_id, action_type, entity_type, entity_id,
    correlation_id, reason_code, before_hash, after_hash, metadata
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
    context_metadata
  );
  perform set_config('dialektik.audit_emitting', '', true);
end;
$$;

create function dialektik_require_phase6_actor(
  required_role user_role,
  expected_actor dialektik_ulid
)
returns void
language plpgsql
as $$
declare
  context_actor_id text := current_setting('dialektik.actor_id', true);
  context_actor_type text := current_setting('dialektik.actor_type', true);
  stored_role user_role;
begin
  if nullif(context_actor_id, '') is null
    or context_actor_id::dialektik_ulid <> expected_actor
    or context_actor_type <> required_role::text then
    raise exception using errcode = '42501', message = 'OD-12 actor capability denied';
  end if;
  select role into stored_role from users where id = expected_actor;
  if stored_role is distinct from required_role then
    raise exception using errcode = '42501', message = 'OD-12 persisted role no longer authorizes actor';
  end if;
end;
$$;

create function dialektik_guard_phase6_proposal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'moderation review proposals are retained history';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'submitted' then
      raise exception using errcode = '23514', message = 'new moderation proposal must be submitted, never pre-decided';
    end if;
    perform dialektik_require_audit_context(array['moderation_decision']::audit_action_type[]);
    perform dialektik_require_phase6_actor('moderator', new.proposer_id);
    return new;
  end if;

  if new.task_id <> old.task_id
    or new.candidate_class_id <> old.candidate_class_id
    or new.outcome <> old.outcome
    or new.proposer_id <> old.proposer_id
    or new.payload_hash <> old.payload_hash
    or new.submitted_at <> old.submitted_at then
    raise exception using errcode = '55000', message = 'submitted moderation proposal payload is immutable';
  end if;
  if old.state <> 'submitted' or new.state = 'submitted' then
    raise exception using errcode = '55000', message = 'terminal moderation proposal is immutable';
  end if;
  perform dialektik_require_audit_context(
    case new.state
      when 'confirmed' then array['confirmed']::audit_action_type[]
      else array['dismissed']::audit_action_type[]
    end
  );
  perform dialektik_require_phase6_actor('editor', new.decided_by);
  if new.decided_by = new.proposer_id then
    raise exception using errcode = '42501', message = 'moderation proposal requires a distinct editor confirmer';
  end if;
  return new;
end;
$$;

create trigger moderation_review_proposals_guarded
before insert or update or delete on moderation_review_proposals
for each row execute function dialektik_guard_phase6_proposal();

create function dialektik_audit_phase6_proposal()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_emit_audit(
    'ModerationReviewProposal',
    new.id::text,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    case
      when tg_op = 'INSERT' then array['moderation_decision']::audit_action_type[]
      when new.state = 'confirmed' then array['confirmed']::audit_action_type[]
      else array['dismissed']::audit_action_type[]
    end
  );
  return new;
end;
$$;

create trigger moderation_review_proposals_audited
after insert or update of state on moderation_review_proposals
for each row execute function dialektik_audit_phase6_proposal();

create function dialektik_preserve_phase6_proposal_members()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' or exists (
    select 1 from moderation_review_proposals proposal where proposal.id = new.proposal_id
  ) then
    raise exception using errcode = '55000', message = 'submitted moderation proposal members are immutable';
  end if;
  return new;
end;
$$;

create trigger moderation_review_proposal_members_immutable
before insert or update or delete on moderation_review_proposal_members
for each row execute function dialektik_preserve_phase6_proposal_members();

create function dialektik_preserve_moderation_command_receipt()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'moderation command receipts are immutable';
  end if;
  perform dialektik_require_audit_context(
    array['moderation_decision', 'confirmed', 'dismissed']::audit_action_type[]
  );
  perform dialektik_require_context_actor(new.actor_id);
  return new;
end;
$$;

create trigger moderation_command_receipts_immutable
before insert or update or delete on moderation_command_receipts
for each row execute function dialektik_preserve_moderation_command_receipt();

create function dialektik_guard_phase6_task_mutation()
returns trigger
language plpgsql
as $$
declare
  context_actor dialektik_ulid := nullif(current_setting('dialektik.actor_id', true), '')::dialektik_ulid;
  context_role text := current_setting('dialektik.actor_type', true);
  target_role user_role;
begin
  if old.task_type <> 'equivalence_review' or old.target_type <> 'CandidateClass' then
    return new;
  end if;
  if new.task_type <> old.task_type
    or new.target_type <> old.target_type
    or new.target_id is distinct from old.target_id
    or new.origin_proposal_id is distinct from old.origin_proposal_id then
    raise exception using errcode = '55000', message = 'equivalence-review task identity is immutable';
  end if;
  if new.state = 'rejected' then
    raise exception using errcode = '42501', message = 'REJECTED STATE SEMANTICS NOT AUTHORITATIVELY RESOLVED';
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform dialektik_require_audit_context(array['moderation_decision']::audit_action_type[]);
    if old.state not in ('pending', 'escalated') then
      raise exception using errcode = '23514', message = 'terminal moderation task assignment is immutable';
    end if;
    if exists (
      select 1 from moderation_review_proposals proposal
      where proposal.task_id = old.id and proposal.state = 'submitted'
    ) then
      raise exception using errcode = '23514', message = 'task assignment cannot change with a submitted proposal';
    end if;
    if new.assigned_to is not null then
      select role into target_role from users where id = new.assigned_to;
      if target_role is distinct from 'moderator'::user_role then
        raise exception using errcode = '42501', message = 'equivalence-review assignment requires a moderator';
      end if;
    end if;

    if context_role = 'moderator' then
      perform dialektik_require_phase6_actor('moderator', context_actor);
      if not (
        (old.state = 'pending' and new.state = old.state and old.assigned_to is null and new.assigned_to = context_actor)
        or
        (new.state = old.state and old.assigned_to = context_actor and new.assigned_to is null)
        or
        (old.state = 'pending' and new.state = 'escalated' and old.assigned_to = context_actor and new.assigned_to is null)
      ) then
        raise exception using errcode = '42501', message = 'moderator cannot take or rewrite another reviewer claim';
      end if;
    elsif context_role = 'editor' then
      perform dialektik_require_phase6_actor('editor', context_actor);
      if new.state <> old.state then
        raise exception using errcode = '42501', message = 'editor assignment action cannot change task state';
      end if;
    else
      raise exception using errcode = '42501', message = 'OD-12 task assignment capability denied';
    end if;
  end if;

  if new.state is distinct from old.state then
    if new.state = 'escalated' then
      if context_role <> 'moderator'
        or context_actor is distinct from old.assigned_to
        or old.state <> 'pending'
        or new.assigned_to is not null then
        raise exception using errcode = '42501', message = 'only the assigned moderator may explicitly escalate pending work';
      end if;
    elsif new.state in ('resolved', 'partially_accepted') then
      perform dialektik_require_phase6_actor('editor', context_actor);
      if current_setting('dialektik.action_type', true) <> 'confirmed'
        or not exists (
          select 1 from moderation_review_proposals proposal
          where proposal.task_id = old.id
            and proposal.state = 'confirmed'
            and proposal.decided_by = context_actor
        ) then
        raise exception using errcode = '42501', message = 'task completion requires the confirmed proposal transaction';
      end if;
    else
      raise exception using errcode = '42501', message = 'unsupported equivalence-review task transition';
    end if;
  end if;

  if new.state in ('pending', 'escalated') then
    if new.resolved_at is not null or new.resolution_reason is not null then
      raise exception using errcode = '23514', message = 'active moderation task cannot carry resolution metadata';
    end if;
  elsif new.resolved_at is null or new.resolution_reason is null then
    raise exception using errcode = '23514', message = 'terminal moderation task requires resolution metadata';
  end if;
  return new;
end;
$$;

create trigger phase6_equivalence_task_guarded
before update on moderation_tasks
for each row execute function dialektik_guard_phase6_task_mutation();

create function dialektik_audit_phase6_task_assignment()
returns trigger
language plpgsql
as $$
begin
  if old.task_type = 'equivalence_review'
    and old.target_type = 'CandidateClass'
    and new.assigned_to is distinct from old.assigned_to
    and new.state = old.state then
    perform dialektik_emit_audit(
      'ModerationTask', new.id::text, to_jsonb(old), to_jsonb(new),
      array['moderation_decision']::audit_action_type[]
    );
  end if;
  return new;
end;
$$;

create trigger phase6_equivalence_task_assignment_audited
after update of assigned_to on moderation_tasks
for each row execute function dialektik_audit_phase6_task_assignment();

create function dialektik_guard_phase6_candidate_state()
returns trigger
language plpgsql
as $$
declare
  context_actor dialektik_ulid := nullif(current_setting('dialektik.actor_id', true), '')::dialektik_ulid;
begin
  if new.state is not distinct from old.state then
    return new;
  end if;
  if new.state = 'rejected' then
    raise exception using errcode = '42501', message = 'REJECTED STATE SEMANTICS NOT AUTHORITATIVELY RESOLVED';
  end if;
  perform dialektik_require_phase6_actor('editor', context_actor);
  if current_setting('dialektik.action_type', true) <> 'confirmed'
    or not exists (
      select 1 from moderation_review_proposals proposal
      where proposal.candidate_class_id = old.id
        and proposal.state = 'confirmed'
        and proposal.decided_by = context_actor
    ) then
    raise exception using errcode = '42501', message = 'CandidateClass transition requires the confirmed proposal transaction';
  end if;
  return new;
end;
$$;

create trigger phase6_candidate_state_guarded
before update of state on candidate_classes
for each row execute function dialektik_guard_phase6_candidate_state();

create function dialektik_guard_phase6_r01a()
returns trigger
language plpgsql
as $$
declare
  proposal moderation_review_proposals%rowtype;
  proposer_role user_role;
  confirmer_role user_role;
begin
  if tg_op = 'DELETE' and old.moderation_proposal_id is not null then
    raise exception using errcode = '55000', message = 'confirmed moderation R01a is immutable';
  end if;
  if tg_op = 'UPDATE' and old.moderation_proposal_id is not null and new is distinct from old then
    raise exception using errcode = '55000', message = 'confirmed moderation R01a is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.rel_type = 'R01a' and new.publication_state = 'published'
    and new.moderation_proposal_id is null then
    raise exception using errcode = '42501', message = 'published R01a requires a confirmed moderation proposal';
  end if;
  if new.moderation_proposal_id is null then
    return new;
  end if;
  select * into proposal from moderation_review_proposals where id = new.moderation_proposal_id;
  select role into proposer_role from users where id = proposal.proposer_id;
  select role into confirmer_role from users where id = proposal.decided_by;
  if proposal.id is null
    or proposal.outcome <> 'accept_subset'
    or proposal.state <> 'confirmed'
    or proposal.proposer_id = proposal.decided_by
    or proposer_role <> 'moderator'
    or confirmer_role <> 'editor'
    or new.rel_type <> 'R01a'
    or new.publication_state <> 'published'
    or new.declared_by is distinct from proposal.proposer_id
    or new.confirmed_by is distinct from proposal.decided_by
    or new.confirmed_at is null
    or new.event_id <> (select event_id from candidate_classes where id = proposal.candidate_class_id)
    or new.scope <> 'intra_event'
    or new.confidence is not null
    or new.similarity_score is not null then
    raise exception using errcode = '23514', message = 'moderation R01a violates confirmed dual-control provenance';
  end if;
  return new;
end;
$$;

create trigger phase6_r01a_authority_guarded
before insert or update or delete on relationships
for each row execute function dialektik_guard_phase6_r01a();

create or replace function dialektik_require_nominal_relation_confidence()
returns trigger
language plpgsql
as $$
begin
  if new.moderation_proposal_id is not null then
    if new.confidence is not null then
      raise exception 'human-confirmed moderation R01a carries no model RelationConfidence';
    end if;
  elsif new.confidence is null and (tg_op = 'INSERT' or old.confidence is not null) then
    raise exception 'new proposed Relationship rows require nominal RelationConfidence';
  end if;
  return new;
end;
$$;

create or replace function dialektik_reject_linked_phase5_candidate_member_mutation()
returns trigger
language plpgsql
as $$
begin
  if (
    tg_op = 'INSERT'
    and exists (select 1 from assertion_similarity_run_candidate_classes link where link.candidate_class_id = new.candidate_class_id)
  ) or (
    tg_op = 'DELETE'
    and (
      exists (select 1 from assertion_similarity_run_candidate_classes link where link.candidate_class_id = old.candidate_class_id)
      or exists (select 1 from candidate_classes candidate where candidate.id = old.candidate_class_id and candidate.origin_proposal_id is not null)
    )
  ) or (
    tg_op = 'UPDATE'
    and (
      exists (select 1 from assertion_similarity_run_candidate_classes link where link.candidate_class_id in (old.candidate_class_id, new.candidate_class_id))
      or exists (select 1 from candidate_classes candidate where candidate.id in (old.candidate_class_id, new.candidate_class_id) and candidate.origin_proposal_id is not null)
    )
  ) then
    raise exception using errcode = '23514', message = 'review CandidateClass membership is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function dialektik_protect_linked_phase5_candidate()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from assertion_similarity_run_candidate_classes link where link.candidate_class_id = old.id
  ) or old.origin_proposal_id is not null then
    if tg_op = 'DELETE' then
      raise exception using errcode = '23514', message = 'review CandidateClass is immutable except for state';
    end if;
    if (to_jsonb(new) - 'state') is distinct from (to_jsonb(old) - 'state') then
      raise exception using errcode = '23514', message = 'review CandidateClass is immutable except for state';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function dialektik_reject_linked_phase5_endpoint_mutation()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' and exists (
    select 1 from assertion_similarity_run_relationships link
    where link.relationship_id = new.relationship_id
  )) or (tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from assertion_similarity_run_relationships link
    where link.relationship_id = old.relationship_id
       or (tg_op = 'UPDATE' and link.relationship_id = new.relationship_id)
  )) then
    raise exception using errcode = '23514', message = 'linked R01b endpoints are immutable';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from relationships relationship
    where relationship.id = old.relationship_id
      and relationship.moderation_proposal_id is not null
  ) then
    raise exception using errcode = '23514', message = 'confirmed moderation R01a endpoints are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function dialektik_assert_phase6_moderation_integrity()
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:phase6-moderation-integrity', 0));

  if exists (
    select 1
    from moderation_review_proposals proposal
    join moderation_tasks task on task.id = proposal.task_id
    join candidate_classes candidate on candidate.id = proposal.candidate_class_id
    join users proposer on proposer.id = proposal.proposer_id
    left join users decider on decider.id = proposal.decided_by
    where task.task_type <> 'equivalence_review'
      or task.target_type <> 'CandidateClass'
      or task.target_id is distinct from proposal.candidate_class_id
      or candidate.event_id is null
      or proposer.role <> 'moderator'
      or (proposal.state <> 'submitted' and (
        decider.role is distinct from 'editor'
        or proposal.decided_by = proposal.proposer_id
      ))
      or (proposal.state = 'submitted' and (
        task.state not in ('pending', 'escalated')
        or task.assigned_to is distinct from proposal.proposer_id
        or candidate.state <> 'proposed'
      ))
  ) then
    raise exception using errcode = '23514', message = 'moderation proposal task, candidate, assignment, or role integrity failed';
  end if;

  if exists (
    select 1
    from moderation_review_proposal_members member
    join moderation_review_proposals proposal on proposal.id = member.proposal_id
    left join candidate_class_members candidate_member
      on candidate_member.candidate_class_id = proposal.candidate_class_id
      and candidate_member.assertion_id = member.assertion_id
    where candidate_member.assertion_id is null
  ) then
    raise exception using errcode = '23514', message = 'proposal may contain only CandidateClass members';
  end if;

  if exists (
    select 1
    from moderation_review_proposals proposal
    where proposal.outcome = 'accept_subset'
      and (
        (select count(*) from moderation_review_proposal_members member where member.proposal_id = proposal.id) < 2
        or exists (
          select 1 from moderation_review_proposal_members member
          where member.proposal_id = proposal.id and member.partition_ordinal is not null
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'accept-subset requires at least two explicit unpartitioned members';
  end if;

  if exists (
    select 1
    from moderation_review_proposals proposal
    where proposal.outcome = 'split'
      and (
        exists (
          select 1 from moderation_review_proposal_members member
          where member.proposal_id = proposal.id and member.partition_ordinal is null
        )
        or (select count(*) from moderation_review_proposal_members member where member.proposal_id = proposal.id)
          <> (select count(*) from candidate_class_members member where member.candidate_class_id = proposal.candidate_class_id)
        or (select count(distinct member.partition_ordinal) from moderation_review_proposal_members member where member.proposal_id = proposal.id) < 2
        or (select min(member.partition_ordinal) from moderation_review_proposal_members member where member.proposal_id = proposal.id) <> 1
        or (select max(member.partition_ordinal) from moderation_review_proposal_members member where member.proposal_id = proposal.id)
          <> (select count(distinct member.partition_ordinal) from moderation_review_proposal_members member where member.proposal_id = proposal.id)
      )
  ) then
    raise exception using errcode = '23514', message = 'split requires an exact non-empty contiguous partition of CandidateClass members';
  end if;

  if exists (
    select 1
    from relationships relationship
    join moderation_review_proposals proposal on proposal.id = relationship.moderation_proposal_id
    join relationship_endpoints endpoint_a on endpoint_a.relationship_id = relationship.id and endpoint_a.endpoint_order = 1
    join relationship_endpoints endpoint_b on endpoint_b.relationship_id = relationship.id and endpoint_b.endpoint_order = 2
    left join moderation_review_proposal_members selected_a
      on selected_a.proposal_id = proposal.id and selected_a.assertion_id = endpoint_a.assertion_id
    left join moderation_review_proposal_members selected_b
      on selected_b.proposal_id = proposal.id and selected_b.assertion_id = endpoint_b.assertion_id
    where proposal.outcome <> 'accept_subset'
      or proposal.state <> 'confirmed'
      or selected_a.assertion_id is null
      or selected_b.assertion_id is null
      or selected_a.partition_ordinal is not null
      or selected_b.partition_ordinal is not null
  ) then
    raise exception using errcode = '23514', message = 'moderation R01a endpoints exceed the confirmed accept-subset';
  end if;

  if exists (
    with ordered_members as (
      select
        member.proposal_id,
        lag(member.assertion_id) over (partition by member.proposal_id order by member.assertion_id) as assertion_a_id,
        member.assertion_id as assertion_b_id
      from moderation_review_proposal_members member
      join moderation_review_proposals proposal on proposal.id = member.proposal_id
      where proposal.outcome = 'accept_subset' and proposal.state = 'confirmed'
    ),
    expected_pairs as (
      select * from ordered_members where assertion_a_id is not null
    ),
    actual_pairs as (
      select
        relationship.moderation_proposal_id as proposal_id,
        endpoint_a.assertion_id as assertion_a_id,
        endpoint_b.assertion_id as assertion_b_id
      from relationships relationship
      join relationship_endpoints endpoint_a on endpoint_a.relationship_id = relationship.id and endpoint_a.endpoint_order = 1
      join relationship_endpoints endpoint_b on endpoint_b.relationship_id = relationship.id and endpoint_b.endpoint_order = 2
      where relationship.moderation_proposal_id is not null
    )
    select 1 from expected_pairs expected
    full join actual_pairs actual
      on actual.proposal_id = expected.proposal_id
      and actual.assertion_a_id = expected.assertion_a_id
      and actual.assertion_b_id = expected.assertion_b_id
    where expected.proposal_id is null or actual.proposal_id is null
  ) then
    raise exception using errcode = '23514', message = 'confirmed accept-subset requires exactly its canonical R01a spanning edges';
  end if;

  if exists (
    select 1
    from moderation_review_proposals proposal
    join moderation_tasks task on task.id = proposal.task_id
    join candidate_classes candidate on candidate.id = proposal.candidate_class_id
    where proposal.state = 'confirmed'
      and (
        (proposal.outcome = 'split' and (task.state <> 'resolved' or candidate.state <> 'superseded'))
        or
        (proposal.outcome = 'accept_subset' and (
          case
            when (select count(*) from moderation_review_proposal_members member where member.proposal_id = proposal.id)
              = (select count(*) from candidate_class_members member where member.candidate_class_id = proposal.candidate_class_id)
              then task.state <> 'resolved' or candidate.state <> 'accepted'
            else task.state <> 'partially_accepted' or candidate.state <> 'partially_accepted'
          end
        ))
      )
  ) then
    raise exception using errcode = '23514', message = 'confirmed proposal and task/CandidateClass outcomes diverge';
  end if;

  if exists (
    select 1
    from candidate_classes remainder
    join moderation_review_proposals proposal on proposal.id = remainder.origin_proposal_id
    join candidate_classes original on original.id = proposal.candidate_class_id
    where proposal.outcome <> 'accept_subset'
      or proposal.state <> 'confirmed'
      or remainder.event_id <> original.event_id
      or remainder.model_ref <> original.model_ref
      or remainder.model_version <> original.model_version
      or remainder.state <> 'proposed'
      or exists (
        select 1 from candidate_class_members remainder_member
        where remainder_member.candidate_class_id = remainder.id
          and not exists (
            select 1 from candidate_class_members original_member
            where original_member.candidate_class_id = original.id
              and original_member.assertion_id = remainder_member.assertion_id
              and not exists (
                select 1 from moderation_review_proposal_members selected
                where selected.proposal_id = proposal.id
                  and selected.assertion_id = remainder_member.assertion_id
              )
          )
      )
      or (select count(*) from candidate_class_members member where member.candidate_class_id = remainder.id)
        <> (
          select count(*) from candidate_class_members original_member
          where original_member.candidate_class_id = original.id
            and not exists (
              select 1 from moderation_review_proposal_members selected
              where selected.proposal_id = proposal.id
                and selected.assertion_id = original_member.assertion_id
            )
        )
  ) then
    raise exception using errcode = '23514', message = 'derived remainder CandidateClass must equal the exact unselected set';
  end if;

  if exists (
    select 1
    from moderation_review_proposals proposal
    where proposal.state = 'confirmed'
      and proposal.outcome = 'accept_subset'
      and (
        case
          when (
            (select count(*) from candidate_class_members original_member where original_member.candidate_class_id = proposal.candidate_class_id)
            - (select count(*) from moderation_review_proposal_members selected where selected.proposal_id = proposal.id)
          ) >= 2 then
            (select count(*) from candidate_classes remainder where remainder.origin_proposal_id = proposal.id) <> 1
            or (select count(*) from moderation_tasks task where task.origin_proposal_id = proposal.id) <> 1
          else
            exists (select 1 from candidate_classes remainder where remainder.origin_proposal_id = proposal.id)
            or exists (select 1 from moderation_tasks task where task.origin_proposal_id = proposal.id)
        end
      )
  ) then
    raise exception using errcode = '23514', message = 'partial accept-subset remainder provenance is incomplete';
  end if;

  if exists (
    select 1
    from moderation_tasks task
    join candidate_classes candidate on candidate.origin_proposal_id = task.origin_proposal_id
    where task.origin_proposal_id is not null
      and (
        task.task_type <> 'equivalence_review'
        or task.target_type <> 'CandidateClass'
        or task.target_id is distinct from candidate.id
      )
  ) then
    raise exception using errcode = '23514', message = 'derived remainder task target is invalid';
  end if;
end;
$$;

create function dialektik_validate_phase6_moderation_integrity()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_phase6_moderation_integrity();
  return null;
end;
$$;

create constraint trigger moderation_review_proposals_integrity
after insert or update or delete on moderation_review_proposals
deferrable initially deferred
for each row execute function dialektik_validate_phase6_moderation_integrity();

create constraint trigger moderation_review_proposal_members_integrity
after insert or update or delete on moderation_review_proposal_members
deferrable initially deferred
for each row execute function dialektik_validate_phase6_moderation_integrity();

create constraint trigger moderation_relationships_integrity
after insert or update or delete on relationships
deferrable initially deferred
for each row execute function dialektik_validate_phase6_moderation_integrity();

create constraint trigger moderation_relationship_endpoints_integrity
after insert or update or delete on relationship_endpoints
deferrable initially deferred
for each row execute function dialektik_validate_phase6_moderation_integrity();

create constraint trigger moderation_candidate_classes_integrity
after insert or update or delete on candidate_classes
deferrable initially deferred
for each row execute function dialektik_validate_phase6_moderation_integrity();

create constraint trigger moderation_candidate_members_integrity
after insert or update or delete on candidate_class_members
deferrable initially deferred
for each row execute function dialektik_validate_phase6_moderation_integrity();

create constraint trigger moderation_tasks_integrity
after insert or update or delete on moderation_tasks
deferrable initially deferred
for each row execute function dialektik_validate_phase6_moderation_integrity();
`;

export const phase6ModerationAuthorityMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_6_MODERATION_AUTHORITY_SQL).execute(database);
  },
};
