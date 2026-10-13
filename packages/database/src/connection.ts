import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

import type { Database } from './database.types';

export interface DatabaseConnectionOptions {
  readonly connectionString: string;
  readonly applicationName: string;
  readonly maxConnections?: number;
}

export function validatePostgresUrl(connectionString: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new TypeError('Database connection string must be a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new TypeError('Database connection string must use postgres:// or postgresql://.');
  }
  if (parsed.hostname === '' || parsed.pathname.length <= 1) {
    throw new TypeError('Database connection string must include a host and database name.');
  }
  return parsed;
}

export function redactPostgresUrl(connectionString: string): string {
  const parsed = validatePostgresUrl(connectionString);
  if (parsed.username !== '') {
    parsed.username = '[redacted]';
  }
  if (parsed.password !== '') {
    parsed.password = '[redacted]';
  }
  return parsed.toString();
}

export function createDatabase(options: DatabaseConnectionOptions): Kysely<Database> {
  validatePostgresUrl(options.connectionString);
  const pool = new Pool({
    application_name: options.applicationName,
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
  });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export async function databaseIsReady(database: Kysely<Database>): Promise<boolean> {
  try {
    await sql<{ ready: number }>`select 1 as ready`.execute(database);
    return true;
  } catch (error) {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error &&
      typeof error.code === 'string' && /^[A-Za-z0-9_]+$/.test(error.code)
        ? error.code
        : error instanceof Error
          ? error.name
          : 'UnknownError';
    console.warn(JSON.stringify({ event: 'database_readiness_failed', errorCode }));
    return false;
  }
}

export async function destroyDatabase(database: Kysely<Database>): Promise<void> {
  await database.destroy();
}
