import { sql, type Migration } from 'kysely';

/**
 * Closes UPDATE re-parenting gaps in the Phase-6 snapshot guards. Both the old
 * and new parent identities must be checked: protecting only NEW would allow a
 * row to leave linked Phase-5 history when the remaining class stayed valid.
 */
const PHASE_6_SNAPSHOT_REPARENT_HARDENING_SQL = String.raw`
create or replace function dialektik_reject_linked_phase5_candidate_member_mutation()
returns trigger
language plpgsql
as $$
begin
  if (
    tg_op = 'INSERT'
    and exists (
      select 1 from assertion_similarity_run_candidate_classes link
      where link.candidate_class_id = new.candidate_class_id
    )
  ) or (
    tg_op = 'DELETE'
    and exists (
      select 1 from assertion_similarity_run_candidate_classes link
      where link.candidate_class_id = old.candidate_class_id
    )
  ) or (
    tg_op = 'UPDATE'
    and exists (
      select 1 from assertion_similarity_run_candidate_classes link
      where link.candidate_class_id = old.candidate_class_id
         or link.candidate_class_id = new.candidate_class_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 linked CandidateClass membership is immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function dialektik_reject_linked_phase5_relationship_mutation()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from assertion_similarity_run_relationships link
    where link.relationship_id = old.id
       or (tg_op = 'UPDATE' and link.relationship_id = new.id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 linked R01b relationship is immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function dialektik_reject_linked_phase5_endpoint_mutation()
returns trigger
language plpgsql
as $$
begin
  if (
    tg_op = 'INSERT'
    and exists (
      select 1 from assertion_similarity_run_relationships link
      where link.relationship_id = new.relationship_id
    )
  ) or (
    tg_op = 'DELETE'
    and exists (
      select 1 from assertion_similarity_run_relationships link
      where link.relationship_id = old.relationship_id
    )
  ) or (
    tg_op = 'UPDATE'
    and exists (
      select 1 from assertion_similarity_run_relationships link
      where link.relationship_id = old.relationship_id
         or link.relationship_id = new.relationship_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 5 linked R01b endpoints are immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
`;

export const phase6SnapshotReparentHardeningMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_6_SNAPSHOT_REPARENT_HARDENING_SQL).execute(database);
  },
};
