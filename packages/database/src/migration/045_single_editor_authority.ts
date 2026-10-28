import { sql, type Migration } from "kysely";

/** Explicit, revocable authority for a single human editor. */
const SINGLE_EDITOR_SQL = String.raw`
create table if not exists public.editorial_single_editor_authorizations (
  id dialektik_ulid primary key,
  editor_user_id dialektik_ulid not null references public.users(id),
  decision_reference text not null check (length(btrim(decision_reference)) between 1 and 500),
  granted_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint editorial_single_editor_revocation_order
    check (revoked_at is null or revoked_at >= granted_at)
);

do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'editorial_single_editor_authorizations') <> 5
    or (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'editorial_single_editor_authorizations'
      and ((column_name in ('id','editor_user_id') and domain_name = 'dialektik_ulid' and is_nullable = 'NO')
        or (column_name = 'decision_reference' and data_type = 'text' and is_nullable = 'NO')
        or (column_name = 'granted_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO')
        or (column_name = 'revoked_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES'))) <> 5
    or exists (select 1 from (values
        ('editorial_single_editor_authorizations_pkey', 'PRIMARY KEY (id)'),
        ('editorial_single_editor_authorizations_editor_user_id_fkey', 'FOREIGN KEY (editor_user_id) REFERENCES users(id)'),
        ('editorial_single_editor_authorizations_decision_reference_check', 'CHECK (((length(btrim(decision_reference)) >= 1) AND (length(btrim(decision_reference)) <= 500)))'),
        ('editorial_single_editor_revocation_order', 'CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at)))')
      ) expected(name, definition) where not exists (
        select 1 from pg_constraint c where c.conrelid = 'public.editorial_single_editor_authorizations'::regclass
          and c.conname = expected.name and c.convalidated
          and pg_get_constraintdef(c.oid) = expected.definition
      )) then
    raise exception 'Existing single editor authorization table has an incompatible schema';
  end if;
end
$$;

-- The chosen configuration has exactly one active single-editor authority.
create unique index if not exists editorial_single_editor_one_active
  on public.editorial_single_editor_authorizations ((true))
  where revoked_at is null;
do $$
begin
  if not exists (select 1 from pg_index i
    where i.indexrelid = 'public.editorial_single_editor_one_active'::regclass
      and i.indrelid = 'public.editorial_single_editor_authorizations'::regclass
      and i.indisunique and i.indisvalid and i.indnkeyatts = 1
      and pg_get_expr(i.indexprs, i.indrelid) = 'true'
      and pg_get_expr(i.indpred, i.indrelid) = '(revoked_at IS NULL)') then
    raise exception 'Existing single editor authorization index has unexpected behavior';
  end if;
end
$$;

alter table public.editorial_single_editor_authorizations enable row level security;
revoke all on table public.editorial_single_editor_authorizations from public, anon, authenticated, dialektik_core_app;
grant select on table public.editorial_single_editor_authorizations to dialektik_core_app;
do $$
declare p record;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.editorial_single_editor_authorizations from service_role;
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.editorial_single_editor_authorizations'::regclass
    and polname <> 'editorial_single_editor_core_read') then
    raise exception 'Unexpected single editor authorization policy';
  end if;
  select polcmd, polroles, pg_get_expr(polqual, polrelid) as condition into p
    from pg_policy where polrelid = 'public.editorial_single_editor_authorizations'::regclass
      and polname = 'editorial_single_editor_core_read';
  if not found then
    create policy editorial_single_editor_core_read on public.editorial_single_editor_authorizations
      for select to dialektik_core_app using (true);
  elsif p.polcmd <> 'r' or p.polroles <> array['dialektik_core_app'::regrole::oid]
    or p.condition <> 'true' then
    raise exception 'Existing single editor authorization policy has unexpected permissions';
  end if;
end
$$;

-- An authorization is retained as provenance; the sole permitted mutation is
-- an irreversible revocation by the out-of-band administrator.
create or replace function public.dialektik_guard_single_editor_authorization()
returns trigger language plpgsql as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = '55000', message = 'single editor authorizations are retained history';
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from public.users
      where id = new.editor_user_id and role = 'editor') then
      raise exception using errcode = '23514', message = 'single editor authorization requires an editor';
    end if;
    if new.revoked_at is not null then
      raise exception using errcode = '23514', message = 'new single editor authorization cannot be pre-revoked';
    end if;
    return new;
  end if;
  if old.revoked_at is not null or new.revoked_at is null
    or (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
    raise exception using errcode = '55000', message = 'single editor authorization is immutable except for revocation';
  end if;
  return new;
end;
$$;
do $$
begin
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.editorial_single_editor_authorizations'::regclass
    and t.tgname = 'editorial_single_editor_authorization_guarded' and not t.tgisinternal
    and (t.tgfoid <> 'public.dialektik_guard_single_editor_authorization()'::regprocedure
      or t.tgtype <> 31 or t.tgenabled <> 'O')) then
    raise exception 'Existing single editor authorization trigger has unexpected behavior';
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.editorial_single_editor_authorizations'::regclass
    and t.tgname = 'editorial_single_editor_authorizations_no_truncate' and not t.tgisinternal
    and (t.tgfoid <> 'public.dialektik_guard_single_editor_authorization()'::regprocedure
      or t.tgtype <> 34 or t.tgenabled <> 'O')) then
    raise exception 'Existing single editor no-truncate trigger has unexpected behavior';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.editorial_single_editor_authorizations'::regclass
    and t.tgname = 'editorial_single_editor_authorization_guarded' and not t.tgisinternal) then
    create trigger editorial_single_editor_authorization_guarded
      before insert or update or delete on public.editorial_single_editor_authorizations
      for each row execute function public.dialektik_guard_single_editor_authorization();
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.editorial_single_editor_authorizations'::regclass
    and t.tgname = 'editorial_single_editor_authorizations_no_truncate' and not t.tgisinternal) then
    create trigger editorial_single_editor_authorizations_no_truncate
      before truncate on public.editorial_single_editor_authorizations
      for each statement execute function public.dialektik_guard_single_editor_authorization();
  end if;
end
$$;

alter table public.moderation_review_proposals
  add column if not exists single_editor_authorization_id dialektik_ulid
    references public.editorial_single_editor_authorizations(id);

-- Replace the old two-person-only check with a mode-aware check atomically.
-- A null authorization preserves the original distinct moderator/editor rule.
do $$
begin
  if not exists (select 1 from pg_constraint c
    where c.conrelid = 'public.moderation_review_proposals'::regclass
      and c.conname = 'moderation_review_proposals_single_editor_authorization_id_fkey'
      and c.contype = 'f' and c.confrelid = 'public.editorial_single_editor_authorizations'::regclass
      and c.conkey = array[(select attnum from pg_attribute
        where attrelid = c.conrelid and attname = 'single_editor_authorization_id')]) then
    raise exception 'Single editor authorization reference is missing or unexpected';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.moderation_review_proposals'::regclass
      and conname = 'moderation_review_proposals_dual_control')
    and not exists (select 1 from pg_constraint where conrelid = 'public.moderation_review_proposals'::regclass
      and conname = 'moderation_review_proposals_decision_authority') then
    alter table public.moderation_review_proposals drop constraint moderation_review_proposals_dual_control;
    alter table public.moderation_review_proposals
      add constraint moderation_review_proposals_decision_authority check (
        decided_by is null
        or (single_editor_authorization_id is null and decided_by <> proposer_id)
        or (single_editor_authorization_id is not null and decided_by = proposer_id)
      );
  elsif exists (select 1 from pg_constraint where conrelid = 'public.moderation_review_proposals'::regclass
      and conname = 'moderation_review_proposals_dual_control')
    or not exists (select 1 from pg_constraint where conrelid = 'public.moderation_review_proposals'::regclass
      and conname = 'moderation_review_proposals_decision_authority' and convalidated
      and pg_get_constraintdef(oid) = 'CHECK (((decided_by IS NULL) OR ((single_editor_authorization_id IS NULL) AND ((decided_by)::text <> (proposer_id)::text)) OR ((single_editor_authorization_id IS NOT NULL) AND ((decided_by)::text = (proposer_id)::text))))') then
    raise exception 'Existing moderation decision constraint has unexpected behavior';
  end if;
end
$$;

create or replace function dialektik_guard_phase6_proposal()
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
    if new.single_editor_authorization_id is null then
      perform dialektik_require_phase6_actor('moderator', new.proposer_id);
    else
      perform dialektik_require_phase6_actor('editor', new.proposer_id);
      if not exists (
        select 1 from editorial_single_editor_authorizations authority_grant
        where authority_grant.id = new.single_editor_authorization_id
          and authority_grant.editor_user_id = new.proposer_id
          and authority_grant.revoked_at is null
      ) then
        raise exception using errcode = '42501', message = 'single editor authorization is not active';
      end if;
    end if;
    return new;
  end if;

  if new.task_id <> old.task_id
    or new.candidate_class_id <> old.candidate_class_id
    or new.outcome <> old.outcome
    or new.proposer_id <> old.proposer_id
    or new.payload_hash <> old.payload_hash
    or new.submitted_at <> old.submitted_at
    or new.single_editor_authorization_id is distinct from old.single_editor_authorization_id then
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
  if new.single_editor_authorization_id is null then
    if new.decided_by = new.proposer_id then
      raise exception using errcode = '42501', message = 'dual-control proposal requires a distinct editor';
    end if;
  elsif new.decided_by is distinct from new.proposer_id or not exists (
    select 1 from editorial_single_editor_authorizations authority_grant
    where authority_grant.id = new.single_editor_authorization_id
      and authority_grant.editor_user_id = new.proposer_id
      and authority_grant.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'single editor authorization is not active for this decision';
  end if;
  return new;
end;
$$;

create or replace function dialektik_guard_phase6_task_mutation()
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
      if target_role is distinct from 'moderator'::user_role
        and not (
          target_role = 'editor'::user_role and context_role = 'editor'
          and new.assigned_to = context_actor
          and exists (
            select 1 from editorial_single_editor_authorizations authority_grant
            where authority_grant.editor_user_id = context_actor
              and authority_grant.revoked_at is null
          )
        ) then
        raise exception using errcode = '42501', message = 'assignment requires a moderator or authorized single editor';
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

create or replace function dialektik_guard_phase6_r01a()
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
    or confirmer_role is distinct from 'editor'::user_role
    or not (
      (proposal.single_editor_authorization_id is null
        and proposal.proposer_id <> proposal.decided_by
        and proposer_role = 'moderator'::user_role)
      or
      (proposal.single_editor_authorization_id is not null
        and proposal.proposer_id = proposal.decided_by
        and proposer_role = 'editor'::user_role
        and exists (
          select 1 from editorial_single_editor_authorizations authority_grant
          where authority_grant.id = proposal.single_editor_authorization_id
            and authority_grant.editor_user_id = proposal.proposer_id
        ))
    )
    or new.rel_type <> 'R01a'
    or new.publication_state <> 'published'
    or new.declared_by is distinct from proposal.proposer_id
    or new.confirmed_by is distinct from proposal.decided_by
    or new.confirmed_at is null
    or new.event_id <> (select event_id from candidate_classes where id = proposal.candidate_class_id)
    or new.scope <> 'intra_event'
    or new.confidence is not null
    or new.similarity_score is not null then
    raise exception using errcode = '23514', message = 'moderation R01a violates confirmed review provenance';
  end if;
  return new;
end;
$$;

create or replace function dialektik_assert_phase6_moderation_integrity()
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
      or (proposal.single_editor_authorization_id is null and (
        proposer.role <> 'moderator'
        or (proposal.state <> 'submitted' and (
          decider.role is distinct from 'editor'
          or proposal.decided_by = proposal.proposer_id
        ))
      ))
      or (proposal.single_editor_authorization_id is not null and (
        proposer.role <> 'editor'
        or not exists (
          select 1 from editorial_single_editor_authorizations authority_grant
          where authority_grant.id = proposal.single_editor_authorization_id
            and authority_grant.editor_user_id = proposal.proposer_id
        )
        or (proposal.state <> 'submitted' and (
          decider.role is distinct from 'editor'
          or proposal.decided_by is distinct from proposal.proposer_id
        ))
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

-- Ensure existing proposal history still satisfies the revised invariants.
select dialektik_assert_phase6_moderation_integrity();
select dialektik_assert_phase6_r01a_edge_count();
`;

export const singleEditorAuthorityMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SINGLE_EDITOR_SQL).execute(database);
  },
  down(): Promise<void> {
    throw new Error("Single-editor authority history is forward-only.");
  },
};
