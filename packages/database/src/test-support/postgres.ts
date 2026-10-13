import { randomBytes } from 'node:crypto';

import { Client } from 'pg';

import { databaseUrlFromEnvironment } from '../config';
import { createDatabase, destroyDatabase, validatePostgresUrl } from '../connection';
import type { Database } from '../database.types';
import { migrateToLatest } from '../migration/migrator';
import type { Kysely } from 'kysely';

const DISPOSABLE_DATABASE_NAME = /^dialektik_test_[a-z0-9_]+$/u;

export interface DisposableDatabase {
  readonly database: Kysely<Database>;
  readonly databaseName: string;
  readonly connectionString: string;
  destroy(): Promise<void>;
}

export async function createDisposableDatabase(label: string): Promise<DisposableDatabase> {
  const normalizedLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  const suffix = randomBytes(6).toString('hex');
  const databaseName = `dialektik_test_${normalizedLabel.slice(0, 24)}_${suffix}`;
  if (!DISPOSABLE_DATABASE_NAME.test(databaseName)) {
    throw new Error('Refusing to create an invalid disposable database name.');
  }

  const baseUrl = validatePostgresUrl(databaseUrlFromEnvironment(process.env, 'test'));
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({
    application_name: 'dialektik-integration-test-admin',
    connectionString: adminUrl.toString(),
  });
  await admin.connect();
  try {
    await admin.query(`create database "${databaseName}"`);
  } finally {
    await admin.end();
  }

  const databaseUrl = new URL(baseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const connectionString = databaseUrl.toString();
  const database = createDatabase({
    applicationName: `dialektik-test-${normalizedLabel.slice(0, 24)}`,
    connectionString,
    maxConnections: 4,
  });

  let destroyed = false;
  return {
    connectionString,
    database,
    databaseName,
    async destroy(): Promise<void> {
      if (destroyed) {
        return;
      }
      destroyed = true;
      await destroyDatabase(database);
      const cleanup = new Client({
        application_name: 'dialektik-integration-test-cleanup',
        connectionString: adminUrl.toString(),
      });
      await cleanup.connect();
      try {
        await cleanup.query(
          'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
          [databaseName],
        );
        await cleanup.query(`drop database if exists "${databaseName}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

export async function createMigratedDisposableDatabase(label: string): Promise<DisposableDatabase> {
  const disposable = await createDisposableDatabase(label);
  try {
    await migrateToLatest(disposable.database);
    return disposable;
  } catch (error) {
    await disposable.destroy();
    throw error;
  }
}
