import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGovUkAcquisitionArgs } from '../src/live/govuk-product-acquisition.cli-contract.js';

const migration = readFileSync(
  resolve(process.cwd(), 'packages/database/src/migration/041_govuk_product_metadata_writer.ts'),
  'utf8',
);
const rowScopeMigration = readFileSync(
  resolve(process.cwd(), 'packages/database/src/migration/042_govuk_product_writer_row_scope.ts'),
  'utf8',
);
const oneShotMigration = readFileSync(
  resolve(process.cwd(), 'packages/database/src/migration/043_govuk_rsh_one_shot_metadata.ts'),
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

  it('fails closed before acquisition when persistence requires a controlled PostgreSQL operator', () => {
    expect(cliContract).toContain("values.get('--source') !== 'govuk-rsh'");
    expect(cliContract).toContain("values.get('--mode')");
    expect(cli).toContain("if (mode === 'persist')");
    expect(cli).toContain('DIALEKTIK_GOVUK_RSH_PERSIST_ENABLED');
    expect(cli).toContain('persistGovUkRshMetadataWithInvoker');
    expect(cli).not.toContain('postgres');
    expect(cli).not.toContain('metadata_writer');
    expect(cli).not.toContain('DIALEKTIK_GOVUK_ACQUISITION_DATABASE_URL');
    expect(cli).not.toContain('DIALEKTIK_GOVUK_ACQUISITION_CA_CERT');
    expect(cli).not.toContain('persistGovUkRshMetadataOnce');
    expect(cli).toContain("'GOVUK_RSH_NETWORK_' + causeCode");
  });

  it('scopes the writer to the one approved GOV.UK source and item with RLS', () => {
    expect(rowScopeMigration).toContain('unexpected preexisting policies on GOV.UK writer support tables');
    expect(rowScopeMigration).toContain('expected Core read policies are missing; refusing migration');
    expect(rowScopeMigration).toContain('RSH target rows already exist; inspect before enabling one-shot writer policies');
    expect(rowScopeMigration).toContain('AND NOT rolcanlogin AND NOT rolsuper');
    expect(rowScopeMigration).toContain('writer role is missing, login-enabled, or has unsafe role attributes');
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

  it('installs a fixed-scope one-shot function owned by the closed writer role', () => {
    expect(oneShotMigration).toContain('SECURITY DEFINER');
    expect(oneShotMigration).toContain('SET search_path = pg_catalog, pg_temp');
    expect(oneShotMigration).toContain('SET row_security = on');
    expect(oneShotMigration).toContain("session_user <> 'dialektik_govuk_rsh_invoker'");
    expect(oneShotMigration).toContain("current_user <> 'dialektik_govuk_metadata_writer'");
    expect(oneShotMigration).toContain('CREATE ROLE dialektik_govuk_rsh_invoker NOLOGIN NOINHERIT');
    expect(oneShotMigration).toContain('CONNECTION LIMIT 2');
    expect(oneShotMigration).toContain('GRANT CONNECT ON DATABASE');
    expect(oneShotMigration).toContain('GRANT USAGE ON SCHEMA dialektik_ops TO dialektik_govuk_rsh_invoker');
    expect(oneShotMigration).toContain('REVOKE CREATE ON SCHEMA dialektik_ops FROM dialektik_govuk_metadata_writer');
    expect(oneShotMigration).toContain('GOVUK_RSH_INVOKER_HAS_DIRECT_WRITE_PRIVILEGES');
    expect(oneShotMigration).toContain('GOVUK_RSH_INVOKER_CAN_EXECUTE_OTHER_DEFINER_FUNCTIONS');
    expect(oneShotMigration).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+\bTO\s+dialektik_govuk_rsh_invoker/isu);
    expect(oneShotMigration).toContain("'86f4abba-9eaa-412f-b048-5ed30aa74201'");
    expect(oneShotMigration).toContain("'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'");
    expect(oneShotMigration).toContain('GOVUK_RSH_METADATA_FIELDS_OUT_OF_SCOPE');
    expect(oneShotMigration).toContain('pg_advisory_xact_lock(20261018, 86)');
    expect(oneShotMigration).toContain('REVOKE EXECUTE ON FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)');
    expect(oneShotMigration).toContain('SET LOCAL ROLE dialektik_govuk_metadata_writer;');
    expect(oneShotMigration).not.toMatch(/\bEXECUTE\s+format\s*\(/iu);
    expect(oneShotMigration).not.toMatch(/\b(?:ALTER|CREATE)\s+ROLE\b[^;]*\bLOGIN\b/isu);
    expect(oneShotMigration).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+\bTO\s+(?:PUBLIC|anon|authenticated|dialektik_core_app)\b/isu);
    expect(oneShotMigration).toContain('EXPECTED_NINE_ROWS_NOT_WRITTEN');
    expect(oneShotMigration).toContain('only the restricted PostgreSQL 17 creator-admin grant is accepted');
    expect(oneShotMigration).toContain('member = current_user::regrole');
    expect(oneShotMigration).toContain('AND admin_option');
    expect(oneShotMigration).toContain('privilege.grantee = session_user::pg_catalog.regrole');
    expect(oneShotMigration).toContain('pg_catalog.aclexplode');
    expect(oneShotMigration).toContain('INSERT INTO public.prospective_content_rights_write_guards');
    expect(oneShotMigration).toContain('rights_guard_trigger_count <> 2');
    expect(oneShotMigration).toContain('CREATE OR REPLACE FUNCTION public.dialektik_validate_live_receipt()');
    expect(oneShotMigration).toContain('CREATE OR REPLACE FUNCTION public.dialektik_validate_live_article()');
    expect(oneShotMigration).toContain('CREATE OR REPLACE FUNCTION public.dialektik_validate_live_version()');
    expect(oneShotMigration).toContain('public.live_source_policies AS policy');
    expect(oneShotMigration).toContain('public.live_acquisition_receipts AS receipt');
    expect(oneShotMigration).toContain('public.live_exposure_exclusions AS exclusion');
    expect(oneShotMigration).toContain('receipt_validator_trigger_count <> 1');
    expect(oneShotMigration).toContain('article_validator_trigger_count <> 1');
    expect(oneShotMigration).toContain('version_validator_trigger_count <> 1');
    expect(oneShotMigration).toContain('session_user::pg_catalog.regrole');
    expect(oneShotMigration).toContain('membership.roleid IN');
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

});
