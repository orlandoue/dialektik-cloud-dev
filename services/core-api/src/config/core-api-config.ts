import { createHash, X509Certificate } from 'node:crypto';

export const CORE_API_CONFIG = Symbol('CORE_API_CONFIG');

export const nodeEnvironments = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof nodeEnvironments)[number];

export const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type CoreApiLogLevel = (typeof logLevels)[number];

export interface CoreApiConfig {
  readonly databasePoolMax: number;
  readonly databaseUrl: string;
  readonly databaseCaCertificate?: string;
  readonly host: string;
  readonly logLevel: CoreApiLogLevel;
  readonly nodeEnvironment: NodeEnvironment;
  readonly port: number;
  readonly supabaseAuthIssuer: string;
  readonly semanticMode?: 'disabled' | 'fixture' | 'unassigned';
  readonly ownershipMode?: 'corporate' | 'personal';
  readonly personalOwnerId?: string;
  readonly personalOwnerAuthTokenSha256?: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_SUPABASE_AUTH_ISSUER =
  'https://vclsswwfhljczxgnsciq.supabase.co/auth/v1';

function readSupabaseAuthIssuer(source: NodeJS.ProcessEnv): string {
  const raw = source.SUPABASE_AUTH_ISSUER?.trim() || DEFAULT_SUPABASE_AUTH_ISSUER;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('SUPABASE_AUTH_ISSUER must be a valid HTTPS URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.pathname.replace(/\/$/u, '') !== '/auth/v1'
  ) {
    throw new Error('SUPABASE_AUTH_ISSUER must be an HTTPS Supabase Auth issuer URL.');
  }
  return parsed.toString().replace(/\/$/u, '');
}

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
  const primary = source.DATABASE_URL?.trim();
  if (primary === undefined || primary.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  const slot = source.DIALEKTIK_CORE_DB_SLOT?.trim() || 'primary';
  if (slot !== 'primary' && slot !== 'candidate') {
    throw new Error('DIALEKTIK_CORE_DB_SLOT must be primary or candidate');
  }

  const parse = (raw: string): URL => {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('Core database URL must be a valid PostgreSQL URL');
    }
    if ((parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
      parsed.hostname.length === 0 || parsed.pathname.length <= 1) {
      throw new Error('Core database URL must identify a PostgreSQL database');
    }
    return parsed;
  };

  const primaryUrl = parse(primary);
  if (slot === 'primary') {
    return primary;
  }

  const alternate = source.DATABASE_URL_CANDIDATE?.trim();
  if (alternate === undefined || alternate.length === 0) {
    throw new Error('Candidate Core database URL is required');
  }
  const candidateUrl = parse(alternate);

  // Never rotate to another DB, pooler, port, SSL policy or privileged username.
  // Expected PostgreSQL pooler-style user is role.project_ref; direct role is role.
  const primaryUser = decodeURIComponent(primaryUrl.username);
  const candidateUser = decodeURIComponent(candidateUrl.username);
  if (!/^dialektik_core_app(?:\.[a-z0-9]+)?$/u.test(primaryUser) ||
      candidateUser !== primaryUser.replace(/^dialektik_core_app/u, 'dialektik_core_app_next') ||
      candidateUrl.password.length === 0 ||
      candidateUrl.protocol !== primaryUrl.protocol ||
      candidateUrl.hostname !== primaryUrl.hostname ||
      candidateUrl.port !== primaryUrl.port ||
      candidateUrl.pathname !== primaryUrl.pathname ||
      candidateUrl.search !== primaryUrl.search) {
    throw new Error('Candidate Core database target or role is not authorized');
  }
  return alternate;
}

function readDatabaseCaCertificate(source: NodeJS.ProcessEnv): string | undefined {
  const raw = source.DATABASE_CA_CERT?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  if (raw.length > 65_536) {
    throw new Error('DATABASE_CA_CERT must not exceed 65536 characters.');
  }

  const certificates = [
    ...raw.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g),
  ];
  const certificatePem = certificates[0]?.[0];
  if (certificates.length !== 1 || certificatePem === undefined) {
    throw new Error('DATABASE_CA_CERT must contain exactly one PEM certificate.');
  }

  try {
    const certificate = new X509Certificate(certificatePem);
    if (!certificate.ca || Date.parse(certificate.validTo) <= Date.now()) {
      throw new Error('invalid CA certificate');
    }
  } catch {
    throw new Error('DATABASE_CA_CERT must contain a valid, unexpired CA certificate.');
  }

  return certificatePem;
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

  const databaseCaCertificate = readDatabaseCaCertificate(source);

  return Object.freeze({
    databasePoolMax: readInteger(source, 'DATABASE_POOL_MAX', DEFAULT_POOL_MAX, 1, 50),
    databaseUrl: readDatabaseUrl(source),
    ...(databaseCaCertificate === undefined ? {} : { databaseCaCertificate }),
    host,
    logLevel: readEnum(source, 'CORE_API_LOG_LEVEL', logLevels, defaultLogLevel),
    nodeEnvironment,
    ownershipMode,
    ...(personalOwnerId === undefined ? {} : { personalOwnerId }),
    ...(personalOwnerAuthTokenSha256 === undefined ? {} : { personalOwnerAuthTokenSha256 }),
    semanticMode: requestedMode as 'disabled' | 'fixture' | 'unassigned',
    port: readInteger(source, 'CORE_API_PORT', DEFAULT_PORT, 1, 65_535),
    supabaseAuthIssuer: readSupabaseAuthIssuer(source),
  });
}
