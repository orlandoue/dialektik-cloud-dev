import { sql, type Migration } from 'kysely';

// Fixture-only hardening. Provider/mode activation constraints are preserved.
// Gamma's authored synthetic Article omits the event date: null means unknown
// event time, never a MATCH/DISTINCT decision or boolean collapse.
const HARDENING = String.raw`
alter table semantic_occurrences alter column event_at drop not null;
create index idx_shadow_observation_thread on semantic_observations(thread_id, observed_at, id);
create function shadow_semantic_complete_entity() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'semantic_event_threads' then
    if not exists (select 1 from semantic_thread_states where thread_id = new.id) then
      raise exception 'Thread requires an initial state in the same transaction' using errcode = '23514';
    end if;
  else
    if not exists (select 1 from semantic_occurrence_states where occurrence_id = new.id) then
      raise exception 'Occurrence requires an initial state in the same transaction' using errcode = '23514';
    end if;
  end if;
  return null;
end; $$;
create constraint trigger shadow_complete_thread after insert on semantic_event_threads
  deferrable initially deferred for each row execute function shadow_semantic_complete_entity();
create constraint trigger shadow_complete_occurrence after insert on semantic_occurrences
  deferrable initially deferred for each row execute function shadow_semantic_complete_entity();
`;
export const semanticShadowHardeningMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(HARDENING).execute(database);
  },
};
