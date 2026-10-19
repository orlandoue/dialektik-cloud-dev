import {
  govUkRshOneShotMetadataDownSql,
  govUkRshOneShotMetadataUpSql,
} from './043_govuk_rsh_one_shot_metadata.js';
import {
  govUkRshReceiptRecoveryDownSql,
  govUkRshReceiptRecoveryUpSql,
} from './044_govuk_rsh_receipt_recovery.js';

export const SUPABASE_DEV_PROJECT_REF = 'vclsswwfhljczxgnsciq';
export const SUPABASE_DEV_BASELINE_VERSION = '20261016074743';

export interface SupabaseDevCandidate {
  readonly sequence: '043' | '044';
  readonly mcpMigrationName: string;
  readonly sourceMigrationName: string;
  readonly upSql: string;
  readonly downSql: string;
}

const EXPECTED_ZERO_COUNT_TABLES = [
  'sources',
  'articles',
  'events',
  'live_source_policies',
  'live_acquisition_receipts',
  'live_article_versions',
  'live_exposure_exclusions',
  'prospective_content_rights_write_guards',
] as const;

const EXPECTED_RLS_TABLES = EXPECTED_ZERO_COUNT_TABLES;
const GOVUK_RSH_CANDIDATE_MIGRATION_NAMES = new Set([
  '043_govuk_rsh_one_shot_metadata',
  '044_govuk_rsh_receipt_recovery',
  'govuk_rsh_one_shot_metadata_043',
  'govuk_rsh_receipt_recovery_044',
]);

/**
 * Validate a fresh, read-only snapshot before exporting the two staged SQL
 * payloads. This is intentionally an export-only planner: it has no database
 * client and cannot run, repair, or mark any migration.
 */
export function assertReviewedSupabaseDevSnapshot(value: unknown): asserts value is {
  project: { id: string; status: string; postgresVersion: string };
  database: {
    databaseName: string;
    effectiveUser: string;
    sessionUser: string;
    serverVersion: string;
    fsync: string;
    synchronousCommit: string;
  };
  migrationHistory: {
    table: string;
    localKyselyTableExists: boolean;
    count: number;
    latestVersion: string;
    entries: readonly { version: string; name: string }[];
    bodyFingerprints: readonly {
      version: string;
      name: string;
      remoteStatementsSha256: string;
      localUpSqlSha256: string;
      match: boolean;
    }[];
  };
  candidateState: {
    opsSchemaExists: boolean;
    persistFunctionExists: boolean;
    recoveryFunctionExists: boolean;
    invokerRoleExists: boolean;
    pgCronInstalled: boolean;
    writerLogin: boolean;
    writerRole: {
      exists: boolean;
      superuser: boolean;
      createDb: boolean;
      createRole: boolean;
      replication: boolean;
      bypassRls: boolean;
      connectionLimit: number;
    };
    writerMaintenanceMembership: {
      member: string;
      adminOption: boolean;
      inheritOption: boolean;
      setOption: boolean;
    };
    activeRelevantSessions: number;
    counts: Record<string, number>;
    rlsEnabled: Record<string, boolean>;
  };
  remoteWrites: 'NONE';
  remoteApplyAuthorized: 'NO';
} {
  if (value === null || typeof value !== 'object') {
    throw new Error('SUPABASE_DEV_SNAPSHOT_INVALID');
  }
  const snapshot = value as Record<string, unknown>;
  const project = snapshot.project as Record<string, unknown> | undefined;
  const database = snapshot.database as Record<string, unknown> | undefined;
  const history = snapshot.migrationHistory as Record<string, unknown> | undefined;
  const state = snapshot.candidateState as Record<string, unknown> | undefined;
  if (
    project?.id !== SUPABASE_DEV_PROJECT_REF || project.status !== 'ACTIVE_HEALTHY' ||
    typeof project.postgresVersion !== 'string' || !project.postgresVersion.startsWith('17.11')
  ) {
    throw new Error('SUPABASE_DEV_PROJECT_OR_VERSION_MISMATCH');
  }
  if (
    database?.databaseName !== 'postgres' || database.effectiveUser !== 'postgres' ||
    database.sessionUser !== 'postgres' || database.serverVersion !== '17.11' ||
    database.fsync !== 'on' || database.synchronousCommit !== 'on'
  ) {
    throw new Error('SUPABASE_DEV_DATABASE_PREFLIGHT_MISMATCH');
  }
  if (
    history?.table !== 'supabase_migrations.schema_migrations' ||
    history.localKyselyTableExists !== false || history.count !== 50 ||
    history.latestVersion !== SUPABASE_DEV_BASELINE_VERSION ||
    !Array.isArray(history.entries) || history.entries.length !== 50
  ) {
    throw new Error('SUPABASE_DEV_MIGRATION_BASELINE_CHANGED');
  }
  const entries = history.entries as { version: string; name: string }[];
  if (
    entries.some((entry, index) =>
      typeof entry.version !== 'string' || typeof entry.name !== 'string' ||
      (index > 0 && entries[index - 1]!.version >= entry.version)
    ) ||
    entries.at(-1)?.version !== SUPABASE_DEV_BASELINE_VERSION ||
    entries.some(({ name }) => GOVUK_RSH_CANDIDATE_MIGRATION_NAMES.has(name))
  ) {
    throw new Error('SUPABASE_DEV_MIGRATION_ORDER_OR_CANDIDATE_CHANGED');
  }
  const expectedBaselineBodies = [
    {
      version: '20261016052229',
      name: '041_govuk_product_metadata_writer',
      sha256: '7c7de0106915fde2249136c253161dd33c136a7f13312330a579b3bc58a7e911',
    },
    {
      version: '20261016074743',
      name: '042_govuk_product_writer_row_scope',
      sha256: '917eb52d0c6719a70b7f4b4e7317e317d6acd5b3834a91c18f7877c3d1c01bcb',
    },
  ];
  const fingerprints = history.bodyFingerprints as {
    version: string;
    name: string;
    remoteStatementsSha256: string;
    localUpSqlSha256: string;
    match: boolean;
  }[] | undefined;
  for (const expected of expectedBaselineBodies) {
    const fingerprint = fingerprints?.find((item) => item.version === expected.version);
    if (
      fingerprint?.name !== expected.name ||
      fingerprint.remoteStatementsSha256 !== expected.sha256 ||
      fingerprint.localUpSqlSha256 !== expected.sha256 || fingerprint.match !== true
    ) {
      throw new Error('SUPABASE_DEV_041_042_BODY_FINGERPRINT_MISMATCH');
    }
  }
  const counts = state?.counts as Record<string, unknown> | undefined;
  const rlsEnabled = state?.rlsEnabled as Record<string, unknown> | undefined;
  const writerRole = state?.writerRole as Record<string, unknown> | undefined;
  const writerMembership = state?.writerMaintenanceMembership as Record<string, unknown> | undefined;
  const countsMatch = counts !== undefined &&
    Object.keys(counts).sort().join(',') === [...EXPECTED_ZERO_COUNT_TABLES].sort().join(',') &&
    EXPECTED_ZERO_COUNT_TABLES.every((table) => counts[table] === 0);
  const rlsMatch = rlsEnabled !== undefined &&
    Object.keys(rlsEnabled).sort().join(',') === [...EXPECTED_RLS_TABLES].sort().join(',') &&
    EXPECTED_RLS_TABLES.every((table) => rlsEnabled[table] === true);
  const writerRoleMatch = writerRole?.exists === true &&
    writerRole.superuser === false && writerRole.createDb === false &&
    writerRole.createRole === false && writerRole.replication === false &&
    writerRole.bypassRls === false && writerRole.connectionLimit === 1;
  const writerMembershipMatch = writerMembership?.member === 'postgres' &&
    writerMembership.adminOption === true && writerMembership.inheritOption === false &&
    writerMembership.setOption === false;
  if (
    state?.opsSchemaExists !== false || state.persistFunctionExists !== false ||
    state.recoveryFunctionExists !== false || state.invokerRoleExists !== false ||
    state.pgCronInstalled !== false || state.writerLogin !== false ||
    state.activeRelevantSessions !== 0 || !countsMatch || !rlsMatch ||
    !writerRoleMatch || !writerMembershipMatch ||
    snapshot.remoteWrites !== 'NONE' || snapshot.remoteApplyAuthorized !== 'NO'
  ) {
    throw new Error('SUPABASE_DEV_CANDIDATE_PREFLIGHT_CHANGED');
  }
}

export function createSupabaseDevCandidatePlan(snapshot: unknown): readonly SupabaseDevCandidate[] {
  assertReviewedSupabaseDevSnapshot(snapshot);
  return Object.freeze([
    Object.freeze({
      sequence: '043' as const,
      mcpMigrationName: 'govuk_rsh_one_shot_metadata_043',
      sourceMigrationName: '043_govuk_rsh_one_shot_metadata',
      upSql: govUkRshOneShotMetadataUpSql,
      downSql: govUkRshOneShotMetadataDownSql,
    }),
    Object.freeze({
      sequence: '044' as const,
      mcpMigrationName: 'govuk_rsh_receipt_recovery_044',
      sourceMigrationName: '044_govuk_rsh_receipt_recovery',
      upSql: govUkRshReceiptRecoveryUpSql,
      downSql: govUkRshReceiptRecoveryDownSql,
    }),
  ]);
}

