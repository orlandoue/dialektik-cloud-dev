import { Client } from 'pg';

import { databaseUrlFromEnvironment } from '../config';
import { createDatabase, destroyDatabase, validatePostgresUrl } from '../connection';
import { migrateToLatest } from '../migration/migrator';
import { authorizedLocalRebuildTarget } from '../safety/rebuild-target';
import { failCli } from './shared';

async function main(): Promise<void> {
  const connectionString = databaseUrlFromEnvironment(process.env, 'development');
  const parsed = validatePostgresUrl(connectionString);
  const databaseName = authorizedLocalRebuildTarget(
    parsed,
    process.env.DIALEKTIK_ALLOW_DATABASE_REBUILD,
  );

  const adminUrl = new URL(parsed);
  adminUrl.pathname = '/postgres';
  const admin = new Client({
    application_name: 'dialektik-database-rebuild',
    connectionString: adminUrl.toString(),
  });
  await admin.connect();
  try {
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`drop database if exists "${databaseName}"`);
    await admin.query(`create database "${databaseName}"`);
  } finally {
    await admin.end();
  }

  const database = createDatabase({
    applicationName: 'dialektik-database-rebuild-migrate',
    connectionString,
    maxConnections: 2,
  });
  try {
    await migrateToLatest(database);
  } finally {
    await destroyDatabase(database);
  }
  process.stdout.write(`Rebuilt and migrated ${databaseName}.\n`);
}

void main().catch(failCli);
