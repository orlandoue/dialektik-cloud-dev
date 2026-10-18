import { Migrator, sql } from 'kysely';

import type { Database } from '../database.types';
import type { Kysely, MigrationInfo, MigrationResult } from 'kysely';
import { DialektikMigrationProvider } from './provider';

function createMigrator(database: Kysely<Database>): Migrator {
  return new Migrator({
    db: database,
    provider: new DialektikMigrationProvider(),
  });
}

export async function migrateToLatest(
  database: Kysely<Database>,
): Promise<readonly MigrationResult[]> {
  await assertKyselyMigrationTarget(database);
  const resultSet = await createMigrator(database).migrateToLatest();
  if (resultSet.error !== undefined) {
    throw resultSet.error instanceof Error
      ? resultSet.error
      : new Error('Unknown migration failure.');
  }
  return resultSet.results ?? [];
}

/**
 * Kysely's local sequence is not the Supabase migration ledger. Refuse before
 * constructing Kysely's migrator so a missing `public.kysely_migration` table
 * cannot replay the local 001–044 chain against a Supabase-managed database.
 * Supabase DEV changes must use the separately reviewed, explicitly authorized
 * migration path.
 */
export async function assertKyselyMigrationTarget(
  database: Kysely<Database>,
): Promise<void> {
  const result = await sql<{ supabaseMigrationLedger: string | null }>`
    SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations')::text
      AS "supabaseMigrationLedger"
  `.execute(database);
  if (result.rows.length !== 1 || result.rows[0] === undefined) {
    throw new Error('DATABASE_MIGRATION_TARGET_PREFLIGHT_UNAVAILABLE');
  }
  assertNoSupabaseManagedMigrationLedger(result.rows[0].supabaseMigrationLedger);
}

export function assertNoSupabaseManagedMigrationLedger(
  supabaseMigrationLedger: string | null,
): void {
  if (supabaseMigrationLedger !== null) {
    throw new Error('SUPABASE_MANAGED_MIGRATIONS_REQUIRE_EXPLICIT_RECONCILIATION');
  }
}

export async function migrationStatus(
  database: Kysely<Database>,
): Promise<readonly MigrationInfo[]> {
  return createMigrator(database).getMigrations();
}
