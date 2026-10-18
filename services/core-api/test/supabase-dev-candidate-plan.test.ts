import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertReviewedSupabaseDevSnapshot,
  createSupabaseDevCandidatePlan,
} from '../../../packages/database/src/migration/supabase-dev-candidate-plan.js';

const snapshot = JSON.parse(
  readFileSync(
    new URL('./fixtures/supabase-dev-candidate-snapshot.synthetic.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

if (snapshot.fixtureKind !== 'SYNTHETIC_TEST_ONLY') {
  throw new Error('SUPABASE_DEV_TEST_SNAPSHOT_MUST_BE_SYNTHETIC');
}

function copySnapshot(): Record<string, unknown> {
  return structuredClone(snapshot);
}

describe('Supabase DEV migration candidate planner', () => {
  it('exports only 043 and 044 after validating the exact 042 remote baseline', () => {
    const plan = createSupabaseDevCandidatePlan(copySnapshot());
    expect(plan.map((migration) => migration.sequence)).toEqual(['043', '044']);
    expect(plan.map((migration) => migration.sourceMigrationName)).toEqual([
      '043_govuk_rsh_one_shot_metadata',
      '044_govuk_rsh_receipt_recovery',
    ]);
    expect(plan.every((migration) => migration.upSql.trim().length > 0)).toBe(true);
    expect(plan.every((migration) => migration.downSql.trim().length > 0)).toBe(true);
  });

  it.each([
    ['wrong project', (value: Record<string, unknown>) => {
      (value.project as Record<string, unknown>).id = 'not-dialektik-dev';
    }],
    ['wrong latest version', (value: Record<string, unknown>) => {
      (value.migrationHistory as Record<string, unknown>).latestVersion = '20261018000000';
    }],
    ['remote baseline body drift', (value: Record<string, unknown>) => {
      const history = value.migrationHistory as Record<string, unknown>;
      const fingerprints = history.bodyFingerprints as Record<string, unknown>[];
      fingerprints[0]!.remoteStatementsSha256 = '0'.repeat(64);
    }],
    ['new function already present', (value: Record<string, unknown>) => {
      (value.candidateState as Record<string, unknown>).persistFunctionExists = true;
    }],
    ['unexpected content rows', (value: Record<string, unknown>) => {
      const state = value.candidateState as Record<string, unknown>;
      (state.counts as Record<string, number>).articles = 1;
    }],
  ])('fails closed on %s', (_label, mutate) => {
    const value = copySnapshot();
    mutate(value);
    expect(() => assertReviewedSupabaseDevSnapshot(value)).toThrow();
  });

  it('rejects remote 043/044 history and does not include local 001–042 Kysely migrations', () => {
    const value = copySnapshot();
    const history = value.migrationHistory as Record<string, unknown>;
    const entries = history.entries as { version: string; name: string }[];
    entries.push({ version: '20261018000100', name: '043_govuk_rsh_one_shot_metadata' });
    history.count = entries.length;
    expect(() => createSupabaseDevCandidatePlan(value)).toThrow(
      'SUPABASE_DEV_MIGRATION_BASELINE_CHANGED',
    );
    expect(createSupabaseDevCandidatePlan(copySnapshot()).map((item) => item.sequence))
      .not.toContain('001');
  });
});
