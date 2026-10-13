import { createHash } from 'node:crypto';

export const CORE_API_CONFIG = Symbol('CORE_API_CONFIG');

export const nodeEnvironments = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof nodeEnvironments)[number];

export const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type CoreApiLogLevel = (typeof logLevels)[number];

export interface CoreApiConfig {
  readonly databasePoolMax: number;
  readonly databaseUrl: string;
  readonly host: string;
  readonly logLevel: CoreApiLogLevel;
  readonly nodeEnvironment: NodeEnvironment;
  readonly port: number;
  readonly semanticMode?: 'disabled' | 'fixture' | 'unassigned';
  readonly ownershipMode?: 'corporate' | 'personal';
  readonly personalOwnerId?: string;
  readonly personalOwnerAuthTokenSha256?: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_POOL_MAX = 10;

function readEnum<const T extends readonly string[]>(
  source: NodeJS.ProcessEnv,
  name: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const configured = source[name]?.trim();
  const value = configured === undefined || configured.length === 0 ? fallback : configured;
  const isAllowed = allowed.some((candidate) => candidate === value);
  if (!isAllowed) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}

function readInteger(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = source[name]?.trim();
  const value = raw === undefined || raw.length === 0 ? fallback : Number(raw);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${String(minimum)} to ${String(maximum)}`);
  }

  return value;
}

function readDatabaseUrl(source: NodeJS.ProcessEnv): string {
  const raw = source.DATABASE_URL?.trim();
  if (raw === undefined || raw.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql scheme');
  }
  if (parsed.hostname.length === 0 || parsed.pathname.length <= 1) {
    throw new Error('DATABASE_URL must identify a host and database');
  }

  return raw;
}

export function loadCoreApiConfig(
  source: NodeJS.ProcessEnv = process.env,
): Readonly<CoreApiConfig> {
  const nodeEnvironment = readEnum(source, 'NODE_ENV', nodeEnvironments, 'development');
  const defaultLogLevel: CoreApiLogLevel = nodeEnvironment === 'test' ? 'silent' : 'info';
  const configuredMode = source.SEMANTIC_MODE?.trim();
  const requestedMode =
    configuredMode === undefined || configuredMode.length === 0
      ? nodeEnvironment === 'production'
        ? 'disabled'
        : 'fixture'
      : configuredMode;
  if (requestedMode === 'v10_11') {
    throw new Error(
      'V10.11 activation is not authorized. Use SEMANTIC_MODE=fixture for development.',
    );
  }
  if (
    !['disabled', 'fixture', 'unassigned'].includes(requestedMode) ||
    (nodeEnvironment === 'production' && requestedMode !== 'disabled')
  ) {
    throw new Error(
      'SEMANTIC_MODE must be disabled in production or fixture/unassigned in development/test.',
    );
  }

  const configuredHost = source.CORE_API_HOST?.trim();
  const host =
    configuredHost === undefined || configuredHost.length === 0 ? '127.0.0.1' : configuredHost;
  if (requestedMode === 'unassigned') {
    const target = new URL(readDatabaseUrl(source));
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      !['127.0.0.1', 'localhost', '::1'].includes(host)
    ) {
      throw new Error('LIVE_SHADOW requires a local PostgreSQL target and loopback Core host.');
    }
  }

  const ownershipMode = readEnum(
    source,
    'DIALEKTIK_OWNERSHIP_MODE',
    ['corporate', 'personal'] as const,
    'corporate',
  );
  let personalOwnerId: string | undefined;
  let personalOwnerAuthTokenSha256: string | undefined;
  if (ownershipMode === 'personal') {
    const ownerId = source.DIALEKTIK_PERSONAL_OWNER_ID?.trim();
    const ownerToken = source.DIALEKTIK_PERSONAL_OWNER_AUTH_TOKEN?.trim();
    if (
      nodeEnvironment === 'production' ||
      requestedMode !== 'unassigned' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(host) ||
      !ownerId ||
      !/^[A-Za-z0-9_.:-]{1,64}$/.test(ownerId) ||
      !ownerToken ||
      !/^[A-Za-z0-9._~-]{32,2048}$/.test(ownerToken)
    ) {
      throw new Error('PERSONAL_OWNER_MODE_REQUIRES_LOCAL_UNASSIGNED_PROFILE_AND_OWNER_CREDENTIAL');
    }
    personalOwnerId = ownerId;
    personalOwnerAuthTokenSha256 = createHash('sha256').update(ownerToken, 'utf8').digest('hex');
  }

  return Object.freeze({
    databasePoolMax: readInteger(source, 'DATABASE_POOL_MAX', DEFAULT_POOL_MAX, 1, 50),
    databaseUrl: readDatabaseUrl(source),
    host,
    logLevel: readEnum(source, 'CORE_API_LOG_LEVEL', logLevels, defaultLogLevel),
    nodeEnvironment,
    ownershipMode,
    ...(personalOwnerId === undefined ? {} : { personalOwnerId }),
    ...(personalOwnerAuthTokenSha256 === undefined ? {} : { personalOwnerAuthTokenSha256 }),
    semanticMode: requestedMode as 'disabled' | 'fixture' | 'unassigned',
    port: readInteger(source, 'CORE_API_PORT', DEFAULT_PORT, 1, 65_535),
  });
}
