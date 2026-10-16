import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabase, destroyDatabase } from '@dialektik/database';
import { sql, Migrator, type Migration, type MigrationProvider } from 'kysely';

const require = createRequire(import.meta.url);
const { DialektikMigrationProvider } = require('../../../packages/database/dist/migration/provider.js') as {
  DialektikMigrationProvider: new () => MigrationProvider;
};

const connectionString = process.env.DIALEKTIK_GOVUK_RLS_TEST_DATABASE_URL;
assert.ok(connectionString, 'DIALEKTIK_GOVUK_RLS_TEST_DATABASE_URL is required');
const url = new URL(connectionString);
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55442');
assert.equal(url.pathname, '/postgres');
assert.equal(url.username, 'postgres');
assert.equal(url.password, '');

const database = createDatabase({
  connectionString,
  applicationName: 'dialektik-govuk-row-scope-local-prepare',
  maxConnections: 1,
});

try {
  const state = await sql<{ hasMigrationTable: boolean; hasSources: boolean }>`
    select to_regclass('public.kysely_migration') is not null as "hasMigrationTable",
           to_regclass('public.sources') is not null as "hasSources"
  `.execute(database);
  assert.equal(state.rows[0]?.hasSources, false, 'refusing a cluster with existing Dialektik tables');
  if (state.rows[0]?.hasMigrationTable) {
    const applied = await sql<{ count: number }>`select count(*)::integer as count from public.kysely_migration`.execute(database);
    assert.equal(applied.rows[0]?.count, 0, 'refusing a cluster where any migration has already committed');
  }

  const supabaseStub = readFileSync(
    fileURLToPath(new URL('./fixtures/govuk-row-scope-supabase-stub.sql', import.meta.url)),
    'utf8',
  );
  await sql.raw(supabaseStub).execute(database);

  const provider = new DialektikMigrationProvider();
  const baselineProvider: MigrationProvider = {
    async getMigrations(): Promise<Record<string, Migration>> {
      const migrations = await provider.getMigrations();
      delete migrations['042_govuk_product_writer_row_scope'];
      return migrations;
    },
  };
  const baseline = await new Migrator({ db: database, provider: baselineProvider }).migrateToLatest();
  if (baseline.error) throw baseline.error;
  assert.equal(baseline.results?.length, 41, 'expected migrations 001 through 041 only');

  // Match the required remote order: disable the disposable writer before 042.
  await sql.raw('ALTER ROLE dialektik_govuk_metadata_writer NOLOGIN').execute(database);

  // The authorized development project has these two Core read policies, but
  // they are not in the repository migration history. Reproduce only that
  // observed catalog baseline in this fresh local test cluster.
  await sql.raw(`
    ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT (id,name,source_type,is_issuing_entity,canonical_domain,origin,created_at)
      ON public.sources TO dialektik_core_app;
    GRANT SELECT (id,source_id,event_id,url_canonical,origin,live_exposure_id,captured_at,published_at,
      updated_at_source,text_original,text_normalized,lang,clustering_score,declares_wire,processing_error,
      syndication_confidence,syndication_of) ON public.articles TO dialektik_core_app;
    CREATE POLICY dialektik_core_read ON public.sources
      FOR SELECT TO dialektik_core_app USING (true);
    CREATE POLICY dialektik_core_read ON public.articles
      FOR SELECT TO dialektik_core_app USING (true);
  `).execute(database);

  const final = await new Migrator({ db: database, provider }).migrateToLatest();
  if (final.error) throw final.error;
  assert.equal(final.results?.length, 1, 'expected only migration 042 after the local baseline was prepared');
  assert.equal(final.results?.[0]?.migrationName, '042_govuk_product_writer_row_scope');

  const policyState = await sql<{ coreSource: boolean; coreArticle: boolean; targetRls: number }>`
    select
      exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='sources'
        and policyname='dialektik_core_read' and roles=array['dialektik_core_app']::name[] and cmd='SELECT') as "coreSource",
      exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='articles'
        and policyname='dialektik_core_read' and roles=array['dialektik_core_app']::name[] and cmd='SELECT') as "coreArticle",
      (select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=any(array['live_source_policies','live_exposure_exclusions',
          'live_acquisition_receipts','live_article_versions','prospective_content_rights_write_guards'])
          and c.relrowsecurity) as "targetRls"
  `.execute(database);
  assert.deepEqual(policyState.rows[0], { coreSource: true, coreArticle: true, targetRls: 5 });
  process.stdout.write(JSON.stringify({
    event: 'govuk_row_scope_local_migrations_ready',
    postgres_port: 55442,
    baseline_migrations: baseline.results?.length,
    tested_migration: final.results?.[0]?.migrationName,
    core_read_baseline: 'mirrored_from_verified_remote_catalog',
    row_security_tables: 5,
    writer_login: false,
    remote_database_touched: false,
  }) + '\n');
} finally {
  await destroyDatabase(database);
}
