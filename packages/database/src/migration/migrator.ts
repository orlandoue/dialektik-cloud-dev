import { Migrator } from 'kysely';

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
  const resultSet = await createMigrator(database).migrateToLatest();
  if (resultSet.error !== undefined) {
    throw resultSet.error instanceof Error
      ? resultSet.error
      : new Error('Unknown migration failure.');
  }
  return resultSet.results ?? [];
}

export async function migrationStatus(
  database: Kysely<Database>,
): Promise<readonly MigrationInfo[]> {
  return createMigrator(database).getMigrations();
}
