import { sql, type Migration } from 'kysely';

/**
 * Closes an adversarial exactness gap left by migration 012. The existing
 * deferred integrity function verifies every canonical edge but a duplicated
 * matching edge could join the same expected row twice. This independent
 * count invariant makes the confirmed spanning set exact.
 */
const PHASE_6_AUTHORITY_HARDENING_SQL = String.raw`
create function dialektik_assert_phase6_r01a_edge_count()
returns void
language plpgsql
as $$
begin
  if exists (
    select 1
    from moderation_review_proposals proposal
    where proposal.outcome = 'accept_subset'
      and proposal.state = 'confirmed'
      and (
        select count(*)
        from relationships relationship
        where relationship.moderation_proposal_id = proposal.id
      ) <> (
        select greatest(count(*) - 1, 0)
        from moderation_review_proposal_members member
        where member.proposal_id = proposal.id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'confirmed accept-subset requires an exact canonical R01a edge count';
  end if;
end;
$$;

create function dialektik_validate_phase6_r01a_edge_count()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_phase6_r01a_edge_count();
  return null;
end;
$$;

create constraint trigger moderation_proposals_r01a_edge_count
after insert or update or delete on moderation_review_proposals
deferrable initially deferred
for each row execute function dialektik_validate_phase6_r01a_edge_count();

create constraint trigger moderation_relationships_r01a_edge_count
after insert or update or delete on relationships
deferrable initially deferred
for each row execute function dialektik_validate_phase6_r01a_edge_count();

create constraint trigger moderation_endpoints_r01a_edge_count
after insert or update or delete on relationship_endpoints
deferrable initially deferred
for each row execute function dialektik_validate_phase6_r01a_edge_count();

select dialektik_assert_phase6_r01a_edge_count();
`;

export const phase6AuthorityHardeningMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_6_AUTHORITY_HARDENING_SQL).execute(database);
  },
};
