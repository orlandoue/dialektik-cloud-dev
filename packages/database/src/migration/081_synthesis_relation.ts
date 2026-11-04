import { sql, type Migration } from 'kysely';

// Null means that no editorial classification has been made. In particular,
// a contrast publication alone is not proof of a factual contradiction.
export const synthesisRelationSql = String.raw`
alter table public.events add column synthesis_relation text
  check (synthesis_relation in ('CONTRADICTION', 'DIFFERENT_FOCUS', 'DEVELOPING', 'TREND'));
alter table public.events add column synthesis_relation_updated_at timestamptz;
create function public.touch_synthesis_relation_updated_at() returns trigger
language plpgsql as $$
begin
  if new.synthesis_relation is distinct from old.synthesis_relation then
    new.synthesis_relation_updated_at := now();
  end if;
  return new;
end;
$$;
create trigger events_synthesis_relation_timestamp before update of synthesis_relation on public.events
  for each row execute function public.touch_synthesis_relation_updated_at();
`;
export const synthesisRelationMigration: Migration = {
  async up(db) { await sql.raw(synthesisRelationSql).execute(db); },
  async down() { throw new Error('Editorial classifications are forward-only.'); },
};
