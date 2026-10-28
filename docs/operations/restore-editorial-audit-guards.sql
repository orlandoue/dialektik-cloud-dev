-- Applied to dialektik-dev on 2026-10-28 UTC. Retained for review and recovery.
-- Restore editorial audit, attribution and graph guards from repository migrations.
-- Refuses to replace any function whose inspected no-op has changed.
-- Checks existing global graph invariants before installation. No existing
-- content or publications are modified. The position-formation guard is
-- intentionally separate: eight existing positions lack the required formation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  name text;
  body text;
begin
  foreach name in array array[
    'dialektik_audit_protected_mutation',
    'dialektik_preserve_event_merge_history',
    'dialektik_preserve_primary_fact_source',
    'dialektik_prevent_article_original_mutation',
    'dialektik_validate_article_syndication',
    'dialektik_validate_candidate_member',
    'dialektik_validate_event_merge_lineage',
    'dialektik_validate_event_publication',
    'dialektik_validate_moderation_targets',
    'dialektik_validate_position_title_provenance',
    'dialektik_validate_relationship_endpoint_matrix',
    'dialektik_validate_sensitive_actors'
  ] loop
    select p.prosrc into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = name
      and p.pronargs = 0 and p.prorettype = 'pg_catalog.trigger'::regtype;
    if body is null or regexp_replace(lower(body), '[[:space:]]', '', 'g') <> 'beginreturnnew;end;' then
      raise exception 'Cannot restore %: expected inspected no-op definition', name;
    end if;
  end loop;
  if exists (select 1 from public.events e where (e.analysis_state = 'PUBLISHED') is distinct from exists
    (select 1 from public.positions p where p.event_id = e.id and p.publication_state = 'published')) then
    raise exception 'Event and published position states need reconciliation first';
  end if;
  if exists (select 1 from public.moderation_tasks) then
    raise exception 'Moderation targets need a fresh preflight before restoration';
  end if;
  perform public.dialektik_assert_candidate_members();
  perform public.dialektik_assert_relationship_endpoint_matrix();
  perform public.dialektik_assert_position_title_provenance();
end
$$;

-- 003_phase_1c_closure.ts
create or replace function public.dialektik_audit_protected_mutation()
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

-- 001_initial_schema.ts
create or replace function public.dialektik_preserve_event_merge_history()
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

-- 001_initial_schema.ts
create or replace function public.dialektik_preserve_primary_fact_source()
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

-- 001_initial_schema.ts
create or replace function public.dialektik_prevent_article_original_mutation()
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

-- 001_initial_schema.ts
create or replace function public.dialektik_validate_article_syndication()
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

-- 003_phase_1c_closure.ts
create or replace function public.dialektik_validate_candidate_member()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_candidate_members();
  return null;
end;
$$;

-- 001_initial_schema.ts
create or replace function public.dialektik_validate_event_merge_lineage()
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

-- 001_initial_schema.ts
create or replace function public.dialektik_validate_event_publication()
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

-- 003_phase_1c_closure.ts
create or replace function public.dialektik_validate_moderation_targets()
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

-- 002_phase_1b_persistence_hardening.ts
create or replace function public.dialektik_validate_position_title_provenance()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_position_title_provenance();
  return null;
end;
$$;

-- 003_phase_1c_closure.ts
create or replace function public.dialektik_validate_relationship_endpoint_matrix()
returns trigger
language plpgsql
as $$
begin
  perform dialektik_assert_relationship_endpoint_matrix();
  return null;
end;
$$;

-- 001_initial_schema.ts
create or replace function public.dialektik_validate_sensitive_actors()
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

commit;
