import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseGovUkAcquisitionArgs,
  validateGovUkWriterDatabaseUrl,
} from '../src/live/govuk-product-acquisition.cli-contract.js';

const migration = readFileSync(
  resolve(process.cwd(), 'packages/database/src/migration/041_govuk_product_metadata_writer.ts'),
  'utf8',
);
const rowScopeMigration = readFileSync(
  resolve(process.cwd(), 'packages/database/src/migration/042_govuk_product_writer_row_scope.ts'),
  'utf8',
);
const channelMigration = readFileSync(
  resolve(process.cwd(), 'packages/database/src/migration/018_ephemeral_semantic_pipeline.ts'),
  'utf8',
);
const cli = readFileSync(
  resolve(process.cwd(), 'services/core-api/src/live/govuk-product-acquisition.cli.mts'),
  'utf8',
);
const cliContract = readFileSync(
  resolve(process.cwd(), 'services/core-api/src/live/govuk-product-acquisition.cli-contract.ts'),
  'utf8',
);

describe('GOV.UK acquisition database boundary', () => {
  it('uses a distinct least-privilege writer with insert/select columns only', () => {
    expect(migration).toContain('CREATE ROLE dialektik_govuk_metadata_writer');
    expect(migration).toContain('NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE');
    expect(migration).toContain('GRANT SELECT (');
    expect(migration).toContain('GRANT INSERT (');
    expect(migration).toContain(
      'GRANT INSERT (source_id)\n  ON TABLE public.prospective_content_rights_write_guards',
    );
    expect(migration).toContain(
      'GRANT SELECT (source_id)\n  ON TABLE public.prospective_content_rights_write_guards',
    );
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT)\s+ON TABLE/iu);
    expect(migration).not.toMatch(/GRANT\s+(?:UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(migration).not.toMatch(/GRANT\s+INSERT\s+\([^)]*\b(?:excerpt|author|declared_upstream)\b/iu);
    expect(migration).not.toMatch(/\bTO\s+(?:PUBLIC|anon|authenticated)\b/iu);
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT)\b[^;]*public\.(?:events|semantic_)/iu);
    expect(migration).not.toContain('dialektik_core_app');
  });

  it('does not add a duplicate discovery-channel migration', () => {
    expect(channelMigration).toContain(
      "check (discovery_channel in ('rss_atom', 'official_api'))",
    );
  });

  it('requires explicit one-shot persistence gates and rejects effective network-provider access', () => {
    expect(cliContract).toContain("values.get('--source') !== 'govuk-rsh'");
    expect(cliContract).toContain("values.get('--mode')");
    expect(cli).toContain("process.env.DIALEKTIK_GOVUK_RSH_PERSIST_ENABLED !== 'true'");
    expect(cli).toContain('IMPORT_ONE_AUTHORIZED_GOVUK_RSH_ARTICLE');
    expect(cli).toContain('row.can_use_network_schema !== false');
    expect(cli).toContain('row.can_execute_network_http !== false');
    expect(cli).toContain('row.can_read_network_queue !== false');
    expect(cli).toContain('row.scoped_rls_policies_valid !== true');
    expect(cli).toContain('row.live_writer_rls_enabled !== true');
    expect(cli).toContain('as can_select_article_title');
    expect(cli).toContain('row.can_select_article_title !== false');
    expect(cli).toContain('row.has_no_role_memberships !== true');
    expect(cli).toContain("'GOVUK_RSH_NETWORK_' + causeCode");
  });

  it('scopes the writer to the one approved GOV.UK source and item with RLS', () => {
    expect(rowScopeMigration).toContain('unexpected preexisting policies on GOV.UK writer support tables');
    expect(rowScopeMigration).toContain('expected Core read policies are missing; refusing migration');
    expect(rowScopeMigration).toContain('RSH target rows already exist; inspect before enabling one-shot writer policies');
    expect(rowScopeMigration).toContain('ALTER TABLE public.prospective_content_rights_write_guards ENABLE ROW LEVEL SECURITY');
    expect(rowScopeMigration).toContain('ALTER TABLE public.live_source_policies ENABLE ROW LEVEL SECURITY');
    expect(rowScopeMigration).toContain('ALTER TABLE public.live_exposure_exclusions ENABLE ROW LEVEL SECURITY');
    expect(rowScopeMigration).toContain('ALTER TABLE public.live_acquisition_receipts ENABLE ROW LEVEL SECURITY');
    expect(rowScopeMigration).toContain('ALTER TABLE public.live_article_versions ENABLE ROW LEVEL SECURITY');
    expect(rowScopeMigration).toContain("id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid");
    expect(rowScopeMigration).toContain("source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid");
    expect(rowScopeMigration).toContain("source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'");
    expect(rowScopeMigration).toContain("url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'");
    expect(rowScopeMigration).toContain('dialektik_govuk_writer_prospective_guard_insert');
    expect(rowScopeMigration).toContain('dialektik_govuk_writer_prospective_guard_select');
    expect(rowScopeMigration).toContain('AND canonical_domain = \'gov.uk\'');
    expect(rowScopeMigration).toContain("origin = 'LIVE_REAL'");
    expect(rowScopeMigration).toContain("storage_policy = 'METADATA_ONLY'");
    expect(rowScopeMigration).toContain("text_original = 'Social housing landlord downgraded by RSH'");
    expect(rowScopeMigration).toContain("headline = 'Social housing landlord downgraded by RSH'");
    expect(rowScopeMigration).not.toContain('a.text_original');
    expect(rowScopeMigration).toContain('"polling":"disabled"');
    expect(rowScopeMigration).not.toMatch(/CREATE POLICY[^;]+\bTO\s+(?:PUBLIC|anon|authenticated)\b/isu);
    expect(rowScopeMigration).not.toMatch(/FOR\s+ALL\b/iu);
    expect(rowScopeMigration).toContain('roles = ARRAY[\'dialektik_core_app\']::name[]');
  });

  it('preserves the preexisting Core read surface while denying other client roles', () => {
    expect(rowScopeMigration.match(/TO dialektik_core_app USING \(true\)/gu)).toHaveLength(5);
    expect(rowScopeMigration).toContain('dialektik_govuk_core_read_live_source_policies');
    expect(rowScopeMigration).toContain('dialektik_govuk_core_read_live_exposure_exclusions');
    expect(rowScopeMigration).toContain('dialektik_govuk_core_read_live_acquisition_receipts');
    expect(rowScopeMigration).toContain('dialektik_govuk_core_read_live_article_versions');
    expect(rowScopeMigration).toContain('dialektik_govuk_core_read_prospective_rights_guard');
    expect(rowScopeMigration).toContain('additional policies exist on GOV.UK writer RLS tables; inspect before rollback');
    expect(rowScopeMigration).not.toMatch(/TO\s+(?:PUBLIC|anon|authenticated)\b/iu);
  });

  it('allows only an explicit one-shot selection of the fixed GOV.UK source', () => {
    expect(parseGovUkAcquisitionArgs(['--source', 'govuk-rsh', '--mode', 'dry-run', '--once'])).toBe(
      'dry-run',
    );
    expect(parseGovUkAcquisitionArgs(['--source', 'govuk-rsh', '--mode', 'persist', '--once'])).toBe(
      'persist',
    );
    for (const args of [
      ['--source', 'other', '--mode', 'dry-run', '--once'],
      ['--source', 'govuk-rsh', '--mode', 'dry-run'],
      ['--source', 'govuk-rsh', '--mode', 'dry-run', '--once', '--once'],
      ['--source', 'govuk-rsh', '--mode', 'poll', '--once'],
      ['--source', 'govuk-rsh', '--mode', 'dry-run', '--once', '--force'],
    ]) {
      expect(() => parseGovUkAcquisitionArgs(args)).toThrow('GOVUK_RSH_CLI_ARGUMENTS_INVALID');
    }
  });

  it('accepts only the dedicated development-project PostgreSQL identity and port', () => {
    const allowedUrl = new URL(
      'postgresql://dialektik_govuk_metadata_writer.vclsswwfhljczxgnsciq@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    );
    allowedUrl.password = 'test-only-placeholder';
    const allowed = allowedUrl.toString();
    expect(validateGovUkWriterDatabaseUrl(allowed).hostname).toBe(
      'aws-0-us-east-1.pooler.supabase.com',
    );

    for (const denied of [
      allowed.replace('aws-0-us-east-1.pooler.supabase.com', 'attacker.example'),
      allowed.replace(':5432/postgres', ':5433/postgres'),
      allowed + '?sslmode=disable',
      allowed + '#other-target',
      allowed.replace('dialektik_govuk_metadata_writer.vclsswwfhljczxgnsciq', 'postgres'),
    ]) {
      expect(() => validateGovUkWriterDatabaseUrl(denied)).toThrow(
        'GOVUK_RSH_WRITER_TARGET_DENIED',
      );
    }
  });
});
