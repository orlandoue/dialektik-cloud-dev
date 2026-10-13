import { createDatabase, destroyDatabase } from '../connection';
import { databaseUrlFromEnvironment } from '../config';
import type { Database } from '../database.types';
import type { Kysely } from 'kysely';

export async function withDevelopmentDatabase<Result>(
  operation: (database: Kysely<Database>) => Promise<Result>,
): Promise<Result> {
  const database = createDatabase({
    applicationName: 'dialektik-database-cli',
    connectionString: databaseUrlFromEnvironment(process.env, 'development'),
    maxConnections: 2,
  });
  try {
    return await operation(database);
  } finally {
    await destroyDatabase(database);
  }
}

export function failCli(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Unknown database command failure.';
  process.stderr.write(`Database command failed: ${redactUrls(message)}\n`);
  process.exit(1);
}

function redactUrls(value: string): string {
  return value.replace(
    /postgres(?:ql)?:\/\/[^\s:@/]+(?::[^\s@/]*)?@/giu,
    'postgresql://[redacted]@',
  );
}
