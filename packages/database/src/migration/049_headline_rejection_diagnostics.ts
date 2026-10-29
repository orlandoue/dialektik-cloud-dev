import { sql, type Migration } from 'kysely';

/** Records only a fixed rejection category; model text is never persisted. */
const HEADLINE_DIAGNOSTIC_SQL = String.raw`
alter table public.headline_ai_attempt_outcomes
  add column rejection_code text
  check (rejection_code is null or (outcome='REJECTED' and rejection_code in (
    'MODEL_SCHEMA', 'MODEL_EVIDENCE', 'MODEL_UNBOUNDED', 'MODEL_CHRONOLOGY', 'MODEL_VALIDATION'
  )));
`;

export const headlineRejectionDiagnosticsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(HEADLINE_DIAGNOSTIC_SQL).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Headline audit history must be preserved.');
  },
};
