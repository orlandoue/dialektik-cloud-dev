import { migrateToLatest } from '../migration/migrator';
import { failCli, withDevelopmentDatabase } from './shared';

async function main(): Promise<void> {
  await withDevelopmentDatabase(async (database) => {
    const results = await migrateToLatest(database);
    for (const result of results) {
      process.stdout.write(`${result.migrationName}: ${result.status}\n`);
    }
    if (results.length === 0) {
      process.stdout.write('Database schema is already current.\n');
    }
  });
}

void main().catch(failCli);
