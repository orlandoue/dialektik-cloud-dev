import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connect as netConnect, createServer } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { createDatabase, destroyDatabase } from '@dialektik/database';
import { Migrator, sql } from 'kysely';
import { nearDuplicateSignature } from '../dist/live/live.adapter.js';

const require = createRequire(import.meta.url);
const { DialektikMigrationProvider } = require('../../../packages/database/dist/migration/provider.js');
const targetSourceId = '01M4YDQK00WS344WW8RCPCEQHE';
const sourceItemId = '86f4abba-9eaa-412f-b048-5ed30aa74201';
const targetUrl = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh';
const functionName = 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)';
const writerName = 'dialektik_govuk_metadata_writer';
const adminPassword = process.env.DIALEKTIK_GOVUK_ONE_SHOT_TEST_ADMIN_PASSWORD;
const bootstrapPassword = process.env.DIALEKTIK_GOVUK_ONE_SHOT_TEST_BOOTSTRAP_PASSWORD;
assert.ok(adminPassword && adminPassword.length >= 40, 'A per-run administrator SCRAM password is required');
assert.ok(bootstrapPassword && bootstrapPassword.length >= 40, 'A per-run bootstrap SCRAM password is required');

function localUrl(name, expectedPassword) {
  const raw = process.env[name];
  assert.ok(raw, `${name} is required`);
  const url = new URL(raw);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55442');
  assert.equal(url.pathname, '/dialektik_attack043');
  if (decodeURIComponent(url.password) !== expectedPassword) {
    throw new Error('DIALEKTIK_GOVUK_ONE_SHOT_TEST_AUTH_INVALID');
  }
  return url;
}

const postgresUrl = localUrl('DIALEKTIK_GOVUK_ONE_SHOT_TEST_ADMIN_URL', adminPassword);
const bootstrapUrl = localUrl('DIALEKTIK_GOVUK_ONE_SHOT_TEST_BOOTSTRAP_URL', bootstrapPassword);
assert.equal(decodeURIComponent(postgresUrl.username), 'postgres');
assert.equal(decodeURIComponent(bootstrapUrl.username), 'bootstrap_admin');

const postgresConnectionString = postgresUrl.toString();
const bootstrap = new Client({ connectionString: bootstrapUrl.toString(), application_name: 'govuk-one-shot-bootstrap-check' });
const db = createDatabase({
  applicationName: 'govuk-one-shot-pg17-acceptance',
  connectionString: postgresConnectionString,
  maxConnections: 2,
  connectionTimeoutMillis: 3_000,
});
let client;

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function makeMetadata(acquiredAt = new Date(Date.now() - 5_000).toISOString()) {
  const articleId = '01M4YDQK00WS344WW8RCPCEQHF';
  const receiptId = '01M4YDQK00WS344WW8RCPCEQHG';
  const versionId = '01M4YDQK00WS344WW8RCPCEQHH';
  const publishedAt = '2026-10-07T08:30:03.000Z';
  const modifiedAt = publishedAt;
  const fields = {
    sourceItemId,
    canonicalUrl: targetUrl,
    title: 'Social housing landlord downgraded by RSH',
    publisher: 'Regulator of Social Housing',
    publishedAt,
    modifiedAt,
    locale: 'en',
    rightsEvidenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    rightsVerifiedAt: '2026-10-15T00:00:00.000Z',
    attribution: '© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0.',
    discoveryChannel: 'official_api',
    discoveryUrl: 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh',
  };
  return {
    articleId,
    receiptId,
    versionId,
    publishedAt,
    modifiedAt,
    acquiredAt,
    metadataHash: sha256(JSON.stringify(fields)),
  };
}

async function authorizeAndCall(connection, metadata) {
  await connection.query('BEGIN');
  try {
    await connection.query(`GRANT ${writerName} TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    await connection.query(`GRANT USAGE ON SCHEMA dialektik_ops TO ${writerName}`);
    await connection.query(`SET ROLE ${writerName}`);
    await connection.query(`GRANT EXECUTE ON FUNCTION ${functionName} TO postgres`);
    await connection.query('RESET ROLE');
    const result = await connection.query(
      'SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)',
      [JSON.stringify(metadata)],
    );
    await connection.query(`REVOKE ${writerName} FROM postgres`);
    await connection.query(`REVOKE USAGE ON SCHEMA dialektik_ops FROM ${writerName}`);
    return result.rows[0];
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function rowCounts(connection) {
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
  `, [targetSourceId, sourceItemId, targetUrl]);
  return result.rows[0];
}

async function semanticSnapshot(connection) {
  const relations = await connection.query(`
    SELECT c.relname AS name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (c.relname ILIKE '%semantic%' OR c.relname ILIKE '%occurrence%'
        OR c.relname ILIKE '%thread%' OR c.relname ILIKE '%claim%')
    ORDER BY c.relname
  `);
  const counts = [];
  for (const row of relations.rows) {
    const quoted = `public."${String(row.name).replaceAll('"', '""')}"`;
    const result = await connection.query(`SELECT count(*)::int AS count FROM ${quoted}`);
    counts.push([row.name, result.rows[0].count]);
  }
  return counts;
}

async function dropCommitAcknowledgement(metadata) {
  const server = createServer((frontend) => {
    const backend = netConnect(55442, '127.0.0.1');
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
    frontend.on('error', () => close());
    backend.on('error', () => close());
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
          const query = frontBuffer.subarray(offset + 5, offset + size + 1).toString('utf8').replace(/\0+$/u, '').trim();
          if (/^COMMIT;?$/iu.test(query)) dropNextReady = true;
        }
        offset += size + 1;
      }
      const forward = frontBuffer.subarray(0, offset);
      if (forward.length > 0) backend.write(forward);
      frontBuffer = frontBuffer.subarray(offset);
    });
    backend.on('data', (chunk) => {
      backBuffer = Buffer.concat([backBuffer, chunk]);
      let offset = 0;
      while (backBuffer.length - offset >= 5) {
        const type = String.fromCharCode(backBuffer[offset]);
        const size = backBuffer.readInt32BE(offset + 1);
        if (size < 4 || backBuffer.length - offset < size + 1) break;
        const frameEnd = offset + size + 1;
        if (type === 'Z' && dropNextReady) {
          const beforeReady = backBuffer.subarray(0, offset);
          if (beforeReady.length > 0) frontend.write(beforeReady);
          close();
          return;
        }
        offset = frameEnd;
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
  const url = new URL(postgresConnectionString);
  url.port = String(address.port);
  const uncertain = new Client({ connectionString: url.toString(), application_name: 'govuk-one-shot-commit-ack-loss' });
  // pg emits an EventEmitter error as well as rejecting the in-flight query when
  // the proxy closes after COMMIT; consume the event so the expected rejection is testable.
  uncertain.on('error', () => undefined);
  try {
    await uncertain.connect();
    await uncertain.query('BEGIN');
    await uncertain.query(`GRANT ${writerName} TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    await uncertain.query(`GRANT USAGE ON SCHEMA dialektik_ops TO ${writerName}`);
    await uncertain.query(`SET ROLE ${writerName}`);
    await uncertain.query(`GRANT EXECUTE ON FUNCTION ${functionName} TO postgres`);
    await uncertain.query('RESET ROLE');
    await uncertain.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)', [JSON.stringify(metadata)]);
    await uncertain.query(`REVOKE ${writerName} FROM postgres`);
    await uncertain.query(`REVOKE USAGE ON SCHEMA dialektik_ops FROM ${writerName}`);
    await assert.rejects(uncertain.query('COMMIT'));
    process.stdout.write('PG17_COMMIT_ACK_LOST_TO_CLIENT=PASS\n');
  } finally {
    await uncertain.end().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function killBeforeCommit(metadata) {
  const code = String.raw`
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: process.env.DIALEKTIK_GOVUK_ONE_SHOT_TEST_ADMIN_URL,
      application_name: 'govuk-one-shot-sigkill-before-commit',
    });
    await client.connect();
    await client.query('BEGIN');
    await client.query('GRANT dialektik_govuk_metadata_writer TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');
    await client.query('GRANT USAGE ON SCHEMA dialektik_ops TO dialektik_govuk_metadata_writer');
    await client.query('SET ROLE dialektik_govuk_metadata_writer');
    await client.query('GRANT EXECUTE ON FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(jsonb) TO postgres');
    await client.query('RESET ROLE');
    await client.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)', [process.env.DIALEKTIK_GOVUK_TEST_METADATA]);
    process.stdout.write('ONE_SHOT_TX_READY\n');
    await new Promise(() => {});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    env: { ...process.env, DIALEKTIK_GOVUK_TEST_METADATA: JSON.stringify(metadata) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SIGKILL test child did not reach pre-commit marker')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('ONE_SHOT_TX_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => { errors += chunk.toString('utf8'); });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (codeValue, signal) => {
      if (!output.includes('ONE_SHOT_TX_READY')) {
        clearTimeout(timeout);
        reject(new Error(`SIGKILL test child exited before marker (${codeValue}/${signal}): ${errors}`));
      }
    });
  });
  try {
    await ready;
  } catch (error) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
    throw error;
  }
  const exited = new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  assert.equal(child.kill('SIGKILL'), true, 'child process should be terminable before COMMIT');
  await exited;
}

async function main() {
  await bootstrap.connect();
  const version = await bootstrap.query("SELECT current_setting('server_version') AS version");
  assert.match(version.rows[0].version, /^17\.11(?:\.|\s|$)/u);
  const migrationState = await sql`
    SELECT name FROM public.kysely_migration
    WHERE name IN ('042_govuk_product_writer_row_scope','043_govuk_rsh_one_shot_metadata')
    ORDER BY name
  `.execute(db);
  const recoveryMode = migrationState.rows.some((row) => row.name === '043_govuk_rsh_one_shot_metadata');
  assert.deepEqual(migrationState.rows.map((row) => row.name), recoveryMode
    ? ['042_govuk_product_writer_row_scope', '043_govuk_rsh_one_shot_metadata']
    : ['042_govuk_product_writer_row_scope']);

  const managed = await clientState(
    postgresConnectionString,
    `SELECT r.rolsuper AS superuser, r.rolcreaterole AS createrole,
      pg_catalog.has_database_privilege('postgres', current_database(), 'CREATE') AS db_create,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members membership
        WHERE membership.member='postgres'::regrole
          AND membership.roleid=$1::regrole AND membership.admin_option
      ) AS writer_admin
     FROM pg_catalog.pg_roles r WHERE r.rolname='postgres'`,
    [writerName],
  );
  assert.deepEqual(managed.rows[0], { superuser: true, createrole: true, db_create: true, writer_admin: false });
  process.stdout.write('PG17_LOCAL_SUPERUSER_CAPABILITY_PREFLIGHT=PASS (managed non-superuser path not simulated)\n');

  if (recoveryMode) {
    process.stdout.write('PG17_MIGRATION_043_ALREADY_APPLIED_TO_DISPOSABLE_TEST_DB=REVERIFIED\n');
  } else {
    const provider = new DialektikMigrationProvider();
    const migrated = await new Migrator({ db, provider }).migrateToLatest();
    if (migrated.error) throw migrated.error;
    assert.deepEqual(migrated.results?.map((row) => row.migrationName), ['043_govuk_rsh_one_shot_metadata']);
    process.stdout.write('PG17_MIGRATION_043_APPLIED_TO_DISPOSABLE_TEST_DB=PASS\n');
  }

  client = new Client({ connectionString: postgresConnectionString, application_name: 'govuk-one-shot-pg17-integration' });
  await client.connect();
  const catalog = await client.query(`
    SELECT
      p.prosecdef AS security_definer,
      p.proowner::regrole::text AS owner,
      p.proconfig AS config,
      pg_catalog.has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute,
      pg_catalog.has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute,
      pg_catalog.has_function_privilege('dialektik_core_app', $1, 'EXECUTE') AS core_execute,
      pg_catalog.has_function_privilege('postgres', $1, 'EXECUTE') AS postgres_execute,
      EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) AS privilege
        WHERE privilege.grantee='postgres'::regrole AND privilege.privilege_type='EXECUTE'
      ) AS postgres_explicit_execute,
      pg_catalog.has_function_privilege($2, $1, 'EXECUTE') AS writer_execute,
      pg_catalog.has_schema_privilege('anon','dialektik_ops','USAGE') AS anon_schema,
      pg_catalog.has_schema_privilege('authenticated','dialektik_ops','USAGE') AS authenticated_schema,
      pg_catalog.has_schema_privilege('dialektik_core_app','dialektik_ops','USAGE') AS core_schema,
      pg_catalog.has_table_privilege($2,'public.events','INSERT') AS writer_event_insert,
      pg_catalog.has_column_privilege($2,'public.live_article_versions','excerpt','SELECT') AS writer_excerpt_select,
      pg_catalog.has_column_privilege($2,'public.articles','text_original','INSERT') AS writer_title_insert
    FROM pg_catalog.pg_proc p
    WHERE p.oid=$1::regprocedure
  `, [functionName, writerName]);
  assert.equal(catalog.rows.length, 1);
  assert.equal(catalog.rows[0].security_definer, true);
  assert.equal(catalog.rows[0].owner, writerName);
  assert.ok(catalog.rows[0].config.includes('search_path=pg_catalog, pg_temp'));
  assert.ok(catalog.rows[0].config.includes('row_security=on'));
  for (const key of ['anon_execute','authenticated_execute','core_execute','anon_schema','authenticated_schema','core_schema','writer_event_insert']) {
    assert.equal(catalog.rows[0][key], false, key);
  }
  assert.equal(catalog.rows[0].postgres_execute, true, 'local bootstrap superuser bypasses ACL checks');
  assert.equal(catalog.rows[0].postgres_explicit_execute, false, 'migration grants no direct EXECUTE ACL to postgres');
  assert.equal(catalog.rows[0].writer_execute, true, 'function owner retains inherent EXECUTE');
  assert.equal(catalog.rows[0].writer_excerpt_select, true, 'narrow NULL-check column grant is present');
  assert.equal(catalog.rows[0].writer_title_insert, true, 'target metadata insert is column scoped');
  const rightsGuardFunction = await client.query(`
    SELECT p.prosecdef AS security_definer, p.proconfig AS config, p.prosrc AS source
    FROM pg_catalog.pg_proc p
    WHERE p.oid='public.dialektik_seed_prospective_rights_guard()'::regprocedure
  `);
  assert.equal(rightsGuardFunction.rows[0].security_definer, false);
  assert.equal(rightsGuardFunction.rows[0].config, null);
  assert.match(rightsGuardFunction.rows[0].source, /INSERT INTO public\.prospective_content_rights_write_guards/u);
  const validators = await client.query(`
    SELECT p.proname, p.prosecdef AS security_definer, p.proconfig AS config,
      p.proowner::regrole::text AS owner, p.prosrc AS source,
      (SELECT count(*)::int FROM pg_catalog.pg_trigger t
       WHERE t.tgfoid=p.oid AND NOT t.tgisinternal) AS trigger_count
    FROM pg_catalog.pg_proc p
    WHERE p.pronamespace='public'::pg_catalog.regnamespace
      AND p.proname=ANY($1::text[])
    ORDER BY p.proname
  `, [[
    'dialektik_validate_live_article',
    'dialektik_validate_live_receipt',
    'dialektik_validate_live_version',
  ]]);
  assert.deepEqual(validators.rows.map((row) => row.proname), [
    'dialektik_validate_live_article',
    'dialektik_validate_live_receipt',
    'dialektik_validate_live_version',
  ]);
  for (const validator of validators.rows) {
    assert.equal(validator.security_definer, false, `${validator.proname} remains invoker`);
    assert.equal(validator.config, null, `${validator.proname} has no search_path override`);
    assert.equal(validator.owner, 'postgres');
    assert.equal(validator.trigger_count, 1, `${validator.proname} retains one expected trigger`);
  }
  assert.match(validators.rows[0].source, /public\.sources/u);
  assert.match(validators.rows[0].source, /public\.live_source_policies/u);
  assert.match(validators.rows[0].source, /public\.live_exposure_exclusions/u);
  assert.match(validators.rows[1].source, /public\.live_source_policies/u);
  assert.match(validators.rows[1].source, /public\.live_exposure_exclusions/u);
  assert.match(validators.rows[1].source, /public\.sources/u);
  assert.match(validators.rows[2].source, /public\.articles/u);
  assert.match(validators.rows[2].source, /public\.live_acquisition_receipts/u);
  assert.match(validators.rows[2].source, /public\.live_source_policies/u);
  assert.match(validators.rows[2].source, /public\.live_exposure_exclusions/u);
  const writer = await client.query(`
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit,
      (SELECT count(*)::int FROM pg_catalog.pg_stat_activity a WHERE a.usename=$1) AS sessions
    FROM pg_catalog.pg_roles WHERE rolname=$1
  `, [writerName]);
  assert.deepEqual(writer.rows[0], {
    rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, rolbypassrls: false, rolinherit: false, sessions: 0,
  });
  const acl = await client.query(`
    SELECT pg_catalog.has_table_privilege($1,'public.articles','UPDATE') AS article_update,
      pg_catalog.has_table_privilege($1,'public.articles','DELETE') AS article_delete,
      pg_catalog.has_table_privilege($1,'public.events','INSERT') AS events_insert
  `, [writerName]);
  for (const value of Object.values(acl.rows[0])) assert.equal(value, false);
  process.stdout.write('PG17_DEFINER_RLS_ACL_AND_WRITER_NOLOGIN=PASS\n');

  await assert.rejects(
    bootstrap.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)', [JSON.stringify(makeMetadata())]),
    (error) => error.code === '42501',
  );
  process.stdout.write('PG17_NO_ONE_SHOT_GRANT_DENIED=PASS\n');

  const emptyBefore = await rowCounts(client);
  const expectedNineRows = { sources: 1, rights_guards: 1, policies: 1, exclusions: 3, receipts: 1, articles: 1, versions: 1, events: 0 };
  assert.deepEqual(emptyBefore, recoveryMode ? expectedNineRows : {
    sources: 0, rights_guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0,
  });
  const semanticBefore = await semanticSnapshot(client);
  if (recoveryMode) {
    assert.ok(semanticBefore.every(([, count]) => count === 0), 'recovery fixture must contain no semantic rows');
  }
  const persistedAcquisition = recoveryMode ? await client.query(`
    SELECT seen_at FROM public.live_acquisition_receipts
    WHERE id='01M4YDQK00WS344WW8RCPCEQHG'::public.dialektik_ulid
  `) : null;
  if (recoveryMode) assert.equal(persistedAcquisition.rowCount, 1);
  const validMetadata = recoveryMode
    ? makeMetadata(persistedAcquisition.rows[0].seen_at.toISOString())
    : makeMetadata();

  const bad = makeMetadata();
  const outOfScope = { ...bad, body: 'must never persist' };
  await client.query('BEGIN');
  await client.query(`GRANT ${writerName} TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  await client.query(`GRANT USAGE ON SCHEMA dialektik_ops TO ${writerName}`);
  await client.query(`SET ROLE ${writerName}`);
  await client.query(`GRANT EXECUTE ON FUNCTION ${functionName} TO postgres`);
  await client.query('RESET ROLE');
  await assert.rejects(
    client.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)', [JSON.stringify(outOfScope)]),
    (error) => error.code === '22023',
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await rowCounts(client), emptyBefore);
  process.stdout.write('PG17_OUT_OF_SCOPE_PAYLOAD_ROLLED_BACK=PASS\n');

  const rolledBack = validMetadata;
  await client.query('BEGIN');
  await client.query(`GRANT ${writerName} TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  await client.query(`GRANT USAGE ON SCHEMA dialektik_ops TO ${writerName}`);
  await client.query(`SET ROLE ${writerName}`);
  await client.query(`GRANT EXECUTE ON FUNCTION ${functionName} TO postgres`);
  await client.query('RESET ROLE');
  const rollbackResult = await client.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)', [JSON.stringify(rolledBack)]);
  assert.equal(rollbackResult.rows[0].result_state, recoveryMode ? 'already_persisted' : 'persisted');
  await client.query('ROLLBACK');
  assert.deepEqual(await rowCounts(client), emptyBefore);
  const rollbackAcl = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f',p.proowner))) privilege
      WHERE p.oid=$1::regprocedure AND privilege.grantee='postgres'::regrole
        AND privilege.privilege_type='EXECUTE'
    ) AS explicit_execute
  `, [functionName]);
  assert.equal(rollbackAcl.rows[0].explicit_execute, false);
  process.stdout.write('PG17_VALID_CALL_ROLLBACK_ATOMIC=PASS\n');

  await killBeforeCommit(validMetadata);
  let killedSessionCount = 1;
  for (let attempt = 0; attempt < 100 && killedSessionCount > 0; attempt += 1) {
    const sessions = await client.query(`
      SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity
      WHERE application_name='govuk-one-shot-sigkill-before-commit'
    `);
    killedSessionCount = sessions.rows[0].count;
    if (killedSessionCount > 0) await delay(20);
  }
  assert.equal(killedSessionCount, 0, 'SIGKILL should close the pending writer session');
  assert.deepEqual(await rowCounts(client), emptyBefore, 'SIGKILL before COMMIT must roll back all nine rows');
  const killRollback = await client.query(`
    SELECT pg_catalog.has_schema_privilege($1,'dialektik_ops','USAGE') AS writer_schema_usage,
      EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
        WHERE m.roleid=$1::regrole AND m.member='postgres'::regrole AND m.grantor='postgres'::regrole) AS transient_membership,
      EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        WHERE p.oid=$2::regprocedure AND acl.grantee='postgres'::regrole AND acl.privilege_type='EXECUTE') AS transient_execute
  `, [writerName, functionName]);
  assert.deepEqual(killRollback.rows[0], { writer_schema_usage: false, transient_membership: false, transient_execute: false });
  process.stdout.write('PG17_SIGKILL_BEFORE_COMMIT_ROLLBACK_AND_AUTH_CLEANUP=PASS\n');

  const beforeConcurrency = await rowCounts(client);
  assert.deepEqual(beforeConcurrency, emptyBefore);
  const clientB = new Client({ connectionString: postgresConnectionString, application_name: 'govuk-one-shot-concurrent-b' });
  await clientB.connect();
  let directResult;
  try {
    // These two retries carry the same one-shot request. One commit's ReadyForQuery
    // is dropped by the local TCP proxy; the other must serialize on the advisory lock.
    const concurrentMetadata = validMetadata;
    const outcomes = await Promise.allSettled([
      dropCommitAcknowledgement(concurrentMetadata),
      (async () => {
        await delay(15);
        directResult = await authorizeAndCall(clientB, concurrentMetadata);
        await clientB.query('COMMIT');
      })(),
    ]);
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    assert.equal(failures.length, 0, failures.map((outcome) => String(outcome.reason?.code || outcome.reason?.message || outcome.reason)).join('; '));
  } catch (error) {
    await clientB.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await clientB.end().catch(() => undefined);
  }

  const afterCommit = await rowCounts(client);
  assert.deepEqual(afterCommit, { sources: 1, rights_guards: 1, policies: 1, exclusions: 3, receipts: 1, articles: 1, versions: 1, events: 0 });
  const semanticAfter = await semanticSnapshot(client);
  assert.deepEqual(semanticAfter, semanticBefore);
  const article = await client.query(`
    SELECT a.text_original, a.text_normalized, a.lang, a.url_canonical, a.event_id,
      v.excerpt, v.author, v.declared_upstream
    FROM public.articles a JOIN public.live_article_versions v ON v.article_id=a.id
    WHERE a.source_id=$1::public.dialektik_ulid AND a.url_canonical=$2
  `, [targetSourceId, targetUrl]);
  assert.deepEqual(article.rows[0], {
    text_original: 'Social housing landlord downgraded by RSH',
    text_normalized: 'Social housing landlord downgraded by RSH',
    lang: 'en', url_canonical: targetUrl, event_id: null,
    excerpt: null, author: null, declared_upstream: null,
  });
  const finalRole = await client.query(`
    SELECT r.rolcanlogin AS writer_login,
      (SELECT count(*)::int FROM pg_catalog.pg_stat_activity a WHERE a.usename=$1) AS sessions,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f',p.proowner))) privilege
        WHERE p.oid=$2::regprocedure AND privilege.grantee='postgres'::regrole
          AND privilege.privilege_type='EXECUTE'
      ) AS postgres_explicit_execute,
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members m
        WHERE m.roleid=$1::regrole AND m.grantor='postgres'::regrole) AS transient_memberships
    FROM pg_catalog.pg_roles r WHERE r.rolname=$1
  `, [writerName, functionName]);
  assert.deepEqual(finalRole.rows[0], {
    writer_login: false, sessions: 0, postgres_explicit_execute: false, transient_memberships: 0,
  });
  assert.ok(['persisted','already_persisted'].includes(directResult?.result_state));
  await assert.rejects(
    client.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)', [JSON.stringify(makeMetadata())]),
    (error) => error.code === '42501',
  );
  process.stdout.write('PG17_CONCURRENT_ONE_SHOT_AND_COMMIT_ACK_LOSS=PASS\n');
  process.stdout.write('PG17_READ_RECEIPT_BEFORE_RETRY=PASS\n');
  process.stdout.write('PG17_EXPECTED_NINE_ROWS_ZERO_EVENTS_ZERO_SEMANTICS=PASS\n');
}

try {
  await main();
} finally {
  await client?.end().catch(() => undefined);
  await bootstrap.end().catch(() => undefined);
  await destroyDatabase(db);
}

async function clientState(connectionString, text, values) {
  const stateClient = new Client({ connectionString, application_name: 'govuk-one-shot-managed-role-inspection' });
  await stateClient.connect();
  try {
    return await stateClient.query(text, values);
  } finally {
    await stateClient.end();
  }
}

