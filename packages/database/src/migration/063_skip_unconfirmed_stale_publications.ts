import { sql, type Migration } from "kysely";

const DDL = String.raw`
create or replace function public.dialektik_mark_stale_contradiction_publications()
returns trigger
language plpgsql
set search_path=pg_catalog,public,extensions
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
    select publication.id,publication.event_id,publication.position_a_id,publication.position_b_id,
      publication.projection_hash as published_hash,current_projection.projection_hash as current_hash
    from contradiction_publications publication
    left join position_relation_projections current_projection
      on current_projection.event_id=publication.event_id
      and current_projection.position_a_id=publication.position_a_id
      and current_projection.position_b_id=publication.position_b_id
    where publication.publication_state='published'
      and publication.confirmed_by is not null
      and publication.confirmed_at is not null
      and (current_projection.projection_hash is distinct from publication.projection_hash
        or current_projection.requires_review
        or not coalesce(current_projection.publication_eligible,false))
  loop
    generated_correlation := dialektik_generate_ulid();
    perform dialektik_set_audit_context(
      'system',null,generated_correlation,'requires_review','projection_hash_changed'
    );
    update contradiction_publications
      set publication_state='requires_review' where id=stale_publication.id;
    if not exists (
      select 1 from moderation_tasks task
      where task.target_type='PositionRelationProjection'
        and task.task_type='projection_stale_review'
        and task.projection_event_id=stale_publication.event_id
        and task.projection_position_a_id=stale_publication.position_a_id
        and task.projection_position_b_id=stale_publication.position_b_id
        and task.state in ('pending','partially_accepted','escalated')
    ) then
      insert into moderation_tasks(id,task_type,target_type,target_id,state,priority,assigned_to,created_at,
        resolved_at,resolution_reason,projection_event_id,projection_position_a_id,projection_position_b_id,
        projection_hash)
      values(dialektik_generate_ulid(),'projection_stale_review','PositionRelationProjection',null,'pending',0,null,
        clock_timestamp(),null,null,stale_publication.event_id,stale_publication.position_a_id,
        stale_publication.position_b_id,coalesce(stale_publication.current_hash,stale_publication.published_hash));
    end if;
  end loop;
  perform set_config('dialektik.actor_type',coalesce(previous_actor_type,''),true);
  perform set_config('dialektik.actor_id',coalesce(previous_actor_id,''),true);
  perform set_config('dialektik.correlation_id',coalesce(previous_correlation,''),true);
  perform set_config('dialektik.action_type',coalesce(previous_action,''),true);
  perform set_config('dialektik.reason_code',coalesce(previous_reason,''),true);
  return null;
end;
$$;
`;

export const skipUnconfirmedStalePublicationsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(DDL).execute(database);
  },
  async down(): Promise<void> {
    throw new Error("Stale contradiction publication safeguards are forward-only.");
  },
};

export const skipUnconfirmedStalePublicationsDdl = DDL;
