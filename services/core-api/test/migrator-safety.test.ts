import { describe, expect, it } from 'vitest';

import { assertNoSupabaseManagedMigrationLedger } from '../../../packages/database/src/migration/migrator';

describe('Kysely migration target guard', () => {
  it('allows a database without the Supabase-managed migration ledger', () => {
    expect(() => assertNoSupabaseManagedMigrationLedger(null)).not.toThrow();
  });

  it('blocks a Supabase ledger before Kysely can replay local migrations', () => {
    expect(() =>
      assertNoSupabaseManagedMigrationLedger('supabase_migrations.schema_migrations'),
    ).toThrow('SUPABASE_MANAGED_MIGRATIONS_REQUIRE_EXPLICIT_RECONCILIATION');
  });
});
