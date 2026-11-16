import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { connect as netConnect, createServer } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { createDatabase, destroyDatabase } from '@dialektik/database';
import { Migrator, sql } from 'kysely';

const repoRequire = createRequire(import.meta.url);
const { DialektikMigrationProvider } = repoRequire('../../../packages/database/dist/migration/provider.js');
const migrationName = '043_govuk_rsh_one_shot_metadata';
const recoveryMigrationName = '044_govuk_rsh_receipt_recovery';
const functionName = 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)';
const invokerName = 'dialektik_govuk_rsh_invoker';
const writerName = 'dialektik_govuk_metadata_writer';
const sourceId = '01M4YDQK00WS344WW8RCPCEQHE';
const articleId = '01M4YDQK00WS344WW8RCPCEQHF';
const receiptId = '01M4YDQK00WS344WW8RCPCEQHG';
const versionId = '01M4YDQK00WS344WW8RCPCEQHH';
const sourceItemId = '86f4abba-9eaa-412f-b048-5ed30aa74201';
const canonicalUrl = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh';
const discoveryUrl = 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh';
const rightsUrl = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
const title = 'Social housing landlord downgraded by RSH';
const publishedAt = '2026-10-07T08:30:03.000Z';
const databaseName = 'dialektik_attack045_clean_20261018';
const downDatabaseName = 'dialektik_attack043_down_clean';
const raceDatabaseNames = [
  'dialektik_attack045_first_race_ab',
  'dialektik_attack045_first_race_ba',
  'dialektik_attack045_revoked_race',
];
const adminUrl = requiredEnv('DIALEKTIK_ATTACK044_ADMIN_URL');
const port = Number(requiredEnv('DIALEKTIK_ATTACK044_PORT'));
assert.ok(Number.isInteger(port) && port >= 55442 && port <= 55445);
assert.equal(new URL(adminUrl).hostname, '127.0.0.1');
assert.equal(Number(new URL(adminUrl).port), port);
assert.equal(decodeURIComponent(new URL(adminUrl).username), 'postgres');
assert.equal(new URL(adminUrl).pathname, `/${databaseName}`);

function requiredEnv(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function makePayload(acquiredAt = new Date(Date.now() - 1_000).toISOString()) {
  const fields = {
    sourceItemId,
    canonicalUrl,
    title,
    publisher: 'Regulator of Social Housing',
    publishedAt,
    modifiedAt: publishedAt,
    locale: 'en',
    rightsEvidenceUrl: rightsUrl,
    rightsVerifiedAt: '2026-10-15T00:00:00.000Z',
    attribution: '© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0.',
    discoveryChannel: 'official_api',
    discoveryUrl,
  };
  return {
    acquiredAt,
    metadataHash: sha256(JSON.stringify(fields)),
    modifiedAt: publishedAt,
    publishedAt,
  };
}

function connectionStringForDatabase(connectionString, selectedDatabase) {
  const url = new URL(connectionString);
  url.pathname = `/${selectedDatabase}`;
  return url.toString();
}

function invokerConnectionString(password, selectedPort = port, selectedDatabase = databaseName) {
  const url = new URL(adminUrl);
  url.username = invokerName;
  url.password = password;
  url.port = String(selectedPort);
  url.pathname = `/${selectedDatabase}`;
  return url.toString();
}

let admin = new Client({ connectionString: adminUrl, application_name: 'attack044-local-admin' });
const raceAdmins = new Map();
let invokerPassword;
let invoker;
let database;

async function readMigrationDownBaseline(connection) {
  const functions = await connection.query(`
    SELECT proname, md5(lower(pg_catalog.regexp_replace(prosrc, '[[:space:]]+', '', 'g'))) AS body_hash,
      proconfig::text AS config
    FROM pg_catalog.pg_proc
    WHERE pronamespace='public'::pg_catalog.regnamespace
      AND proname=ANY($1::text[])
    ORDER BY proname
  `, [[
    'dialektik_seed_prospective_rights_guard',
    'dialektik_validate_live_receipt',
    'dialektik_validate_live_article',
    'dialektik_validate_live_version',
  ]]);
  assert.equal(functions.rowCount, 4, 'baseline trigger functions exist before candidate DOWN test');
  const policies = await connection.query(`
    SELECT schemaname, tablename, policyname, roles::text AS roles, cmd, qual, with_check
    FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename=ANY($1::text[])
    ORDER BY tablename, policyname
  `, [['sources', 'articles']]);
  const writerColumnPrivileges = await connection.query(`
    WITH scoped(table_name, column_name) AS (VALUES
      ('sources','created_at'),
      ('live_acquisition_receipts','discovery_channel'),
      ('live_acquisition_receipts','discovery_url'),
      ('live_acquisition_receipts','discovered_url'),
      ('live_acquisition_receipts','published_at'),
      ('live_acquisition_receipts','modified_at'),
      ('live_acquisition_receipts','original_published_at'),
      ('live_acquisition_receipts','original_modified_at'),
      ('live_acquisition_receipts','seen_at'),
      ('live_acquisition_receipts','error_code'),
      ('articles','text_original'),
      ('articles','text_normalized'),
      ('articles','lang'),
      ('articles','published_at'),
      ('articles','updated_at_source'),
      ('live_article_versions','id'),
      ('live_article_versions','receipt_id'),
      ('live_article_versions','headline'),
      ('live_article_versions','published_at'),
      ('live_article_versions','modified_at'),
      ('live_article_versions','content_hash'),
      ('live_article_versions','near_duplicate_signature'),
      ('live_article_versions','recorded_at'),
      ('live_article_versions','excerpt'),
      ('live_article_versions','author'),
      ('live_article_versions','declared_upstream')
    )
    SELECT table_name, column_name,
      pg_catalog.has_column_privilege('dialektik_govuk_metadata_writer',
        pg_catalog.format('public.%I', table_name), column_name, 'SELECT') AS can_select
    FROM scoped ORDER BY table_name, column_name
  `);
  const writerMembership = await connection.query(`
    SELECT member_role.rolname AS member, membership.admin_option, membership.inherit_option,
      membership.set_option
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid=membership.roleid
    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid=membership.member
    WHERE granted_role.rolname='dialektik_govuk_metadata_writer'
      AND member_role.rolname='postgres'
  `);
  const databaseConnect = await connection.query(`
    SELECT role_name, pg_catalog.has_database_privilege(role_name, pg_catalog.current_database(), 'CONNECT') AS can_connect
    FROM unnest(ARRAY['postgres','anon','authenticated','dialektik_core_app']::text[]) AS role_name
    ORDER BY role_name
  `);
  return {
    functions: functions.rows,
    policies: policies.rows,
    writerColumnPrivileges: writerColumnPrivileges.rows,
    writerMembership: writerMembership.rows,
    databaseConnect: databaseConnect.rows,
  };
}

async function testMigration043Down() {
  await admin.end();
  const maintenanceUrl = connectionStringForDatabase(adminUrl, 'postgres');
  let maintenance = new Client({ connectionString: maintenanceUrl, application_name: 'attack043-down-cloner' });
  await maintenance.connect();
  try {
    const existing = await maintenance.query(
      'SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1', [downDatabaseName],
    );
    assert.equal(existing.rowCount, 0, 'refuse to reuse a migration DOWN database');
    await maintenance.query(`CREATE DATABASE "${downDatabaseName}" TEMPLATE "${databaseName}"`);
  } finally {
    await maintenance.end();
  }

  const downUrl = connectionStringForDatabase(adminUrl, downDatabaseName);
  const downDb = createDatabase({
    connectionString: downUrl,
    applicationName: 'attack043-down-isolated-database',
    maxConnections: 1,
    connectionTimeoutMillis: 4_000,
  });
  const inspector = new Client({ connectionString: downUrl, application_name: 'attack043-down-audit' });
  let testError;
  try {
    await inspector.connect();
    const baseline = await readMigrationDownBaseline(inspector);
    const provider = new DialektikMigrationProvider();
    const up = await new Migrator({ db: downDb, provider }).migrateToLatest();
    if (up.error) throw up.error;
    assert.deepEqual(up.results?.map((row) => row.migrationName), [migrationName, recoveryMigrationName]);

    const down044 = await new Migrator({ db: downDb, provider }).migrateDown();
    if (down044.error) throw down044.error;
    assert.deepEqual(down044.results?.map((row) => row.migrationName), [recoveryMigrationName]);
    const down043 = await new Migrator({ db: downDb, provider }).migrateDown();
    if (down043.error) throw down043.error;
    assert.deepEqual(down043.results?.map((row) => row.migrationName), [migrationName]);

    const ledger = await inspector.query('SELECT count(*)::int AS count FROM public.kysely_migration');
    assert.equal(ledger.rows[0].count, 42, 'DOWN returns the ledger to the exact pre-candidate baseline');
    const after = await readMigrationDownBaseline(inspector);
    assert.deepEqual(after, baseline, 'DOWN restores function bodies, Core policies, writer column ACLs, membership, and database ACL');
    const removedObjects = await inspector.query(`
      SELECT pg_catalog.to_regnamespace('dialektik_ops') IS NULL AS ops_schema_absent,
        pg_catalog.to_regprocedure('dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)') IS NULL AS writer_function_absent,
        pg_catalog.to_regprocedure('dialektik_ops.govuk_rsh_metadata_recovery_status()') IS NULL AS recovery_function_absent,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='dialektik_govuk_rsh_invoker') AS invoker_role_absent,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE usename IN ('dialektik_govuk_rsh_invoker','dialektik_govuk_metadata_writer')
            AND pid<>pg_catalog.pg_backend_pid()) AS no_candidate_sessions
    `);
    assert.deepEqual(removedObjects.rows[0], {
      ops_schema_absent: true,
      writer_function_absent: true,
      recovery_function_absent: true,
      invoker_role_absent: true,
      no_candidate_sessions: true,
    });
    process.stdout.write('ATTACK043_DOWN_REVOKES_CONNECT_EXECUTE_SESSIONS_AND_RESTORES_BASELINE=PASS\n');
  } catch (error) {
    testError = error;
    throw error;
  } finally {
    await inspector.end().catch(() => undefined);
    await destroyDatabase(downDb).catch(() => undefined);
    maintenance = new Client({ connectionString: maintenanceUrl, application_name: 'attack043-down-cleanup' });
    await maintenance.connect();
    try {
      const databaseExists = await maintenance.query(
        'SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1', [downDatabaseName],
      );
      if (databaseExists.rowCount) {
        await maintenance.query(`DROP DATABASE "${downDatabaseName}"`);
      }
      await maintenance.query(`
        DO $cleanup$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='dialektik_govuk_rsh_invoker') THEN
            PERFORM pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity
              WHERE usename='dialektik_govuk_rsh_invoker' AND pid<>pg_catalog.pg_backend_pid();
            ALTER ROLE dialektik_govuk_rsh_invoker NOLOGIN PASSWORD NULL;
            DROP ROLE dialektik_govuk_rsh_invoker;
          END IF;
        END
        $cleanup$
      `);
    } catch (cleanupError) {
      if (!testError) throw cleanupError;
      process.stderr.write('ATTACK043_DOWN_CLEANUP=FAIL\n');
    } finally {
      await maintenance.end().catch(() => undefined);
      admin = new Client({ connectionString: adminUrl, application_name: 'attack044-local-admin' });
      await admin.connect();
    }
  }
}

async function migration043() {
  database = createDatabase({
    connectionString: adminUrl,
    applicationName: 'attack044-clean-migration-043',
    maxConnections: 1,
    connectionTimeoutMillis: 4_000,
  });
  const all = new DialektikMigrationProvider();
  const migrations = await all.getMigrations();
  assert.ok(migrations[migrationName], 'candidate 043 exists in the migration provider');
  const result = await new Migrator({ db: database, provider: all }).migrateToLatest();
  if (result.error) throw result.error;
  assert.deepEqual(result.results?.map((row) => row.migrationName), [migrationName, recoveryMigrationName]);
  await destroyDatabase(database);
  database = undefined;
  process.stdout.write('ATTACK044_CLEAN_MIGRATION_043=PASS\n');
}

async function createAttack047RecoveryDatabaseClone() {
  const cloneName = process.env.DIALEKTIK_ATTACK047_RECOVERY_DATABASE_NAME;
  if (!cloneName) return;
  assert.match(cloneName, /^[a-z][a-z0-9_]{0,62}$/u, 'recovery database name must be a fixed safe identifier');

  // PostgreSQL roles are cluster-wide. Clone the empty 001-044 database before
  // this test creates content rows, and release the template connection first.
  await admin.end();
  const maintenance = new Client({
    connectionString: connectionStringForDatabase(adminUrl, 'postgres'),
    application_name: 'attack047-clean-template-cloner',
  });
  await maintenance.connect();
  try {
    const existing = await maintenance.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1', [cloneName]);
    assert.equal(existing.rowCount, 0, 'refuse to reuse an existing recovery database');
    await maintenance.query(`CREATE DATABASE "${cloneName}" TEMPLATE "${databaseName}"`);
  } finally {
    await maintenance.end();
  }

  admin = new Client({ connectionString: adminUrl, application_name: 'attack044-local-admin' });
  await admin.connect();
  const clone = new Client({
    connectionString: connectionStringForDatabase(adminUrl, cloneName),
    application_name: 'attack047-recovery-clone-preflight',
  });
  await clone.connect();
  try {
    const ledger = await clone.query('SELECT count(*)::int AS count FROM public.kysely_migration');
    assert.equal(ledger.rows[0].count, 44);
    assert.deepEqual(await stateCounts(clone), {
      sources: 0, rights_guards: 0, policies: 0, exclusions: 0,
      receipts: 0, articles: 0, versions: 0, events: 0,
    });
    process.stdout.write('ATTACK047_RECOVERY_DATABASE_CLONED_AT_044_EMPTY=PASS\n');
  } finally {
    await clone.end();
  }
}

async function createRaceDatabaseClones() {
  // Clone the migrated, still-empty database before any invocation writes rows.
  // Each race therefore starts from the same pristine eligibility state.
  await admin.end();
  const maintenance = new Client({
    connectionString: connectionStringForDatabase(adminUrl, 'postgres'),
    application_name: 'attack045-clean-template-cloner',
  });
  await maintenance.connect();
  try {
    for (const cloneName of raceDatabaseNames) {
      await maintenance.query(
        `CREATE DATABASE "${cloneName}" TEMPLATE "${databaseName}"`,
      );
    }
  } finally {
    await maintenance.end();
  }

  admin = new Client({ connectionString: adminUrl, application_name: 'attack044-local-admin' });
  await admin.connect();
  for (const cloneName of raceDatabaseNames) {
    const raceAdmin = new Client({
      connectionString: connectionStringForDatabase(adminUrl, cloneName),
      application_name: `attack045-admin-${cloneName}`,
    });
    await raceAdmin.connect();
    const migrations = await raceAdmin.query('SELECT count(*)::int AS count FROM public.kysely_migration');
    assert.equal(migrations.rows[0].count, 44, `${cloneName} contains migrations 001-044`);
    assert.deepEqual(await stateCounts(raceAdmin), {
      sources: 0,
      rights_guards: 0,
      policies: 0,
      exclusions: 0,
      receipts: 0,
      articles: 0,
      versions: 0,
      events: 0,
    });
    raceAdmins.set(cloneName, raceAdmin);
  }
  process.stdout.write(`ATTACK045_PRISTINE_RACE_DATABASES=${raceDatabaseNames.length}\n`);
}

async function stateCounts(connection) {
  const result = await connection.query(`
    SELECT
      (SELECT count(*)::int FROM public.sources WHERE id=$1::public.dialektik_ulid) AS sources,
      (SELECT count(*)::int FROM public.prospective_content_rights_write_guards WHERE source_id=$1::public.dialektik_ulid) AS rights_guards,
      (SELECT count(*)::int FROM public.live_source_policies WHERE source_id=$1::public.dialektik_ulid) AS policies,
      (SELECT count(*)::int FROM public.live_exposure_exclusions WHERE registry_key='product-govuk-rsh-content-api-v1' AND source_item_id=$2) AS exclusions,
      (SELECT count(*)::int FROM public.live_acquisition_receipts WHERE source_id=$1::public.dialektik_ulid AND source_item_id=$2) AS receipts,
      (SELECT count(*)::int FROM public.articles WHERE source_id=$1::public.dialektik_ulid AND url_canonical=$3) AS articles,
      (SELECT count(*)::int FROM public.live_article_versions v JOIN public.articles a ON a.id=v.article_id WHERE a.source_id=$1::public.dialektik_ulid AND a.url_canonical=$3) AS versions,
      (SELECT count(*)::int FROM public.events) AS events
  `, [sourceId, sourceItemId, canonicalUrl]);
  return result.rows[0];
}

async function semanticCounts(connection) {
  const relations = await connection.query(`
    SELECT c.relname AS name
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (c.relname ILIKE '%semantic%' OR c.relname ILIKE '%occurrence%'
        OR c.relname ILIKE '%thread%' OR c.relname ILIKE '%claim%')
    ORDER BY c.relname
  `);
  const result = [];
  for (const row of relations.rows) {
    const relation = `public."${String(row.name).replaceAll('"', '""')}"`;
    const count = await connection.query(`SELECT count(*)::int AS count FROM ${relation}`);
    result.push([row.name, count.rows[0].count]);
  }
  return result;
}

async function roleAndFunctionAudit(connection) {
  const functionAudit = await connection.query(`
    SELECT p.prosecdef AS security_definer,
      p.proowner::regrole::text AS owner,
      p.proconfig AS config,
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute,
      pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
      pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
      pg_catalog.has_function_privilege('dialektik_core_app',p.oid,'EXECUTE') AS core_execute,
      pg_catalog.has_function_privilege($1,p.oid,'EXECUTE') AS invoker_execute,
      (SELECT count(*)::int FROM pg_catalog.pg_proc other
       JOIN pg_catalog.pg_namespace n ON n.oid=other.pronamespace
       WHERE other.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
         AND other.oid NOT IN (p.oid, 'dialektik_ops.govuk_rsh_metadata_recovery_status()'::regprocedure)
         AND pg_catalog.has_function_privilege($1,other.oid,'EXECUTE')) AS other_definer_execute_count
    FROM pg_catalog.pg_proc p WHERE p.oid=$2::regprocedure
  `, [invokerName, functionName]);
  assert.deepEqual(functionAudit.rows[0], {
    security_definer: true,
    owner: writerName,
    config: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
    public_execute: false,
    anon_execute: false,
    authenticated_execute: false,
    core_execute: false,
    invoker_execute: false,
    other_definer_execute_count: 0,
  });

  const roles = await connection.query(`
    SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolconnlimit,
      pg_catalog.has_database_privilege($1,current_database(),'CONNECT') AS can_connect,
      pg_catalog.has_database_privilege($1,current_database(),'CREATE') AS can_create_database,
      pg_catalog.has_schema_privilege($1,'dialektik_ops','USAGE') AS ops_usage,
      pg_catalog.has_schema_privilege($1,'dialektik_ops','CREATE') AS ops_create,
      pg_catalog.has_schema_privilege($1,'public','CREATE') AS public_create,
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members m
       WHERE m.member=$1::regrole OR m.roleid=$1::regrole) AS invoker_memberships,
      (SELECT count(*)::int FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
         AND pg_catalog.has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS direct_write_relations
    FROM pg_catalog.pg_roles WHERE rolname=$1
  `, [invokerName]);
  assert.deepEqual(roles.rows[0], {
    rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, rolbypassrls: false, rolinherit: false, rolconnlimit: 2,
    can_connect: true, can_create_database: false, ops_usage: true, ops_create: false,
    public_create: false, invoker_memberships: 0, direct_write_relations: 0,
  });

  const writer = await connection.query(`
    SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
      (SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE usename=$1) AS active_sessions,
      pg_catalog.has_table_privilege($1,'public.events','INSERT') AS events_insert,
      pg_catalog.has_schema_privilege($1,'dialektik_ops','USAGE') AS ops_usage,
      pg_catalog.has_schema_privilege($1,'dialektik_ops','CREATE') AS ops_create
    FROM pg_catalog.pg_roles WHERE rolname=$1
  `, [writerName]);
  assert.deepEqual(writer.rows[0], {
    rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, rolbypassrls: false, rolinherit: false,
    active_sessions: 0, events_insert: false, ops_usage: true, ops_create: false,
  });

  const rls = await connection.query(`
    SELECT count(*)::int AS count FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity
  `, [[
    'sources','articles','live_source_policies','live_exposure_exclusions',
    'live_acquisition_receipts','live_article_versions','prospective_content_rights_write_guards',
  ]]);
  assert.equal(rls.rows[0].count, 7);
  process.stdout.write('ATTACK044_INVOKER_ROLE_ACL_RLS_DEFINER=PASS\n');
}

async function proxyDropCommitAck(metadata) {
  const server = createServer((frontend) => {
    const backend = netConnect(port, '127.0.0.1');
    let startup = true;
    let frontBuffer = Buffer.alloc(0);
    let backBuffer = Buffer.alloc(0);
    let dropNextReady = false;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      frontend.destroy();
      backend.destroy();
    };
    frontend.on('error', close);
    backend.on('error', close);
    frontend.on('close', () => backend.destroy());
    backend.on('close', () => frontend.destroy());
    frontend.on('data', (chunk) => {
      frontBuffer = Buffer.concat([frontBuffer, chunk]);
      let offset = 0;
      if (startup) {
        if (frontBuffer.length < 4) return;
        const size = frontBuffer.readInt32BE(0);
        if (frontBuffer.length < size) return;
        offset = size;
        startup = false;
      }
      while (frontBuffer.length - offset >= 5) {
        const type = String.fromCharCode(frontBuffer[offset]);
        const size = frontBuffer.readInt32BE(offset + 1);
        if (size < 4 || frontBuffer.length - offset < size + 1) break;
        if (type === 'Q') {
          const query = frontBuffer.subarray(offset + 5, offset + size + 1)
            .toString('utf8').replace(/\0+$/u, '').trim();
          if (/^COMMIT;?$/iu.test(query)) dropNextReady = true;
        }
        offset += size + 1;
      }
      if (offset > 0) backend.write(frontBuffer.subarray(0, offset));
      frontBuffer = frontBuffer.subarray(offset);
    });
    backend.on('data', (chunk) => {
      backBuffer = Buffer.concat([backBuffer, chunk]);
      let offset = 0;
      while (backBuffer.length - offset >= 5) {
        const type = String.fromCharCode(backBuffer[offset]);
        const size = backBuffer.readInt32BE(offset + 1);
        if (size < 4 || backBuffer.length - offset < size + 1) break;
        if (type === 'Z' && dropNextReady) {
          const beforeReady = backBuffer.subarray(0, offset);
          if (beforeReady.length > 0) frontend.write(beforeReady);
          close();
          return;
        }
        offset += size + 1;
      }
      if (offset > 0) frontend.write(backBuffer.subarray(0, offset));
      backBuffer = backBuffer.subarray(offset);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const childCode = String.raw`
    import { Client } from 'pg';
    const client = new Client({
      connectionString: process.env.DIALEKTIK_ATTACK045_UNCERTAIN_URL,
      application_name: 'attack045-commit-ack-loss-process',
    });
    // The TCP proxy deliberately resets the socket after the server commits.
    // Consume node-postgres's post-reset idle-client error event; the COMMIT
    // promise remains the signal that the client did not receive its ack.
    client.on('error', () => {});
    let phase = 'CONNECT';
    try {
      await client.connect();
      phase = 'BEGIN';
      await client.query('BEGIN');
      phase = 'PERSIST';
      const result = await client.query(
        'SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)',
        [process.env.DIALEKTIK_ATTACK045_METADATA],
      );
      if (result.rows[0]?.result_state !== 'persisted') throw new Error('UNEXPECTED_PERSIST_RESULT');
      phase = 'COMMIT';
      try {
        await client.query('COMMIT');
        process.stdout.write('ATTACK045_COMMIT_ACK_UNEXPECTED\n');
        process.exitCode = 2;
      } catch {
        process.stdout.write('ATTACK045_COMMIT_ACK_LOST_PROCESS_UNRECONCILED\n');
        await new Promise((resolve) => setTimeout(resolve, 60_000));
      }
    } catch (error) {
      const safeCode = typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
        ? error.code
        : 'UNCLASSIFIED';
      process.stdout.write('ATTACK045_COMMIT_CHILD_FAILED_PHASE:' + phase + ':CODE:' + safeCode + '\n');
      await client.end().catch(() => undefined);
      process.exitCode = 1;
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DIALEKTIK_ATTACK045_UNCERTAIN_URL: invokerConnectionString(invokerPassword, address.port),
      DIALEKTIK_ATTACK045_METADATA: JSON.stringify(metadata),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  let childFinished = false;
  let childStderrCategory = 'NONE';
  let childStderrSample = '';
  try {
    const ackLost = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ATTACK045_ACK_LOSS_CHILD_TIMEOUT')), 10_000);
      child.stdout.on('data', (chunk) => {
        childOutput += chunk.toString('utf8');
        if (childOutput.includes('ATTACK045_COMMIT_ACK_LOST_PROCESS_UNRECONCILED')) {
          clearTimeout(timeout);
          resolve();
        } else if (
          childOutput.includes('ATTACK045_COMMIT_ACK_UNEXPECTED') ||
          childOutput.includes('ATTACK045_COMMIT_CHILD_FAILED')
        ) {
          clearTimeout(timeout);
          reject(new Error('ATTACK045_COMMIT_ACK_CHILD_DID_NOT_REACH_UNCERTAIN_STATE'));
        }
      });
      child.stderr.on('data', (chunk) => {
        const diagnostic = chunk.toString('utf8');
        if (childStderrSample.length < 1_024) childStderrSample += diagnostic.slice(0, 1_024 - childStderrSample.length);
        if (/ERR_MODULE_NOT_FOUND|Cannot find package/u.test(diagnostic)) childStderrCategory = 'MODULE_RESOLUTION';
        else if (/SyntaxError|ERR_INVALID_ARG_TYPE/u.test(diagnostic)) childStderrCategory = 'PARSE_OR_ARGUMENT';
        else if (/ECONNREFUSED/u.test(diagnostic)) childStderrCategory = 'CONNECTION_REFUSED';
        else if (/28P01|password authentication failed/u.test(diagnostic)) childStderrCategory = 'AUTHENTICATION';
        else if (/heap limit|out of memory|FATAL ERROR/u.test(diagnostic)) childStderrCategory = 'MEMORY';
        else if (childStderrCategory === 'NONE') childStderrCategory = 'RUNTIME';
      });
      child.once('error', () => {
        clearTimeout(timeout);
        reject(new Error('ATTACK045_COMMIT_ACK_CHILD_PROCESS_ERROR'));
      });
      child.once('close', (code) => {
        if (!childOutput.includes('ATTACK045_COMMIT_ACK_LOST_PROCESS_UNRECONCILED')) {
          clearTimeout(timeout);
          const marker = childOutput.match(/ATTACK045_COMMIT_(?:ACK_UNEXPECTED|CHILD_FAILED_PHASE:[A-Z_]+(?::CODE:[A-Z0-9_]+)?)/u)?.[0] ?? 'NO_MARKER';
          const safeStderrSample = childStderrSample
            .split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim()
            .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/giu, '[DATABASE_URL_REDACTED]')
            .replace(/\b(password|token|secret|authorization)\b[\s:=]+[^\s,;]+/giu, '$1=[REDACTED]')
            .replace(/\b[A-Za-z0-9_-]{32,}\b/gu, '[OPAQUE_VALUE_REDACTED]')
            .slice(0, 240) ?? 'NO_STDERR_LINE';
          reject(new Error(
            `ATTACK045_COMMIT_ACK_CHILD_EXITED_EARLY:${code}:${marker}:stderr-category=${childStderrCategory}:stderr=${safeStderrSample}`,
          ));
        }
      });
    });
    await ackLost;
    assert.deepEqual(await stateCounts(admin), {
      sources: 1,
      rights_guards: 1,
      policies: 1,
      exclusions: 3,
      receipts: 1,
      articles: 1,
      versions: 1,
      events: 0,
    });
    const execute = await admin.query(
      `SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE') AS can_execute`,
      [invokerName, functionName],
    );
    assert.equal(execute.rows[0].can_execute, false);
    assert.equal(child.kill('SIGKILL'), true);
    await new Promise((resolve, reject) => {
      child.once('exit', (code, signal) => {
        if (signal === 'SIGKILL' || code !== 0) resolve();
        else reject(new Error('ATTACK045_UNCERTAIN_PROCESS_WAS_NOT_KILLED'));
      });
    });
    childFinished = true;

    const recoveryCode = String.raw`
      import { Client } from 'pg';
      const client = new Client({ connectionString: process.env.DIALEKTIK_ATTACK045_ADMIN_URL });
      try {
        await client.connect();
        const result = await client.query(
          'SELECT count(*)::int AS receipts FROM public.live_acquisition_receipts WHERE source_item_id=$1',
          ['86f4abba-9eaa-412f-b048-5ed30aa74201'],
        );
        process.stdout.write(result.rows[0].receipts === 1
          ? 'ATTACK045_RESTART_RECOVERY_FOUND_COMMITTED_RECEIPT\\n'
          : 'ATTACK045_RESTART_RECOVERY_STATE_MISMATCH\\n');
      } finally {
        await client.end().catch(() => undefined);
      }
    `;
    const recovery = spawn(process.execPath, ['--input-type=module', '-e', recoveryCode], {
      cwd: process.cwd(),
      env: { ...process.env, DIALEKTIK_ATTACK045_ADMIN_URL: adminUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let recoveryOutput = '';
    let recoveryErrors = '';
    recovery.stdout.on('data', (chunk) => { recoveryOutput += chunk.toString('utf8'); });
    recovery.stderr.on('data', () => { recoveryErrors += 'redacted'; });
    const recoveryExit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        recovery.kill('SIGKILL');
        reject(new Error('ATTACK045_RESTART_RECOVERY_TIMEOUT'));
      }, 10_000);
      recovery.once('error', () => {
        clearTimeout(timeout);
        reject(new Error('ATTACK045_RESTART_RECOVERY_PROCESS_ERROR'));
      });
      recovery.once('exit', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    assert.equal(recoveryExit, 0, `recovery process failed (${recoveryErrors.length ? 'stderr captured' : 'no stderr'})`);
    assert.ok(recoveryOutput.includes('ATTACK045_RESTART_RECOVERY_FOUND_COMMITTED_RECEIPT'));
    assert.deepEqual(await stateCounts(admin), {
      sources: 1,
      rights_guards: 1,
      policies: 1,
      exclusions: 3,
      receipts: 1,
      articles: 1,
      versions: 1,
      events: 0,
    });
  } finally {
    if (!childFinished && child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await new Promise((resolve) => server.close(resolve));
  }
  process.stdout.write('ATTACK045_COMMIT_ACK_LOST_PROCESS_KILLED_RECOVERED=PASS\n');
}

async function testSigkillBeforeCommit(metadata) {
  const childCode = String.raw`
    import { Client } from 'pg';
    const client = new Client({connectionString:process.env.DIALEKTIK_ATTACK044_INVOKER_URL,application_name:'attack044-sigkill-before-commit'});
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)',[process.env.DIALEKTIK_ATTACK044_METADATA]);
    process.stdout.write('ATTACK044_TRANSACTION_OPEN\n');
    await new Promise(()=>{});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DIALEKTIK_ATTACK044_INVOKER_URL: invokerConnectionString(invokerPassword),
      DIALEKTIK_ATTACK044_METADATA: JSON.stringify(metadata),
    },
    stdio: ['ignore','pipe','pipe'],
  });
  let output = '';
  let stderrCaptured = false;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SIGKILL test child did not open the transaction')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('ATTACK044_TRANSACTION_OPEN')) { clearTimeout(timeout); resolve(); }
    });
    child.stderr.on('data', () => { stderrCaptured = true; });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code, signal) => {
      if (!output.includes('ATTACK044_TRANSACTION_OPEN')) {
        clearTimeout(timeout);
        reject(new Error(
          `SIGKILL child exited before transaction marker (${code}/${signal}; ${stderrCaptured ? 'stderr redacted' : 'no stderr'})`,
        ));
      }
    });
  });
  await ready;
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(child.kill('SIGKILL'), true);
  await exited;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sessions = await admin.query(`SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE application_name='attack044-sigkill-before-commit'`);
    if (sessions.rows[0].count === 0) break;
    await delay(25);
  }
  assert.deepEqual(await stateCounts(admin), {
    sources: 0, rights_guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0,
  });
  process.stdout.write('ATTACK044_SIGKILL_BEFORE_COMMIT_ROLLED_BACK=PASS\n');
}

async function grantOneShot(connection = admin) {
  await connection.query(`GRANT EXECUTE ON FUNCTION ${functionName} TO ${invokerName}`);
}

async function invokeAsInvoker(
  metadata,
  applicationName = 'attack044-invoker-call',
  selectedDatabase = databaseName,
) {
  const connection = new Client({
    connectionString: invokerConnectionString(invokerPassword, port, selectedDatabase),
    application_name: applicationName,
    connectionTimeoutMillis: 3_000,
  });
  await connection.connect();
  try {
    const result = await connection.query(
      `SELECT * FROM ${functionName.replace('(jsonb)', '')}($1::jsonb)`,
      [JSON.stringify(metadata)],
    );
    return result.rows[0];
  } finally {
    await connection.end();
  }
}

async function testRevokedGrantBeforeFirstInvocation(selectedDatabase) {
  const raceAdmin = raceAdmins.get(selectedDatabase);
  assert.ok(raceAdmin, `missing isolated revocation database ${selectedDatabase}`);
  const before = await stateCounts(raceAdmin);
  assert.deepEqual(before, {
    sources: 0,
    rights_guards: 0,
    policies: 0,
    exclusions: 0,
    receipts: 0,
    articles: 0,
    versions: 0,
    events: 0,
  });
  await grantOneShot(raceAdmin);
  const beforeRevocation = await raceAdmin.query(
    `SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE') AS can_execute`,
    [invokerName, functionName],
  );
  assert.equal(beforeRevocation.rows[0].can_execute, true);
  await raceAdmin.query(`REVOKE EXECUTE ON FUNCTION ${functionName} FROM ${invokerName}`);
  const afterRevocation = await raceAdmin.query(
    `SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE') AS can_execute`,
    [invokerName, functionName],
  );
  assert.equal(afterRevocation.rows[0].can_execute, false);
  const payload = makePayload();
  const attempts = await Promise.allSettled([
    invokeAsInvoker(payload, 'attack045-revoked-before-start-a', selectedDatabase),
    invokeAsInvoker(payload, 'attack045-revoked-before-start-b', selectedDatabase),
  ]);
  assert.ok(attempts.every((attempt) =>
    attempt.status === 'rejected' && attempt.reason.code === '42501'));
  assert.deepEqual(await stateCounts(raceAdmin), before);
  const sessions = await raceAdmin.query(
    `SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE usename=$1`,
    [invokerName],
  );
  assert.equal(sessions.rows[0].count, 0);
  process.stdout.write('ATTACK045_REVOKED_BEFORE_START_NO_INVOCATION_NO_ROWS=PASS\n');
}

async function runFirstInvocationRace(selectedDatabase, launchOrder) {
  const raceAdmin = raceAdmins.get(selectedDatabase);
  assert.ok(raceAdmin, `missing isolated race database ${selectedDatabase}`);
  assert.deepEqual([...launchOrder].sort(), ['A', 'B']);
  const before = await stateCounts(raceAdmin);
  assert.deepEqual(before, {
    sources: 0,
    rights_guards: 0,
    policies: 0,
    exclusions: 0,
    receipts: 0,
    articles: 0,
    versions: 0,
    events: 0,
  });
  const semanticsBefore = await semanticCounts(raceAdmin);
  assert.ok(semanticsBefore.every(([, count]) => count === 0));

  const payload = makePayload();
  const clients = new Map();
  const pendingCalls = new Map();
  let barrierHeld = false;
  let resultRows = [];
  try {
    await raceAdmin.query('SELECT pg_catalog.pg_advisory_lock(20261018, 86)');
    barrierHeld = true;
    await grantOneShot(raceAdmin);

    for (const label of ['A', 'B']) {
      const applicationName = `attack045-${selectedDatabase}-${label}`;
      const client = new Client({
        connectionString: invokerConnectionString(invokerPassword, port, selectedDatabase),
        application_name: applicationName,
        connectionTimeoutMillis: 3_000,
      });
      clients.set(label, { applicationName, client });
      await client.connect();
      const identity = await client.query(`
        SELECT session_user::text AS session_user, current_user::text AS current_user,
          pg_catalog.pg_backend_pid() AS pid
      `);
      assert.equal(identity.rows[0].session_user, invokerName);
      assert.equal(identity.rows[0].current_user, invokerName);
    }
    const identities = await Promise.all([...clients.values()].map(async ({ client }) => {
      const result = await client.query(`
        SELECT session_user::text AS session_user, pg_catalog.pg_backend_pid() AS pid
      `);
      return result.rows[0];
    }));
    assert.equal(identities[0].session_user, invokerName);
    assert.equal(identities[1].session_user, invokerName);
    assert.notEqual(identities[0].pid, identities[1].pid);

    // The external session holds the exact transaction advisory lock used by 043.
    // Admit one query at a time to prove its backend reached the real lock queue;
    // only then admit the second query. This varies arrival order without changing
    // the function, its transaction, or the authorization check.
    let lockWaiters = [];
    for (let index = 0; index < launchOrder.length; index += 1) {
      const label = launchOrder[index];
      const { client } = clients.get(label);
      const promise = client.query(
        `SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)`,
        [JSON.stringify(payload)],
      ).then(
        (result) => ({ label, kind: 'fulfilled', row: result.rows[0] }),
        (error) => ({ label, kind: 'rejected', sqlstate: error.code }),
      );
      pendingCalls.set(label, promise);
      const admittedNames = launchOrder.slice(0, index + 1)
        .map((admittedLabel) => clients.get(admittedLabel).applicationName);
      const deadline = Date.now() + 15_000;
      lockWaiters = [];
      while (Date.now() < deadline) {
        const waiting = await raceAdmin.query(`
          SELECT activity.pid::int AS pid, activity.application_name,
            lock.waitstart::text AS waitstart
          FROM pg_catalog.pg_locks AS lock
          JOIN pg_catalog.pg_stat_activity AS activity USING (pid)
          WHERE lock.locktype = 'advisory'
            AND lock.classid = 20261018::oid
            AND lock.objid = 86::oid
            AND lock.objsubid = 2
            AND NOT lock.granted
            AND activity.usename = $1
            AND activity.application_name = ANY($2::text[])
            AND activity.query LIKE '%persist_govuk_rsh_metadata_once%'
          ORDER BY activity.application_name
        `, [invokerName, admittedNames]);
        lockWaiters = waiting.rows;
        if (lockWaiters.length === index + 1) break;
        await delay(10);
      }
      assert.equal(
        lockWaiters.length,
        index + 1,
        `invocation ${label} must be observed in the actual advisory-lock wait queue`,
      );
    }
    assert.equal(lockWaiters.length, 2, 'both calls must be concurrently waiting on the function lock');
    assert.equal(new Set(lockWaiters.map((row) => row.pid)).size, 2);
    assert.ok(lockWaiters.every((row) => row.waitstart), 'PostgreSQL reports a wait start for each barrier participant');
    const expectedApplicationNames = launchOrder
      .map((label) => clients.get(label).applicationName)
      .sort();
    assert.deepEqual(
      lockWaiters.map((row) => row.application_name).sort(),
      expectedApplicationNames,
    );
    process.stdout.write(
      `ATTACK045_BARRIER_CONFIRMED db=${selectedDatabase} launch=${launchOrder.join('>')} ` +
      `principal=${invokerName} waiters=${lockWaiters.length} ` +
      `pids=${lockWaiters.map((row) => `${row.application_name}:${row.pid}`).join(',')} ` +
      `waitstart=${lockWaiters.map((row) => `${row.application_name}:${row.waitstart}`).join(',')}\n`,
    );

    const unlocked = await raceAdmin.query('SELECT pg_catalog.pg_advisory_unlock(20261018, 86) AS unlocked');
    assert.equal(unlocked.rows[0].unlocked, true);
    barrierHeld = false;
    resultRows = await Promise.all(pendingCalls.values());
  } finally {
    if (barrierHeld) {
      await raceAdmin.query('SELECT pg_catalog.pg_advisory_unlock(20261018, 86)').catch(() => undefined);
    }
    await Promise.allSettled(pendingCalls.values());
    await Promise.allSettled([...clients.values()].map(({ client }) => client.end()));
  }

  const successes = resultRows.filter((row) => row.kind === 'fulfilled');
  const failures = resultRows.filter((row) => row.kind === 'rejected');
  assert.equal(successes.length, 1, 'exactly one first invocation must consume the one-shot authorization');
  assert.equal(successes[0].row.result_state, 'persisted');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].sqlstate, '42501');
  const expected = {
    sources: 1,
    rights_guards: 1,
    policies: 1,
    exclusions: 3,
    receipts: 1,
    articles: 1,
    versions: 1,
    events: 0,
  };
  assert.deepEqual(await stateCounts(raceAdmin), expected);
  assert.deepEqual(await semanticCounts(raceAdmin), semanticsBefore);
  const consumed = await raceAdmin.query(
    `SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE') AS can_execute,
      (SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE usename=$1) AS active_sessions`,
    [invokerName, functionName],
  );
  assert.deepEqual(consumed.rows[0], { can_execute: false, active_sessions: 0 });

  for (const label of ['A', 'B']) {
    await assert.rejects(
      invokeAsInvoker(payload, `attack045-${selectedDatabase}-${label}-retry`, selectedDatabase),
      (error) => error.code === '42501',
    );
  }
  await grantOneShot(raceAdmin);
  const replay = await invokeAsInvoker(
    payload,
    `attack045-${selectedDatabase}-authorized-replay`,
    selectedDatabase,
  );
  assert.equal(replay.result_state, 'already_persisted');
  assert.deepEqual(await stateCounts(raceAdmin), expected);
  const replayConsumed = await raceAdmin.query(
    `SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE') AS can_execute`,
    [invokerName, functionName],
  );
  assert.equal(replayConsumed.rows[0].can_execute, false);
  process.stdout.write(
    `ATTACK045_FIRST_RACE_PASS db=${selectedDatabase} launch=${launchOrder.join('>')} ` +
    `winner=${successes[0].label} loser=${failures[0].label} rows=9 replay=ALREADY_PERSISTED\n`,
  );
}

async function main() {
  await admin.connect();
  const version = await admin.query(`SELECT current_setting('server_version') AS version,
    current_database() AS database_name, current_user AS current_user`);
  assert.match(version.rows[0].version, /^17\.11(?:\.|\s|$)/u);
  assert.equal(version.rows[0].database_name, databaseName);
  assert.equal(version.rows[0].current_user, 'postgres');
  const prior = await admin.query(`SELECT count(*)::int AS count FROM public.kysely_migration`);
  assert.equal(prior.rows[0].count, 42, 'fresh setup must have 001-042 only before candidate 043');
  await testMigration043Down();
  await migration043();
  const installed = await admin.query(`SELECT name FROM public.kysely_migration WHERE name LIKE '04%' ORDER BY name`);
  assert.deepEqual(installed.rows.map((row) => row.name), [
    '040_live_core_column_read',
    '041_govuk_product_metadata_writer',
    '042_govuk_product_writer_row_scope',
    '043_govuk_rsh_one_shot_metadata',
    '044_govuk_rsh_receipt_recovery',
  ]);
  await createAttack047RecoveryDatabaseClone();
  await createRaceDatabaseClones();

  invokerPassword = randomBytes(48).toString('base64url');
  // The password exists only in this test process and the loopback PostgreSQL exchange.
  // Server statement logging is disabled by the fresh-cluster runner.
  await admin.query(`ALTER ROLE ${invokerName} LOGIN PASSWORD '${invokerPassword}'`);
  await runFirstInvocationRace(raceDatabaseNames[0], ['A', 'B']);
  await runFirstInvocationRace(raceDatabaseNames[1], ['B', 'A']);
  await testRevokedGrantBeforeFirstInvocation(raceDatabaseNames[2]);
  invoker = new Client({
    connectionString: invokerConnectionString(invokerPassword),
    application_name: 'attack044-restricted-invoker',
    connectionTimeoutMillis: 3_000,
  });
  await invoker.connect();
  const login = await invoker.query(`SELECT session_user::text AS session_user,current_user::text AS current_user`);
  assert.deepEqual(login.rows[0], { session_user: invokerName, current_user: invokerName });
  const before = await stateCounts(admin);
  assert.deepEqual(before, { sources: 0, rights_guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0 });
  const semanticsBefore = await semanticCounts(admin);
  assert.ok(semanticsBefore.every(([, count]) => count === 0));

  await roleAndFunctionAudit(admin);
  await assert.rejects(
    invoker.query(`SELECT * FROM ${functionName.replace('(jsonb)', '')}($1::jsonb)`, [JSON.stringify(makePayload())]),
    (error) => error.code === '42501',
  );
  await assert.rejects(invoker.query(`SET ROLE ${writerName}`), (error) => error.code === '42501');
  await assert.rejects(
    invoker.query('INSERT INTO public.sources(id) VALUES ($1::public.dialektik_ulid)', [sourceId]),
    (error) => error.code === '42501',
  );
  process.stdout.write('ATTACK044_NO_EXECUTE_NO_SET_ROLE_NO_DIRECT_INSERT=PASS\n');

  const payload = makePayload();
  await grantOneShot();
  await assert.rejects(
    invoker.query(`SELECT * FROM ${functionName.replace('(jsonb)', '')}($1::jsonb)`, [JSON.stringify({ ...payload, articleId })]),
    (error) => error.code === '22023',
  );
  assert.deepEqual(await stateCounts(admin), before);
  process.stdout.write('ATTACK044_EXTRA_ID_PAYLOAD_REJECTED=PASS\n');

  await invoker.query('BEGIN');
  const rolledBack = await invoker.query(
    `SELECT * FROM ${functionName.replace('(jsonb)', '')}($1::jsonb)`, [JSON.stringify(payload)],
  );
  assert.equal(rolledBack.rows[0].result_state, 'persisted');
  await invoker.query('ROLLBACK');
  assert.deepEqual(await stateCounts(admin), before);
  const rollbackGrant = await admin.query(`SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE') AS execute`, [invokerName, functionName]);
  assert.equal(rollbackGrant.rows[0].execute, true, 'ROLLBACK also restores the consumed EXECUTE grant');
  process.stdout.write('ATTACK044_SQL_ROLLBACK_ATOMIC=PASS\n');

  await invoker.end();
  invoker = undefined;
  await testSigkillBeforeCommit(payload);
  await proxyDropCommitAck(payload);

  const persisted = await stateCounts(admin);
  const expected = { sources: 1, rights_guards: 1, policies: 1, exclusions: 3, receipts: 1, articles: 1, versions: 1, events: 0 };
  assert.deepEqual(persisted, expected);
  const semanticsAfter = await semanticCounts(admin);
  assert.deepEqual(semanticsAfter, semanticsBefore);
  const article = await admin.query(`
    SELECT a.id::text AS article_id,a.text_original,a.text_normalized,a.lang,a.url_canonical,a.event_id,
      a.origin,v.id::text AS version_id,v.excerpt,v.author,v.declared_upstream,r.id::text AS receipt_id
    FROM public.articles a JOIN public.live_article_versions v ON v.article_id=a.id
      JOIN public.live_acquisition_receipts r ON r.id=v.receipt_id
    WHERE a.id=$1::public.dialektik_ulid
  `, [articleId]);
  assert.deepEqual(article.rows[0], {
    article_id: articleId,
    text_original: title,
    text_normalized: title,
    lang: 'en',
    url_canonical: canonicalUrl,
    event_id: null,
    origin: 'LIVE_REAL',
    version_id: versionId,
    excerpt: null,
    author: null,
    declared_upstream: null,
    receipt_id: receiptId,
  });
  const postCommitExecute = await admin.query(`SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE') AS execute`, [invokerName, functionName]);
  assert.equal(postCommitExecute.rows[0].execute, false);
  await assert.rejects(
    invokeAsInvoker(payload),
    (error) => error.code === '42501',
  );
  process.stdout.write('ATTACK044_EXACT_NINE_ROWS_NO_SEMANTICS=PASS\n');

  await grantOneShot();
  const replay = await invokeAsInvoker(payload, 'attack044-idempotent-replay');
  assert.equal(replay.result_state, 'already_persisted');
  assert.deepEqual(await stateCounts(admin), expected);
  process.stdout.write('ATTACK044_REPLAY_IDEMPOTENT_NO_DUPLICATES=PASS\n');

  await grantOneShot();
  const concurrency = await Promise.allSettled([
    invokeAsInvoker(payload, 'attack044-concurrent-a'),
    invokeAsInvoker(payload, 'attack044-concurrent-b'),
  ]);
  const successes = concurrency.filter((outcome) => outcome.status === 'fulfilled');
  const failures = concurrency.filter((outcome) => outcome.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.deepEqual(await stateCounts(admin), expected);
  process.stdout.write('ATTACK044_CONCURRENT_REPLAY_ONE_AUTHORITY_NO_DUPLICATES=PASS\n');

  await grantOneShot();
  const altered = { ...payload, acquiredAt: new Date(Date.parse(payload.acquiredAt) + 1_000).toISOString() };
  await assert.rejects(
    invokeAsInvoker(altered, 'attack044-altered-payload'),
    (error) => /GOVUK_RSH_PARTIAL_OR_CONFLICTING_EXISTENCE/u.test(error.message),
  );
  await admin.query(`REVOKE EXECUTE ON FUNCTION ${functionName} FROM ${invokerName}`);
  await assert.rejects(
    invokeAsInvoker(altered),
    (error) => error.code === '42501',
  );
  assert.deepEqual(await stateCounts(admin), expected);
  process.stdout.write('ATTACK044_ALTERED_PAYLOAD_CANNOT_REUSE_AUTHORIZATION=PASS\n');

  const final = await admin.query(`
    SELECT
      (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=$1) AS invoker_login,
      (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=$2) AS writer_login,
      (SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE usename=$1) AS invoker_sessions,
      (SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE usename=$2) AS writer_sessions,
      pg_catalog.has_function_privilege($1,$3,'EXECUTE') AS invoker_execute
  `, [invokerName, writerName, functionName]);
  assert.deepEqual(final.rows[0], {
    invoker_login: true, writer_login: false, invoker_sessions: 0, writer_sessions: 0, invoker_execute: false,
  });
  process.stdout.write('ATTACK044_LOCAL_TESTS=PASS\n');
}

try {
  await main();
} catch (error) {
  let detail = String(error?.message ?? error)
    .replaceAll(invokerPassword ?? '\u0000', '[secret-redacted]')
    .replaceAll(adminUrl, '[connection-redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[connection-redacted]');
  detail = detail.replace(/\bpassword\b[^\n]*/giu, 'password [redacted]');
  process.stderr.write(
    'ATTACK044_FAILURE=' + (error?.code ?? error?.name ?? 'UNKNOWN') + ':' + detail.slice(0, 700) + '\n',
  );
  process.exitCode = 1;
} finally {
  await invoker?.end().catch(() => undefined);
  await Promise.allSettled([...raceAdmins.values()].map((connection) => connection.end()));
  if (admin._connected) {
    await admin.query(`REVOKE EXECUTE ON FUNCTION ${functionName} FROM ${invokerName}`).catch(() => undefined);
    await admin.query(`SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE usename=$1 AND pid<>pg_catalog.pg_backend_pid()`, [invokerName]).catch(() => undefined);
    await admin.query(`ALTER ROLE ${invokerName} NOLOGIN PASSWORD NULL`).catch(() => undefined);
  }
  await admin.end().catch(() => undefined);
  if (database) await destroyDatabase(database).catch(() => undefined);
}


