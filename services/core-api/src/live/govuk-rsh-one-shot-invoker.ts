import { readFileSync, statSync } from 'node:fs';
import { createDatabase, destroyDatabase, type Database } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import type { GovUkRshMetadata } from './govuk-product-acquisition.js';

export const GOVUK_RSH_INVOCATION_FUNCTION =
  'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)';
export const GOVUK_RSH_POOLER_HOST = 'aws-0-us-east-1.pooler.supabase.com';
export const GOVUK_RSH_PROJECT_REF = 'vclsswwfhljczxgnsciq';
export const GOVUK_RSH_POOLER_USER =
  `dialektik_govuk_rsh_invoker.${GOVUK_RSH_PROJECT_REF}`;
export const GOVUK_RSH_RECOVERY_FUNCTION =
  'dialektik_ops.govuk_rsh_metadata_recovery_status()';

export type GovUkRshRecoveryState =
  | 'COMMITTED_MATCH'
  | 'NOT_COMMITTED'
  | 'CONFLICT'
  | 'PENDING_OR_UNKNOWN';

export interface GovUkRshOneShotPayload {
  readonly acquiredAt: string;
  readonly metadataHash: string;
  readonly modifiedAt: string | null;
  readonly publishedAt: string;
}

export interface GovUkRshInvokerConfig {
  readonly connectionString: string;
  readonly caCertificate: string;
}

/** The SQL boundary intentionally receives only four fixed-envelope fields. */
export function toGovUkRshOneShotPayload(
  metadata: GovUkRshMetadata,
): GovUkRshOneShotPayload {
  return Object.freeze({
    acquiredAt: metadata.acquiredAt,
    metadataHash: metadata.metadataHash,
    modifiedAt: metadata.modifiedAt,
    publishedAt: metadata.publishedAt,
  });
}

/** Fail closed on destination identity and full hostname-verifying TLS parameters. */
export function validateGovUkRshInvokerConnectionString(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('GOVUK_RSH_INVOKER_DATABASE_URL_INVALID');
  }
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname !== GOVUK_RSH_POOLER_HOST ||
    url.port !== '5432' ||
    decodeURIComponent(url.username) !== GOVUK_RSH_POOLER_USER ||
    decodeURIComponent(url.password).length < 32 ||
    url.pathname !== '/postgres' ||
    url.hash !== '' ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    [...url.searchParams.keys()].some((key) => key !== 'sslmode')
  ) {
    throw new Error('GOVUK_RSH_INVOKER_DATABASE_TARGET_OR_TLS_INVALID');
  }
  return url;
}

export function readGovUkRshInvokerConfig(
  env: NodeJS.ProcessEnv = process.env,
): GovUkRshInvokerConfig {
  const connectionString = env.DIALEKTIK_GOVUK_RSH_INVOKER_DATABASE_URL;
  const caPath = env.DIALEKTIK_GOVUK_RSH_INVOKER_CA_CERT_PATH;
  if (!connectionString || !caPath) {
    throw new Error('GOVUK_RSH_INVOKER_CONNECTION_CONFIGURATION_REQUIRED');
  }
  validateGovUkRshInvokerConnectionString(connectionString);
  let caCertificate: string;
  try {
    const info = statSync(caPath);
    if (!info.isFile() || info.size < 64 || info.size > 128 * 1024) {
      throw new Error('invalid certificate size');
    }
    caCertificate = readFileSync(caPath, 'utf8');
  } catch {
    throw new Error('GOVUK_RSH_INVOKER_CA_CERT_UNAVAILABLE');
  }
  if (
    !caCertificate.includes('-----BEGIN CERTIFICATE-----') ||
    caCertificate.includes('PRIVATE KEY')
  ) {
    throw new Error('GOVUK_RSH_INVOKER_CA_CERT_INVALID');
  }
  return { connectionString, caCertificate };
}

export async function callGovUkRshOneShotFunction(
  database: Kysely<Database>,
  metadata: GovUkRshMetadata,
): Promise<Readonly<Record<string, unknown>>> {
  await assertGovUkRshInvokerIdentity(database);
  const payload = toGovUkRshOneShotPayload(metadata);
  let rows: readonly Record<string, unknown>[];
  try {
    const result = await sql<Record<string, unknown>>`
      SELECT * FROM dialektik_ops.persist_govuk_rsh_metadata_once(
        ${JSON.stringify(payload)}::jsonb
      )
    `.execute(database);
    rows = result.rows;
  } catch (error) {
    const code = pgSqlState(error);
    if (code !== undefined && !code.startsWith('08')) {
      throw new Error(`GOVUK_RSH_DATABASE_REJECTED_${code}`);
    }
    throw new Error('GOVUK_RSH_PERSIST_RESULT_UNCERTAIN');
  }
  if (rows.length !== 1) throw new Error('GOVUK_RSH_PERSIST_RESULT_INVALID');
  return rows[0] ?? {};
}

async function assertGovUkRshInvokerIdentity(database: Kysely<Database>): Promise<void> {
  let identity: { session_user: string; current_user: string; database_name: string } | undefined;
  try {
    const result = await sql<{ session_user: string; current_user: string; database_name: string }>`
      SELECT session_user::text AS session_user, current_user::text AS current_user,
        current_database() AS database_name
    `.execute(database);
    identity = result.rows[0];
  } catch {
    throw new Error('GOVUK_RSH_INVOKER_CONNECTION_FAILED');
  }
  if (
    identity?.session_user !== 'dialektik_govuk_rsh_invoker' ||
    identity.current_user !== 'dialektik_govuk_rsh_invoker' ||
    identity.database_name !== 'postgres'
  ) {
    throw new Error('GOVUK_RSH_INVOKER_CONNECTION_IDENTITY_INVALID');
  }
}

/**
 * Resolves an uncertain one-shot result without repeating the write. The
 * status query must run after a fresh READ COMMITTED transaction has acquired
 * the same transaction-scoped advisory lock as 043. 044 then distinguishes a
 * committed/revoked grant from a rolled-back/still-authorized operation.
 */
export async function readGovUkRshRecoveryStatus(
  database: Kysely<Database>,
): Promise<GovUkRshRecoveryState> {
  await assertGovUkRshInvokerIdentity(database);
  try {
    const result = await database.transaction().execute(async (transaction) => {
      // These must precede the recovery SELECT so READ COMMITTED obtains a
      // fresh statement snapshot after any prior invocation releases the lock.
      await sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`.execute(transaction);
      await sql`SET LOCAL lock_timeout = '5s'`.execute(transaction);
      await sql`SET LOCAL statement_timeout = '10s'`.execute(transaction);
      await sql`SELECT pg_catalog.pg_advisory_xact_lock(20261018, 86)`.execute(transaction);
      return sql<{ status: string }>`
        SELECT dialektik_ops.govuk_rsh_metadata_recovery_status()::text AS status
      `.execute(transaction);
    });
    const status = result.rows[0]?.status;
    if (
      status === 'COMMITTED_MATCH' || status === 'NOT_COMMITTED' ||
      status === 'CONFLICT' || status === 'PENDING_OR_UNKNOWN'
    ) {
      return status;
    }
  } catch {
    // Do not expose database diagnostics or connection material. A timeout,
    // lock wait, or malformed response remains inconclusive.
  }
  return 'PENDING_OR_UNKNOWN';
}

function pgSqlState(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  for (const candidate of [error, 'cause' in error ? error.cause : undefined]) {
    if (
      candidate !== null && typeof candidate === 'object' && 'code' in candidate &&
      typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/u.test(candidate.code)
    ) {
      return candidate.code;
    }
  }
  return undefined;
}

/** One invocation only. There is deliberately no retry on transport uncertainty. */
export async function persistGovUkRshMetadataWithInvoker(
  metadata: GovUkRshMetadata,
  config: GovUkRshInvokerConfig,
): Promise<Readonly<Record<string, unknown>>> {
  validateGovUkRshInvokerConnectionString(config.connectionString);
  const database = createDatabase({
    connectionString: config.connectionString,
    caCertificate: config.caCertificate,
    applicationName: 'dialektik-govuk-rsh-one-shot-invoker',
    maxConnections: 1,
    connectionTimeoutMillis: 8_000,
  });
  let persisted: Readonly<Record<string, unknown>> | undefined;
  let failure: unknown;
  try {
    persisted = await callGovUkRshOneShotFunction(database, metadata);
  } catch (error) {
    failure = error;
  }

  let connectionClosed = true;
  try {
    await destroyDatabase(database);
  } catch {
    connectionClosed = false;
  }

  if (failure === undefined) {
    if (persisted === undefined) throw new Error('GOVUK_RSH_PERSIST_RESULT_INVALID');
    return persisted;
  }
  if (!(failure instanceof Error) || failure.message !== 'GOVUK_RSH_PERSIST_RESULT_UNCERTAIN') {
    throw failure;
  }
  if (!connectionClosed) {
    return { result_state: 'PENDING_OR_UNKNOWN', automatic_retry: false };
  }

  const recoveryDatabase = createDatabase({
    connectionString: config.connectionString,
    caCertificate: config.caCertificate,
    applicationName: 'dialektik-govuk-rsh-one-shot-recovery',
    maxConnections: 1,
    connectionTimeoutMillis: 8_000,
  });
  let recoveryState: GovUkRshRecoveryState = 'PENDING_OR_UNKNOWN';
  try {
    recoveryState = await readGovUkRshRecoveryStatus(recoveryDatabase);
  } catch {
    recoveryState = 'PENDING_OR_UNKNOWN';
  }
  try {
    await destroyDatabase(recoveryDatabase);
  } catch {
    return { result_state: 'PENDING_OR_UNKNOWN', automatic_retry: false };
  }
  return { result_state: recoveryState, automatic_retry: false };
}

