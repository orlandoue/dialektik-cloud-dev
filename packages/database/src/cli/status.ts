import { migrationStatus } from '../migration/migrator';
import { failCli, withDevelopmentDatabase } from './shared';

async function main(): Promise<void> {
  await withDevelopmentDatabase(async (database) => {
    const migrations = await migrationStatus(database);
    for (const migration of migrations) {
      const state = migration.executedAt === undefined ? 'pending' : 'executed';
      process.stdout.write(`${migration.name}: ${state}\n`);
    }
  });
}

void main().catch(failCli);
