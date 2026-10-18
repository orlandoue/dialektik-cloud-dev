import { describe, expect, it, vi } from 'vitest';
import {
  GOVUK_RSH_POOLER_HOST,
  GOVUK_RSH_POOLER_USER,
  GOVUK_RSH_PROJECT_REF,
  readGovUkRshRecoveryStatus,
  toGovUkRshOneShotPayload,
  validateGovUkRshInvokerConnectionString,
} from '../src/live/govuk-rsh-one-shot-invoker.js';
import type { GovUkRshMetadata } from '../src/live/govuk-product-acquisition.js';
import type { Database } from '@dialektik/database';
import type { Kysely } from 'kysely';

const validUrl = `postgresql://${encodeURIComponent(GOVUK_RSH_POOLER_USER)}:private-test-secret-at-least-32-characters@${GOVUK_RSH_POOLER_HOST}:5432/postgres?sslmode=verify-full`;

describe('GOV.UK one-shot restricted invoker boundary', () => {
  it('pins the exact project, Session Pooler role, port, database, and hostname-verifying TLS mode', () => {
    const parsed = validateGovUkRshInvokerConnectionString(validUrl);
    expect(parsed.hostname).toBe(GOVUK_RSH_POOLER_HOST);
    expect(parsed.port).toBe('5432');
    expect(decodeURIComponent(parsed.username)).toBe(GOVUK_RSH_POOLER_USER);
    expect(decodeURIComponent(parsed.username)).toContain(GOVUK_RSH_PROJECT_REF);
    expect(parsed.pathname).toBe('/postgres');
  });

  it.each(['COMMITTED_MATCH', 'NOT_COMMITTED', 'CONFLICT', 'PENDING_OR_UNKNOWN'] as const)(
    'reads recovery state %s only after READ COMMITTED and the shared transaction lock',
    async (recoveryState) => {
      const statements: string[] = [];
      const database = {
        executeQuery: vi.fn(async (query: { sql: string }) => {
          statements.push(query.sql);
          if (query.sql.includes('SELECT session_user')) {
            return {
              rows: [{
                session_user: 'dialektik_govuk_rsh_invoker',
                current_user: 'dialektik_govuk_rsh_invoker',
                database_name: 'postgres',
              }],
            };
          }
          if (query.sql.includes('govuk_rsh_metadata_recovery_status')) {
            return { rows: [{ status: recoveryState }] };
          }
          return { rows: [] };
        }),
        transaction: () => ({
          execute: async <T>(callback: (transaction: unknown) => Promise<T>) =>
            callback(database),
        }),
      } as unknown as Kysely<Database>;

      await expect(readGovUkRshRecoveryStatus(database)).resolves.toBe(recoveryState);
      expect(statements.map((statement) => statement.replace(/\s+/gu, ' ').trim())).toEqual([
        'SELECT session_user::text AS session_user, current_user::text AS current_user, current_database() AS database_name',
        'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
        "SET LOCAL lock_timeout = '5s'",
        "SET LOCAL statement_timeout = '10s'",
        'SELECT pg_catalog.pg_advisory_xact_lock(20261018, 86)',
        'SELECT dialektik_ops.govuk_rsh_metadata_recovery_status()::text AS status',
      ]);
    },
  );

  it('does not report a conclusive result if recovery times out or returns an unknown state', async () => {
    const database = {
      executeQuery: vi.fn(async (query: { sql: string }) => {
        if (query.sql.includes('SELECT session_user')) {
          return {
            rows: [{
              session_user: 'dialektik_govuk_rsh_invoker',
              current_user: 'dialektik_govuk_rsh_invoker',
              database_name: 'postgres',
            }],
          };
        }
        if (query.sql.includes('govuk_rsh_metadata_recovery_status')) {
          return { rows: [{ status: 'UNRECOGNIZED' }] };
        }
        return { rows: [] };
      }),
      transaction: () => ({
        execute: async <T>(callback: (transaction: unknown) => Promise<T>) =>
          callback(database),
      }),
    } as unknown as Kysely<Database>;
    await expect(readGovUkRshRecoveryStatus(database)).resolves.toBe('PENDING_OR_UNKNOWN');
  });

  it('rejects recovery from a connection that is not the restricted invoker', async () => {
    const database = {
      executeQuery: vi.fn(async () => ({
        rows: [{ session_user: 'postgres', current_user: 'postgres', database_name: 'postgres' }],
      })),
      transaction: vi.fn(),
    } as unknown as Kysely<Database>;
    await expect(readGovUkRshRecoveryStatus(database)).rejects.toThrow(
      'GOVUK_RSH_INVOKER_CONNECTION_IDENTITY_INVALID',
    );
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong project', validUrl.replace(GOVUK_RSH_PROJECT_REF, 'otherprojectref000000000000')],
    ['wrong host', validUrl.replace(GOVUK_RSH_POOLER_HOST, 'db.example.invalid')],
    ['wrong port', validUrl.replace(':5432/', ':6543/')],
    ['wrong role', validUrl.replace(encodeURIComponent(GOVUK_RSH_POOLER_USER), 'postgres')],
    ['wrong database', validUrl.replace('/postgres?', '/production?')],
    ['TLS downgrade', validUrl.replace('verify-full', 'require')],
    ['TLS disabled', validUrl.replace('?sslmode=verify-full', '')],
    ['unexpected query', `${validUrl}&sslrootcert=/some/path`],
    ['no password', validUrl.replace(':private-test-secret-at-least-32-characters@', '@')],
  ])('rejects %s', (_name, candidate) => {
    expect(() => validateGovUkRshInvokerConnectionString(candidate)).toThrow();
  });

  it('projects only the four fixed metadata envelope fields into SQL', () => {
    const metadata: GovUkRshMetadata = {
      sourceId: '01M4YDQK00WS344WW8RCPCEQHE' as GovUkRshMetadata['sourceId'],
      sourceItemId: '86f4abba-9eaa-412f-b048-5ed30aa74201',
      canonicalUrl: 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh',
      title: 'Social housing landlord downgraded by RSH',
      publishedAt: '2026-10-07T08:30:03.000Z',
      modifiedAt: null,
      locale: 'en',
      acquiredAt: '2026-10-18T00:00:00.000Z',
      metadataHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
      nearDuplicateSignature: `metadata-token-set-v1:${'c'.repeat(64)}`,
      attribution: 'attribution',
      rightsEvidenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
      rightsVerifiedAt: '2026-10-15T00:00:00.000Z',
    };
    const payload = toGovUkRshOneShotPayload(metadata);
    expect(payload).toEqual({
      acquiredAt: metadata.acquiredAt,
      metadataHash: metadata.metadataHash,
      modifiedAt: null,
      publishedAt: metadata.publishedAt,
    });
    expect(Object.keys(payload).sort()).toEqual([
      'acquiredAt',
      'metadataHash',
      'modifiedAt',
      'publishedAt',
    ]);
  });
});

