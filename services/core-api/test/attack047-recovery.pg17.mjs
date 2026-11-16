import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, connect as netConnect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
const dbUrl = requiredEnv('DIALEKTIK_ATTACK047_DATABASE_URL');
const adminUrl = requiredEnv('DIALEKTIK_ATTACK047_ADMIN_URL');
const port = Number(requiredEnv('DIALEKTIK_ATTACK047_PORT'));
const databaseName = requiredEnv('DIALEKTIK_ATTACK047_DATABASE_NAME');
const mode = requiredEnv('DIALEKTIK_ATTACK047_MODE');
const invokerPassword = requiredEnv('DIALEKTIK_ATTACK047_INVOKER_PASSWORD');
const invokerName = 'dialektik_govuk_rsh_invoker';
const writerName = 'dialektik_govuk_metadata_writer';
const migrationNames = ['043_govuk_rsh_one_shot_metadata', '044_govuk_rsh_receipt_recovery'];
const writerFunction = 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)';
const statusFunction = 'dialektik_ops.govuk_rsh_metadata_recovery_status()';
const writerCall = 'dialektik_ops.persist_govuk_rsh_metadata_once';
const sourceId = '01M4YDQK00WS344WW8RCPCEQHE';
const sourceItemId = '86f4abba-9eaa-412f-b048-5ed30aa74201';
const canonicalUrl = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh';
const publishedAt = '2026-10-07T08:30:03.000Z';
const title = 'Social housing landlord downgraded by RSH';

assert.ok(Number.isInteger(port) && port >= 55442 && port <= 55445);
for (const value of [dbUrl, adminUrl]) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, 'postgresql:');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(Number(parsed.port), port);
}
assert.equal(new URL(dbUrl).pathname, '/' + databaseName);
assert.equal(new URL(adminUrl).pathname, '/' + databaseName);
assert.equal(mode === 'before-restart' || mode === 'after-restart', true);

function requiredEnv(name) {
  const value = process.env[name];
  assert.ok(value, name + ' is required');
  return value;
}

function makePayload() {
  const acquiredAt = new Date().toISOString();
  const fields = {
    sourceItemId,
    canonicalUrl,
    title,
    publisher: 'Regulator of Social Housing',
    publishedAt,
    modifiedAt: publishedAt,
    locale: 'en',
    rightsEvidenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    rightsVerifiedAt: '2026-10-15T00:00:00.000Z',
    attribution: '© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0.',
    discoveryChannel: 'official_api',
    discoveryUrl: 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh',
  };
  const metadataHash = createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex');
  return { acquiredAt, metadataHash, modifiedAt: publishedAt, publishedAt };
}

function clientFor(url, applicationName) {
  return new Client({ connectionString: url, application_name: applicationName, connectionTimeoutMillis: 5000 });
}

function urlForDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = '/' + name;
  return parsed.toString();
}

function invokerUrlFor(url, selectedPort = port, selectedDatabase = databaseName) {
  const parsed = new URL(url);
  parsed.username = invokerName;
  parsed.password = invokerPassword;
  parsed.port = String(selectedPort);
  parsed.pathname = '/' + selectedDatabase;
  return parsed.toString();
}

async function counts(connection) {
  const result = await connection.query(
    'SELECT ' +
    '(SELECT count(*)::int FROM public.sources WHERE id=$1::public.dialektik_ulid) AS sources,' +
    '(SELECT count(*)::int FROM public.prospective_content_rights_write_guards WHERE source_id=$1::public.dialektik_ulid) AS guards,' +
    '(SELECT count(*)::int FROM public.live_source_policies WHERE source_id=$1::public.dialektik_ulid) AS policies,' +
    '(SELECT count(*)::int FROM public.live_exposure_exclusions WHERE registry_key=$2 AND source_item_id=$3) AS exclusions,' +
    '(SELECT count(*)::int FROM public.live_acquisition_receipts WHERE source_id=$1::public.dialektik_ulid AND source_item_id=$3) AS receipts,' +
    '(SELECT count(*)::int FROM public.articles WHERE source_id=$1::public.dialektik_ulid AND url_canonical=$4) AS articles,' +
    '(SELECT count(*)::int FROM public.live_article_versions v JOIN public.articles a ON a.id=v.article_id WHERE a.source_id=$1::public.dialektik_ulid AND a.url_canonical=$4) AS versions,' +
    '(SELECT count(*)::int FROM public.events) AS events',
    [sourceId, 'product-govuk-rsh-content-api-v1', sourceItemId, canonicalUrl],
  );
  return result.rows[0];
}

async function semanticCounts(connection) {
  const relations = await connection.query(
    "SELECT c.relname AS name FROM pg_catalog.pg_class c " +
    "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') " +
    "AND (c.relname ILIKE '%semantic%' OR c.relname ILIKE '%occurrence%' " +
    "OR c.relname ILIKE '%thread%' OR c.relname ILIKE '%claim%') ORDER BY c.relname",
  );
  const result = [];
  for (const row of relations.rows) {
    const name = String(row.name).replaceAll('"', '""');
    const value = await connection.query('SELECT count(*)::int AS count FROM public."' + name + '"');
    result.push([row.name, value.rows[0].count]);
  }
  return result;
}

async function assertNoRows(connection, expected) {
  assert.deepEqual(await counts(connection), expected);
  for (const row of await semanticCounts(connection)) assert.equal(row[1], 0, 'semantic relation ' + row[0]);
}

async function assertCandidateMigrationsPresent() {
  const ledgerClient = clientFor(adminUrl, 'attack047-ledger-check');
  await ledgerClient.connect();
  try {
    const ledger = await ledgerClient.query(
      'SELECT name FROM public.kysely_migration WHERE name = ANY($1::text[]) ORDER BY name',
      [migrationNames],
    );
    assert.deepEqual(ledger.rows.map((row) => row.name), [...migrationNames].sort());
    const total = await ledgerClient.query('SELECT count(*)::int AS count FROM public.kysely_migration');
    assert.equal(total.rows[0].count, 44);
    process.stdout.write('ATTACK047_MIGRATIONS_001_044_PRESENT_IN_FRESH_CLUSTER=PASS\n');
  } finally {
    await ledgerClient.end();
  }
}

async function configureInvoker(admin) {
  const safePassword = invokerPassword.replaceAll("'", "''");
  await admin.query('ALTER ROLE ' + invokerName + ' LOGIN PASSWORD \'' + safePassword + '\'');
  await admin.query('GRANT EXECUTE ON FUNCTION ' + writerFunction + ' TO ' + invokerName);
}

async function assertCatalogContract(admin) {
  const version = await admin.query('SELECT current_setting(\'server_version\') AS version, current_setting(\'fsync\') AS fsync, current_setting(\'synchronous_commit\') AS synchronous_commit');
  assert.match(version.rows[0].version, /^17\.11(?:\s|$)/);
  assert.equal(version.rows[0].fsync, 'on');
  assert.equal(version.rows[0].synchronous_commit, 'on');
  const routines = await admin.query(
    'SELECT p.oid::regprocedure::text AS signature, p.prosecdef AS security_definer, ' +
    'p.provolatile AS volatility, p.proparallel AS parallel, p.proowner::regrole::text AS owner, ' +
    'p.proconfig AS config, p.pronargs AS args, ' +
    'EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault(\'f\',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type=\'EXECUTE\') AS public_execute, ' +
    'pg_catalog.has_function_privilege(\'anon\',p.oid,\'EXECUTE\') AS anon_execute, ' +
    'pg_catalog.has_function_privilege(\'authenticated\',p.oid,\'EXECUTE\') AS authenticated_execute, ' +
    'pg_catalog.has_function_privilege(\'dialektik_core_app\',p.oid,\'EXECUTE\') AS core_execute, ' +
    'pg_catalog.has_function_privilege($1,p.oid,\'EXECUTE\') AS invoker_execute ' +
    'FROM pg_catalog.pg_proc p WHERE p.oid = ANY(ARRAY[$2::regprocedure,$3::regprocedure]) ORDER BY p.pronargs DESC',
    [invokerName, writerFunction, statusFunction],
  );
  assert.equal(routines.rows.length, 2);
  const writer = routines.rows.find((item) => item.signature === writerFunction);
  const status = routines.rows.find((item) => item.signature === statusFunction);
  assert.ok(writer && status);
  assert.equal(writer.security_definer, true);
  assert.equal(writer.owner, writerName);
  assert.equal(writer.public_execute, false);
  assert.equal(writer.anon_execute, false);
  assert.equal(writer.authenticated_execute, false);
  assert.equal(writer.core_execute, false);
  assert.equal(status.security_definer, true);
  assert.equal(status.volatility, 's');
  assert.equal(status.parallel, 'u');
  assert.equal(status.owner, writerName);
  assert.equal(status.args, 0);
  assert.deepEqual(status.config, ['search_path=pg_catalog, pg_temp', 'row_security=on', 'statement_timeout=5s']);
  assert.equal(status.public_execute, false);
  assert.equal(status.anon_execute, false);
  assert.equal(status.authenticated_execute, false);
  assert.equal(status.core_execute, false);
  assert.equal(status.invoker_execute, true);
  const invoker = await admin.query(
    'SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolconnlimit,' +
    '(SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) AS memberships,' +
    '(SELECT rolpassword IS NULL FROM pg_catalog.pg_authid WHERE oid=r.oid) AS password_null ' +
    'FROM pg_catalog.pg_roles r WHERE rolname=$1',
    [invokerName],
  );
  assert.deepEqual(invoker.rows[0], {
    rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, rolbypassrls: false, rolinherit: false, rolconnlimit: 2,
    memberships: 0, password_null: true,
  });
  process.stdout.write('ATTACK047_STATUS_OWNER_SEARCH_PATH_RLS_ACL=PASS\n');
  process.stdout.write('ATTACK047_INVOKER_NONADMIN_NO_MEMBERSHIPS=PASS\n');
}

async function tryLock(connection) {
  const result = await connection.query('SELECT pg_catalog.pg_try_advisory_xact_lock(20261018,86) AS acquired');
  return result.rows[0].acquired;
}

async function statusWithLock(client, expected, isolation = 'READ COMMITTED') {
  await client.query('BEGIN ISOLATION LEVEL ' + isolation);
  assert.equal(await tryLock(client), true, 'recovery lock must be held before status');
  const result = await client.query('SELECT ' + statusFunction);
  assert.equal(result.rows[0].govuk_rsh_metadata_recovery_status, expected);
  await client.query('COMMIT');
}

async function statusWithoutLock(client, expected) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.equal(await tryLock(client), true);
  await client.query('ROLLBACK');
  const result = await client.query('SELECT ' + statusFunction);
  assert.equal(result.rows[0].govuk_rsh_metadata_recovery_status, expected);
}

async function assertNegativePrivileges(admin, invoker) {
  await assert.rejects(invoker.query('SET ROLE ' + writerName), (error) => error.code === '42501');
  await assert.rejects(invoker.query('SELECT * FROM public.live_acquisition_receipts LIMIT 1'), (error) => error.code === '42501');
  await assert.rejects(invoker.query('INSERT INTO public.sources DEFAULT VALUES'), (error) => error.code === '42501');
  for (const role of ['anon', 'authenticated', 'dialektik_core_app']) {
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE ' + role);
      await assert.rejects(admin.query('SELECT ' + statusFunction), (error) => error.code === '42501');
    } finally {
      await admin.query('ROLLBACK');
    }
  }
  process.stdout.write('ATTACK047_NO_SET_ROLE_NO_DIRECT_TABLE_ACCESS_NO_CLIENT_EXECUTE=PASS\n');
}

async function waitNoInvokerSessions(admin) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await admin.query('SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND usename=$1', [invokerName]);
    if (result.rows[0].count === 0) return;
    await delay(30);
  }
  throw new Error('INVOCATION_SESSION_DID_NOT_CLOSE');
}

async function assertNotCommitted(invokerUrl) {
  const client = clientFor(invokerUrl, 'attack047-not-committed-status');
  await client.connect();
  try {
    await statusWithLock(client, 'NOT_COMMITTED');
  } finally {
    await client.end();
  }
}

async function testPrecommitStates(admin, invokerUrl, payload) {
  await assertNoRows(admin, { sources: 0, guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0 });
  const primary = clientFor(invokerUrl, 'attack047-status-invoker');
  await primary.connect();
  try {
    await assertNegativePrivileges(admin, primary);
    await statusWithoutLock(primary, 'PENDING_OR_UNKNOWN');
    await statusWithLock(primary, 'NOT_COMMITTED');
    await statusWithLock(primary, 'PENDING_OR_UNKNOWN', 'REPEATABLE READ');
    process.stdout.write('ATTACK047_NOT_COMMITTED_AND_UNKNOWN_STATES=PASS\n');
  } finally {
    await primary.end();
  }

  const first = clientFor(invokerUrl, 'attack047-competitor-idle');
  const second = clientFor(invokerUrl, 'attack047-competitor-status');
  await first.connect();
  await second.connect();
  try {
    await second.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.equal(await tryLock(second), true);
    const status = await second.query('SELECT ' + statusFunction);
    assert.equal(status.rows[0].govuk_rsh_metadata_recovery_status, 'PENDING_OR_UNKNOWN');
    await second.query('COMMIT');
  } finally {
    await first.end();
    await second.end();
  }
  process.stdout.write('ATTACK047_OTHER_INVOKER_SESSION_IS_UNKNOWN=PASS\n');

  await admin.query('GRANT EXECUTE ON FUNCTION ' + writerFunction + ' TO ' + invokerName);
  const pending = clientFor(invokerUrl, 'attack047-pending-writer');
  const observer = clientFor(invokerUrl, 'attack047-pending-observer');
  await pending.connect();
  await pending.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const write = await pending.query('SELECT * FROM ' + writerCall + '($1::jsonb)', [JSON.stringify(payload)]);
  assert.equal(write.rows[0].result_state, 'persisted');
  await observer.connect();
  try {
    await observer.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.equal(await tryLock(observer), false);
    const status = await observer.query('SELECT ' + statusFunction);
    assert.equal(status.rows[0].govuk_rsh_metadata_recovery_status, 'PENDING_OR_UNKNOWN');
    await observer.query('ROLLBACK');
  } finally {
    await observer.end();
    await pending.query('ROLLBACK');
    await pending.end();
  }
  await waitNoInvokerSessions(admin);
  await assertNoRows(admin, { sources: 0, guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0 });
  const grant = await admin.query('SELECT pg_catalog.has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [invokerName, writerFunction]);
  assert.equal(grant.rows[0].allowed, true);
  await assertNotCommitted(invokerUrl);
  process.stdout.write('ATTACK047_CONCURRENT_PENDING_NOT_ABORTED_STATE=PASS\n');

  await admin.query('GRANT EXECUTE ON FUNCTION ' + writerFunction + ' TO ' + invokerName);
  const rollback = clientFor(invokerUrl, 'attack047-explicit-rollback');
  await rollback.connect();
  try {
    await rollback.query('BEGIN');
    const result = await rollback.query('SELECT * FROM ' + writerCall + '($1::jsonb)', [JSON.stringify(payload)]);
    assert.equal(result.rows[0].result_state, 'persisted');
    await rollback.query('ROLLBACK');
  } finally {
    await rollback.end();
  }
  await assertNoRows(admin, { sources: 0, guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0 });
  await assertNotCommitted(invokerUrl);
  process.stdout.write('ATTACK047_ROLLBACK_RESTORES_ONE_SHOT_AUTHORIZATION=PASS\n');

  await admin.query('GRANT EXECUTE ON FUNCTION ' + writerFunction + ' TO ' + invokerName);
  const disconnected = clientFor(invokerUrl, 'attack047-disconnect-before-commit');
  await disconnected.connect();
  await disconnected.query('BEGIN');
  const disconnectResult = await disconnected.query('SELECT * FROM ' + writerCall + '($1::jsonb)', [JSON.stringify(payload)]);
  assert.equal(disconnectResult.rows[0].result_state, 'persisted');
  disconnected.connection.stream.destroy();
  await disconnected.end().catch(() => undefined);
  await waitNoInvokerSessions(admin);
  await assertNoRows(admin, { sources: 0, guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0 });
  await assertNotCommitted(invokerUrl);
  process.stdout.write('ATTACK047_DISCONNECT_BEFORE_COMMIT_ROLLS_BACK=PASS\n');
}

async function testSigkillBeforeCommit(invokerUrl, payload, admin) {
  await admin.query('GRANT EXECUTE ON FUNCTION ' + writerFunction + ' TO ' + invokerName);
  const code = [
    "import { Client } from 'pg';",
    "const c = new Client({connectionString:process.env.DIALEKTIK_ATTACK047_CHILD_URL,application_name:'attack047-sigkill-before-commit'});",
    "await c.connect(); await c.query('BEGIN');",
    "await c.query('SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once($1::jsonb)',[process.env.DIALEKTIK_ATTACK047_CHILD_PAYLOAD]);",
    "process.stdout.write('ATTACK047_TX_OPEN\\\\n'); await new Promise(()=>{});",
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    env: { ...process.env, DIALEKTIK_ATTACK047_CHILD_URL: invokerUrl, DIALEKTIK_ATTACK047_CHILD_PAYLOAD: JSON.stringify(payload) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let stderrSeen = false;
  const marker = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SIGKILL_CHILD_MARKER_TIMEOUT')), 12000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('ATTACK047_TX_OPEN')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', () => { stderrSeen = true; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (codeValue, signal) => {
      if (!output.includes('ATTACK047_TX_OPEN')) {
        clearTimeout(timeout);
        reject(new Error('SIGKILL_CHILD_EXIT_BEFORE_MARKER_' + codeValue + '_' + signal + (stderrSeen ? '_STDERR_CAPTURED' : '')));
      }
    });
  });
  await marker;
  const exited = once(child, 'exit');
  assert.equal(child.kill('SIGKILL'), true);
  await exited;
  await waitNoInvokerSessions(admin);
  await assertNoRows(admin, { sources: 0, guards: 0, policies: 0, exclusions: 0, receipts: 0, articles: 0, versions: 0, events: 0 });
  const grant = await admin.query('SELECT pg_catalog.has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [invokerName, writerFunction]);
  assert.equal(grant.rows[0].allowed, true);
  await assertNotCommitted(invokerUrl);
  process.stdout.write('ATTACK047_SIGKILL_BEFORE_COMMIT_ROLLED_BACK=PASS\n');
}

async function dropCommitAck(invokerUrl, payload) {
  const state = { commitTagObserved: false, closed: false, startup: true, frontBuffer: Buffer.alloc(0), backBuffer: Buffer.alloc(0) };
  const server = createServer((frontend) => {
    const backend = netConnect(port, '127.0.0.1');
    const closeBoth = () => {
      if (state.closed) return;
      state.closed = true;
      frontend.destroy();
      backend.destroy();
    };
    frontend.on('error', closeBoth);
    backend.on('error', closeBoth);
    frontend.on('close', () => backend.destroy());
    backend.on('close', () => frontend.destroy());
    frontend.on('data', (chunk) => {
      state.frontBuffer = Buffer.concat([state.frontBuffer, chunk]);
      let offset = 0;
      if (state.startup) {
        if (state.frontBuffer.length < 4) return;
        const length = state.frontBuffer.readInt32BE(0);
        if (state.frontBuffer.length < length) return;
        offset = length;
        state.startup = false;
      }
      while (state.frontBuffer.length - offset >= 5) {
        const type = String.fromCharCode(state.frontBuffer[offset]);
        const length = state.frontBuffer.readInt32BE(offset + 1);
        if (length < 4 || state.frontBuffer.length - offset < length + 1) break;
        if (type === 'Q') {
          const query = state.frontBuffer.subarray(offset + 5, offset + length + 1).toString('utf8').replace(/\0+$/u, '').trim();
          if (/^COMMIT;?$/iu.test(query)) state.dropCommit = true;
        }
        offset += length + 1;
      }
      if (offset > 0) backend.write(state.frontBuffer.subarray(0, offset));
      state.frontBuffer = state.frontBuffer.subarray(offset);
    });
    backend.on('data', (chunk) => {
      state.backBuffer = Buffer.concat([state.backBuffer, chunk]);
      let offset = 0;
      while (state.backBuffer.length - offset >= 5) {
        const type = String.fromCharCode(state.backBuffer[offset]);
        const length = state.backBuffer.readInt32BE(offset + 1);
        if (length < 4 || state.backBuffer.length - offset < length + 1) break;
        const total = length + 1;
        if (state.dropCommit && type === 'C') {
          const tag = state.backBuffer.subarray(offset + 5, offset + total).toString('utf8').replace(/\0+$/u, '');
          if (tag === 'COMMIT') {
            if (offset > 0) frontend.write(state.backBuffer.subarray(0, offset));
            state.commitTagObserved = true;
            closeBoth();
            return;
          }
        }
        offset += total;
      }
      if (offset > 0) frontend.write(state.backBuffer.subarray(0, offset));
      state.backBuffer = state.backBuffer.subarray(offset);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const proxyPort = server.address().port;
  const proxyUrl = invokerUrlFor(invokerUrl, proxyPort);
  const client = clientFor(proxyUrl, 'attack047-drop-commit-ack');
  // The proxy intentionally drops the socket after observing PostgreSQL's
  // successful COMMIT CommandComplete. node-postgres emits an expected error
  // event in addition to rejecting the query promise; capture it so the
  // process does not terminate as an unhandled EventEmitter error.
  let clientConnectionErrorObserved = false;
  client.on('error', () => { clientConnectionErrorObserved = true; });
  let commitRejected = false;
  try {
    await client.connect();
    await client.query('SET synchronous_commit = on');
    const sync = await client.query('SHOW synchronous_commit');
    assert.equal(sync.rows[0].synchronous_commit, 'on');
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const write = await client.query('SELECT * FROM ' + writerCall + '($1::jsonb)', [JSON.stringify(payload)]);
    assert.equal(write.rows[0].result_state, 'persisted');
    try {
      await client.query('COMMIT');
    } catch {
      commitRejected = true;
    }
    assert.equal(state.commitTagObserved, true, 'proxy observed backend COMMIT CommandComplete before dropping it');
    assert.equal(commitRejected, true, 'client did not receive the COMMIT acknowledgment');
    assert.equal(clientConnectionErrorObserved, true, 'client connection loss was observed after the lost acknowledgment');
  } finally {
    await client.end().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
  process.stdout.write('ATTACK047_COMMIT_DURABLE_ACK_DROPPED=PASS\n');
}

async function migrateAndBeforeRestart() {
  await assertCandidateMigrationsPresent();
  let admin = clientFor(adminUrl, 'attack047-admin');
  await admin.connect();
  try {
    await assertCatalogContract(admin);
    await configureInvoker(admin);
    const invokerUrl = invokerUrlFor(adminUrl);
    const initial = clientFor(invokerUrl, 'attack047-invoker');
    await initial.connect();
    try {
      const rls = await admin.query(
        "SELECT count(*)::int AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity",
        [['sources','articles','live_source_policies','live_exposure_exclusions','live_acquisition_receipts','live_article_versions','prospective_content_rights_write_guards']],
      );
      assert.equal(rls.rows[0].count, 7);
      process.stdout.write('ATTACK047_RLS_ENABLED_ON_SEVEN_TARGET_TABLES=PASS\n');
    } finally {
      await initial.end();
    }
    const payload = makePayload();
    await admin.query('GRANT EXECUTE ON FUNCTION ' + writerFunction + ' TO ' + invokerName);
    await testPrecommitStates(admin, invokerUrl, payload);
    await testSigkillBeforeCommit(invokerUrl, payload, admin);
    await dropCommitAck(invokerUrl, payload);
    process.stdout.write('ATTACK047_BEFORE_RESTART_COMPLETE=PASS\n');
  } finally {
    await admin.end().catch(() => undefined);
  }
}

async function statusInDatabase(url, expected, applicationName) {
  const client = clientFor(url, applicationName);
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.equal(await tryLock(client), true);
    const result = await client.query('SELECT ' + statusFunction);
    assert.equal(result.rows[0].govuk_rsh_metadata_recovery_status, expected);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

async function afterRestartAndClose() {
  const admin = clientFor(adminUrl, 'attack047-admin-after-restart');
  await admin.connect();
  try {
    const settings = await admin.query('SELECT current_setting(\'server_version\') AS version, current_setting(\'fsync\') AS fsync, current_setting(\'synchronous_commit\') AS synchronous_commit');
    assert.match(settings.rows[0].version, /^17\.11(?:\s|$)/);
    assert.equal(settings.rows[0].fsync, 'on');
    assert.equal(settings.rows[0].synchronous_commit, 'on');
    await statusInDatabase(invokerUrlFor(adminUrl), 'COMMITTED_MATCH', 'attack047-recovery-after-restart');
    const expected = { sources: 1, guards: 1, policies: 1, exclusions: 3, receipts: 1, articles: 1, versions: 1, events: 0 };
    await assertNoRows(admin, expected);
    const writerGrant = await admin.query('SELECT pg_catalog.has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [invokerName, writerFunction]);
    assert.equal(writerGrant.rows[0].allowed, false);
    const denied = clientFor(invokerUrlFor(adminUrl), 'attack047-committed-replay-denied');
    await denied.connect();
    try {
      await assert.rejects(denied.query('SELECT * FROM ' + writerCall + '($1::jsonb)', [JSON.stringify(makePayload())]), (error) => error.code === '42501');
    } finally {
      await denied.end();
    }
    process.stdout.write('ATTACK047_RESTART_RECOVERY_COMMITTED_MATCH_EXACT_NINE_NO_SEMANTICS=PASS\n');

    const conflictName = 'dialektik_attack047_conflict';
    await admin.end();
    const maintenance = clientFor(urlForDatabase(adminUrl, 'postgres'), 'attack047-conflict-cloner');
    await maintenance.connect();
    try {
      await maintenance.query('CREATE DATABASE ' + conflictName + ' TEMPLATE ' + databaseName);
    } finally {
      await maintenance.end();
    }
    const conflictAdmin = clientFor(urlForDatabase(adminUrl, conflictName), 'attack047-conflict-injector');
    await conflictAdmin.connect();
    try {
      await conflictAdmin.query('SET session_replication_role = replica');
      await conflictAdmin.query('UPDATE public.articles SET text_normalized=$1 WHERE id=$2::public.dialektik_ulid', ['conflicting test fixture', '01M4YDQK00WS344WW8RCPCEQHF']);
      await conflictAdmin.query('SET session_replication_role = origin');
    } finally {
      await conflictAdmin.end();
    }
    await statusInDatabase(invokerUrlFor(adminUrl, port, conflictName), 'CONFLICT', 'attack047-conflict-status');
    process.stdout.write('ATTACK047_CONFLICT_STATE_ISOLATED_FIXTURE=PASS\n');
  } finally {
    await admin.end().catch(() => undefined);
  }

  const cleanup = clientFor(adminUrl, 'attack047-final-cleanup');
  await cleanup.connect();
  try {
    await cleanup.query('REVOKE EXECUTE ON FUNCTION ' + writerFunction + ' FROM ' + invokerName);
    await cleanup.query('ALTER ROLE ' + invokerName + ' NOLOGIN PASSWORD NULL');
    await cleanup.query('SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE usename = $1 AND pid <> pg_catalog.pg_backend_pid()', [invokerName]);
    await cleanup.query('SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE usename = $1 AND pid <> pg_catalog.pg_backend_pid()', [writerName]);
    const state = await cleanup.query(
      'SELECT r.rolcanlogin, a.rolpassword IS NULL AS password_null, ' +
      '(SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE usename=r.rolname) AS sessions, ' +
      'pg_catalog.has_function_privilege(r.rolname,$2,\'EXECUTE\') AS writer_execute, ' +
      'pg_catalog.has_function_privilege(r.rolname,$3,\'EXECUTE\') AS recovery_execute ' +
      'FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_authid a ON a.oid=r.oid WHERE r.rolname=$1',
      [invokerName, writerFunction, statusFunction],
    );
    assert.deepEqual(state.rows[0], {
      rolcanlogin: false, password_null: true, sessions: 0, writer_execute: false, recovery_execute: true,
    });
    const writer = await cleanup.query('SELECT rolcanlogin, (SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE usename=$1) AS sessions FROM pg_catalog.pg_roles WHERE rolname=$1', [writerName]);
    assert.deepEqual(writer.rows[0], { rolcanlogin: false, sessions: 0 });
    process.stdout.write('ATTACK047_CREDENTIAL_SESSION_AND_ONE_SHOT_CLEANUP=PASS\n');
    process.stdout.write('ATTACK047_RECOVERY_EXECUTE_REMAINS_RESTRICTED_TO_NOLOGIN_INVOKER=PASS\n');
  } finally {
    await cleanup.end();
  }
}

try {
  if (mode === 'before-restart') await migrateAndBeforeRestart();
  else await afterRestartAndClose();
} catch (error) {
  const detail = String(error?.message ?? error)
    .replaceAll(invokerPassword, '[secret-redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[connection-redacted]')
    .replace(/\\bpassword\\b[^\\n]*/giu, 'password [redacted]');
  process.stderr.write('ATTACK047_FAILURE=' + (error?.code ?? error?.name ?? 'UNKNOWN') + ':' + detail.slice(0, 700) + '\n');
  process.exitCode = 1;
}
