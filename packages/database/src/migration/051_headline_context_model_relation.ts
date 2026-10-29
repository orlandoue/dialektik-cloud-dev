import { sql, type Migration } from 'kysely';

/** Preserve the model's label separately from the conservative editorial suggestion. */
const HEADLINE_CONTEXT_MODEL_RELATION_SQL = String.raw`
alter table public.headline_context_pair_outcomes
  add column model_relation text
  check (model_relation is null or (outcome='VALIDATED' and model_relation in (
    'POSSIBLY_SAME_EVENT','POSSIBLY_SAME_THREAD','UNRELATED','UNCERTAIN'
  )));
`;

export const headlineContextModelRelationMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(HEADLINE_CONTEXT_MODEL_RELATION_SQL).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Context review audit history must be preserved.');
  },
};
