import { sql, type Migration } from 'kysely';

/**
 * Phase 6 safety below OD-12. This migration protects provider-free Phase-5
 * review inputs and prevents duplicate active queue work. It deliberately does
 * not authorize or implement a moderation outcome.
 */
const PHASE_6_MODERATION_SAFETY_SQL = String.raw`
create function dialektik_reject_linked_phase5_candidate_member_mutation()
returns trigger
language plpgsql
as $$
declare
  affected_candidate_id dialektik_ulid;
begin
  affected_candidate_id := case when tg_op = 'DELETE'
    then old.candidate_class_id else new.candidate_class_id end;

  if exists (
    select 1
    from assertion_similarity_run_candidate_classes link
    where link.candidate_class_id = affected_candidate_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 linked CandidateClass membership is immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger phase5_linked_candidate_members_immutable
before insert or update or delete on candidate_class_members
for each row execute function dialektik_reject_linked_phase5_candidate_member_mutation();

create function dialektik_protect_linked_phase5_candidate()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from assertion_similarity_run_candidate_classes link
    where link.candidate_class_id = old.id
  ) then
    if tg_op = 'DELETE' then
      raise exception using
        errcode = '23514',
        message = 'Phase 5 linked CandidateClass is immutable except for state';
    end if;

    if (to_jsonb(new) - 'state') is distinct from (to_jsonb(old) - 'state') then
      raise exception using
        errcode = '23514',
        message = 'Phase 5 linked CandidateClass is immutable except for state';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger phase5_linked_candidates_protected
before update or delete on candidate_classes
for each row execute function dialektik_protect_linked_phase5_candidate();

create function dialektik_reject_linked_phase5_relationship_mutation()
returns trigger
language plpgsql
as $$
declare
  affected_relationship_id dialektik_ulid;
begin
  affected_relationship_id := case when tg_op = 'DELETE'
    then old.id else new.id end;

  if exists (
    select 1
    from assertion_similarity_run_relationships link
    where link.relationship_id = affected_relationship_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 linked R01b relationship is immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger phase5_linked_relationships_immutable
before update or delete on relationships
for each row execute function dialektik_reject_linked_phase5_relationship_mutation();

create function dialektik_reject_linked_phase5_endpoint_mutation()
returns trigger
language plpgsql
as $$
declare
  affected_relationship_id dialektik_ulid;
begin
  affected_relationship_id := case when tg_op = 'DELETE'
    then old.relationship_id else new.relationship_id end;

  if exists (
    select 1
    from assertion_similarity_run_relationships link
    where link.relationship_id = affected_relationship_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 linked R01b endpoints are immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger phase5_linked_relationship_endpoints_immutable
before insert or update or delete on relationship_endpoints
for each row execute function dialektik_reject_linked_phase5_endpoint_mutation();

create unique index moderation_tasks_one_active_equivalence_review
  on moderation_tasks (target_id)
  where target_type = 'CandidateClass'
    and task_type = 'equivalence_review'
    and state in ('pending', 'escalated');
`;

export const phase6ModerationSafetyMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_6_MODERATION_SAFETY_SQL).execute(database);
  },
};
