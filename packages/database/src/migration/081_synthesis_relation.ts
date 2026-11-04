import { sql, type Migration } from 'kysely';

// Null means that no editorial classification has been made. In particular,
// a contrast publication alone is not proof of a factual contradiction.
export const synthesisRelationSql = String.raw`
alter table public.events add column synthesis_relation text
  check (synthesis_relation in ('CONTRADICTION', 'DIFFERENT_FOCUS', 'DEVELOPING', 'TREND'));
`;
export const synthesisRelationMigration: Migration = {
  async up(db) { await sql.raw(synthesisRelationSql).execute(db); },
  async down() { throw new Error('Editorial classifications are forward-only.'); },
};
