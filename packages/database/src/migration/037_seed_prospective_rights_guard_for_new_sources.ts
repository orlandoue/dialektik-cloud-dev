import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
create function dialektik_seed_prospective_rights_guard()
returns trigger language plpgsql as $$
begin
  insert into prospective_content_rights_write_guards(source_id)
  values (new.id)
  on conflict (source_id) do nothing;
  return new;
end;
$$;

create trigger sources_seed_prospective_rights_guard_after_insert
after insert on sources
for each row execute function dialektik_seed_prospective_rights_guard();

create trigger sources_seed_prospective_rights_guard_after_id_update
after update of id on sources
for each row execute function dialektik_seed_prospective_rights_guard();

update sources s
set id = s.id
where not exists (
  select 1 from prospective_content_rights_write_guards g where g.source_id = s.id
);
`;

export const seedProspectiveRightsGuardForNewSourcesMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner source rights guard registration is forward-only.');
  },
};
