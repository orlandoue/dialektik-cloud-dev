import { sql, type Migration } from 'kysely';

const PHASE_1B_HARDENING_SQL = String.raw`
alter table claim_spans
  add constraint claim_spans_primary_position_is_derived
  check (primary_position_id is null);

create function dialektik_lock_phase_1b_graph()
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('dialektik:phase-1b-relationship-graph', 0)
  );
end;
$$;

create function dialektik_assert_relationship_endpoint_cardinality()
returns void
language plpgsql
as $$
begin
  perform dialektik_lock_phase_1b_graph();
  if exists (
    select 1
    from relationships relationship_row
    left join relationship_endpoints endpoint
      on endpoint.relationship_id = relationship_row.id
    group by relationship_row.id
    having count(endpoint.assertion_id) <> 2
  ) then
    raise exception using
      errcode = '23514',
      message = 'every current v1 relationship requires exactly two endpoints';
  end if;
end;
$$;

create function dialektik_validate_relationship_endpoint_cardinality()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_relationship_endpoint_cardinality();
  return null;
end;
$$;

create constraint trigger relationships_have_exactly_two_endpoints
after insert or update or delete on relationships
deferrable initially deferred
for each row execute function dialektik_validate_relationship_endpoint_cardinality();
create constraint trigger relationship_endpoints_preserve_exact_cardinality
after insert or update or delete on relationship_endpoints
deferrable initially deferred
for each row execute function dialektik_validate_relationship_endpoint_cardinality();

create function dialektik_assert_position_formation()
returns void
language plpgsql
as $$
begin
  perform dialektik_lock_phase_1b_graph();

  if exists (
    select 1
    from positions position_row
    where not exists (
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
  ) then
    raise exception using
      errcode = '23514',
      message = 'position requires non-empty published human R01a formation';
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
      message = 'position membership must remain inside the same Event';
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
      where relationship_row.rel_type = 'R01a'
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
    where assertion_row.position_id is not null
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
      message = 'position membership must equal its published R01a closure';
  end if;
end;
$$;

create or replace function dialektik_validate_position_formation()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_position_formation();
  return null;
end;
$$;

create constraint trigger assertions_preserve_position_closure
after insert or update or delete on assertions
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();
create constraint trigger articles_preserve_position_event
after update of event_id or delete on articles
deferrable initially deferred
for each row execute function dialektik_validate_position_formation();

create function dialektik_assert_position_title_provenance()
returns void
language plpgsql
as $$
begin
  perform dialektik_lock_phase_1b_graph();
  if exists (
    select 1
    from position_title_generated_from provenance
    join positions position_row on position_row.id = provenance.position_id
    join assertions assertion_row on assertion_row.id = provenance.assertion_id
    join claim_spans span_row on span_row.id = assertion_row.claim_span_id
    join articles article_row on article_row.id = span_row.article_id
    where assertion_row.position_id is distinct from position_row.id
      or article_row.event_id is distinct from position_row.event_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'position title provenance requires an Assertion from the same Position and Event';
  end if;
end;
$$;

create function dialektik_validate_position_title_provenance()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_position_title_provenance();
  return null;
end;
$$;

create constraint trigger position_title_sources_match_position
after insert or update or delete on position_title_generated_from
deferrable initially deferred
for each row execute function dialektik_validate_position_title_provenance();
create constraint trigger assertions_preserve_position_title_provenance
after insert or update or delete on assertions
deferrable initially deferred
for each row execute function dialektik_validate_position_title_provenance();
create constraint trigger positions_preserve_title_provenance_event
after update of event_id or delete on positions
deferrable initially deferred
for each row execute function dialektik_validate_position_title_provenance();
create constraint trigger articles_preserve_title_provenance_event
after update of event_id or delete on articles
deferrable initially deferred
for each row execute function dialektik_validate_position_title_provenance();

select dialektik_assert_relationship_endpoint_cardinality();
select dialektik_assert_position_formation();
select dialektik_assert_position_title_provenance();
`;

export const phase1bPersistenceHardeningMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_1B_HARDENING_SQL).execute(database);
  },
};
