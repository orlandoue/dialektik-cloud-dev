import { X509Certificate } from 'node:crypto';
import { createDatabase, destroyDatabase } from '@dialektik/database';
import { sql } from 'kysely';
import {
  parseGovUkAcquisitionArgs,
  validateGovUkWriterDatabaseUrl,
} from './govuk-product-acquisition.cli-contract.js';
import {
  acquireGovUkRshMetadataOnce,
  GOVUK_RSH_WRITER_ROLE,
  persistGovUkRshMetadataOnce,
} from './govuk-product-acquisition.js';

function requiredPem(value: string | undefined): string {
  if (!value || value.length > 65_536) throw new Error('GOVUK_RSH_WRITER_TLS_REQUIRED');
  const certificates = [...value.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu)];
  if (certificates.length !== 1) throw new Error('GOVUK_RSH_WRITER_TLS_INVALID');
  try {
    const certificate = new X509Certificate(certificates[0]?.[0] ?? '');
    if (
      !certificate.ca ||
      Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) <= Date.now()
    ) {
      throw new Error('invalid CA');
    }
  } catch {
    throw new Error('GOVUK_RSH_WRITER_TLS_INVALID');
  }
  return certificates[0]?.[0] ?? '';
}

async function verifyWriter(database: ReturnType<typeof createDatabase>): Promise<void> {
  const result = await sql.raw(
    "select current_user::text as current_user, session_user::text as session_user, current_database()::text as current_database, " +
      "has_column_privilege(current_user, 'public.articles', 'text_original', 'INSERT') as can_insert_title, " +
      "has_column_privilege(current_user, 'public.articles', 'text_original', 'SELECT') as can_select_article_title, " +
      "has_column_privilege(current_user, 'public.prospective_content_rights_write_guards', 'source_id', 'INSERT') as can_seed_source_rights_guard, " +
      "has_column_privilege(current_user, 'public.prospective_content_rights_write_guards', 'source_id', 'SELECT') as can_read_source_rights_guard, " +
      "has_column_privilege(current_user, 'public.live_acquisition_receipts', 'discovery_channel', 'INSERT') as can_insert_receipt, " +
      "has_column_privilege(current_user, 'public.live_article_versions', 'headline', 'INSERT') as can_insert_version, " +
      "(has_table_privilege(current_user, 'public.sources', 'UPDATE') OR has_table_privilege(current_user, 'public.sources', 'DELETE') OR has_table_privilege(current_user, 'public.sources', 'TRUNCATE') OR " +
      "has_any_column_privilege(current_user, 'public.sources', 'UPDATE') OR " +
      "has_table_privilege(current_user, 'public.live_source_policies', 'UPDATE') OR has_table_privilege(current_user, 'public.live_source_policies', 'DELETE') OR has_table_privilege(current_user, 'public.live_source_policies', 'TRUNCATE') OR " +
      "has_any_column_privilege(current_user, 'public.live_source_policies', 'UPDATE') OR " +
      "has_table_privilege(current_user, 'public.live_exposure_exclusions', 'UPDATE') OR has_table_privilege(current_user, 'public.live_exposure_exclusions', 'DELETE') OR has_table_privilege(current_user, 'public.live_exposure_exclusions', 'TRUNCATE') OR " +
      "has_any_column_privilege(current_user, 'public.live_exposure_exclusions', 'UPDATE') OR " +
      "has_table_privilege(current_user, 'public.live_acquisition_receipts', 'UPDATE') OR has_table_privilege(current_user, 'public.live_acquisition_receipts', 'DELETE') OR has_table_privilege(current_user, 'public.live_acquisition_receipts', 'TRUNCATE') OR " +
      "has_any_column_privilege(current_user, 'public.live_acquisition_receipts', 'UPDATE') OR " +
      "has_table_privilege(current_user, 'public.articles', 'UPDATE') OR has_table_privilege(current_user, 'public.articles', 'DELETE') OR has_table_privilege(current_user, 'public.articles', 'TRUNCATE') OR " +
      "has_any_column_privilege(current_user, 'public.articles', 'UPDATE') OR " +
      "has_table_privilege(current_user, 'public.live_article_versions', 'UPDATE') OR has_table_privilege(current_user, 'public.live_article_versions', 'DELETE') OR has_table_privilege(current_user, 'public.live_article_versions', 'TRUNCATE')) as forbidden_mutation, " +
      "has_any_column_privilege(current_user, 'public.live_article_versions', 'UPDATE') as forbidden_version_column_update, " +
      "(has_table_privilege(current_user, 'public.semantic_occurrences', 'INSERT') OR has_any_column_privilege(current_user, 'public.semantic_occurrences', 'INSERT') OR " +
      "has_table_privilege(current_user, 'public.semantic_observations', 'INSERT') OR has_any_column_privilege(current_user, 'public.semantic_observations', 'INSERT') OR " +
      "has_table_privilege(current_user, 'public.events', 'INSERT') OR has_any_column_privilege(current_user, 'public.events', 'INSERT')) as can_insert_semantics, " +
      "case when to_regnamespace('net') is null then false else has_schema_privilege(current_user, to_regnamespace('net'), 'USAGE') end as can_use_network_schema, " +
      "exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='net' and p.proname like 'http_%' and has_function_privilege(current_user, p.oid, 'EXECUTE')) as can_execute_network_http, " +
      "exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='net' and c.relname in ('http_request_queue','_http_response') and has_table_privilege(current_user, c.oid, 'SELECT')) as can_read_network_queue, " +
      "(select count(*) = 14 from pg_catalog.pg_policies where schemaname='public' and current_user = any(roles) and policyname = any(array[" +
      "'dialektik_govuk_writer_source_select','dialektik_govuk_writer_source_insert','dialektik_govuk_writer_article_select','dialektik_govuk_writer_article_insert'," +
      "'dialektik_govuk_writer_live_source_policy_select','dialektik_govuk_writer_live_source_policy_insert','dialektik_govuk_writer_exclusion_select','dialektik_govuk_writer_exclusion_insert'," +
      "'dialektik_govuk_writer_receipt_select','dialektik_govuk_writer_receipt_insert','dialektik_govuk_writer_version_select','dialektik_govuk_writer_version_insert'," +
      "'dialektik_govuk_writer_prospective_guard_select','dialektik_govuk_writer_prospective_guard_insert']::name[]) " +
      "and (select count(*) = 14 from pg_catalog.pg_policies where schemaname='public' " +
      "and tablename = any(array['sources','articles','live_source_policies','live_exposure_exclusions','live_acquisition_receipts','live_article_versions','prospective_content_rights_write_guards']) " +
      "and roles && array['dialektik_govuk_metadata_writer','public','anon','authenticated']::name[])) as scoped_rls_policies_valid, " +
      "(select count(*) = 5 and bool_and(c.relrowsecurity) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any(array['live_source_policies','live_exposure_exclusions','live_acquisition_receipts','live_article_versions','prospective_content_rights_write_guards'])) as live_writer_rls_enabled, " +
      "not exists(select 1 from pg_catalog.pg_auth_members m where m.member=(select oid from pg_catalog.pg_roles where rolname=current_user)) as has_no_role_memberships, " +
      "exists(select 1 from pg_catalog.pg_roles where rolname = current_user and rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and not rolinherit) as role_is_restricted",
  ).execute(database);
  const row = result.rows[0] as {
    current_user: string;
    session_user: string;
    current_database: string;
    can_insert_title: boolean;
    can_select_article_title: boolean;
    can_seed_source_rights_guard: boolean;
    can_read_source_rights_guard: boolean;
    can_insert_receipt: boolean;
    can_insert_version: boolean;
    forbidden_mutation: boolean;
    forbidden_version_column_update: boolean;
    can_insert_semantics: boolean;
    can_use_network_schema: boolean;
    can_execute_network_http: boolean;
    can_read_network_queue: boolean;
    scoped_rls_policies_valid: boolean;
    live_writer_rls_enabled: boolean;
    has_no_role_memberships: boolean;
    role_is_restricted: boolean;
  } | undefined;
  if (
    !row ||
    row.current_user !== GOVUK_RSH_WRITER_ROLE ||
    row.session_user !== GOVUK_RSH_WRITER_ROLE ||
    row.current_database !== 'postgres' ||
    row.can_insert_title !== true ||
    // The writer inserts the approved title but deliberately cannot read it back.
    row.can_select_article_title !== false ||
    row.can_seed_source_rights_guard !== true ||
    row.can_read_source_rights_guard !== true ||
    row.can_insert_receipt !== true ||
    row.can_insert_version !== true ||
    row.forbidden_mutation !== false ||
    row.forbidden_version_column_update !== false ||
    row.can_insert_semantics !== false ||
    row.can_use_network_schema !== false ||
    row.can_execute_network_http !== false ||
    row.can_read_network_queue !== false ||
    row.scoped_rls_policies_valid !== true ||
    row.live_writer_rls_enabled !== true ||
    row.has_no_role_memberships !== true ||
    row.role_is_restricted !== true
  ) {
    throw new Error('GOVUK_RSH_WRITER_PRIVILEGES_INVALID');
  }
}

async function main(): Promise<void> {
  const mode = parseGovUkAcquisitionArgs(process.argv.slice(2));
  if (mode === 'persist') {
    if (
      process.env.DIALEKTIK_GOVUK_RSH_PERSIST_ENABLED !== 'true' ||
      process.env.DIALEKTIK_GOVUK_RSH_PERSIST_CONFIRMATION !==
        'IMPORT_ONE_AUTHORIZED_GOVUK_RSH_ARTICLE'
    ) {
      throw new Error('GOVUK_RSH_PERSISTENCE_NOT_ENABLED');
    }
  }
  const acquiredAt = new Date();
  const metadata = await acquireGovUkRshMetadataOnce({ recordedAt: acquiredAt });
  if (mode === 'dry-run') {
    process.stdout.write(
      JSON.stringify({
        event: 'govuk_rsh_metadata_dry_run',
        source: 'Regulator of Social Housing',
        source_item_id: metadata.sourceItemId,
        canonical_url: metadata.canonicalUrl,
        published_at: metadata.publishedAt,
        modified_at: metadata.modifiedAt,
        title: metadata.title,
        discovery_channel: 'official_api',
        metadata_only: true,
        body_persisted: false,
        acquisition_persisted: false,
      }) + '\n',
    );
    return;
  }

  const rawUrl = process.env.DIALEKTIK_GOVUK_ACQUISITION_DATABASE_URL;
  if (!rawUrl) throw new Error('GOVUK_RSH_WRITER_DATABASE_REQUIRED');
  const databaseUrl = validateGovUkWriterDatabaseUrl(rawUrl);
  const caCertificate = requiredPem(process.env.DIALEKTIK_GOVUK_ACQUISITION_CA_CERT);
  const database = createDatabase({
    applicationName: 'dialektik-govuk-rsh-one-shot',
    connectionString: databaseUrl.toString(),
    caCertificate,
    maxConnections: 1,
  });
  try {
    await verifyWriter(database);
    const result = await persistGovUkRshMetadataOnce(database, metadata, { recordedAt: acquiredAt });
    process.stdout.write(
      JSON.stringify({
        event: 'govuk_rsh_metadata_persisted',
        source_id: result.sourceId,
        article_id: result.articleId,
        canonical_url: result.canonicalUrl,
        source_item_id: result.sourceItemId,
        status: result.status,
        receipt_written: result.receiptWritten,
        version_written: result.versionWritten,
        body_persisted: false,
        semantic_assignment: 'UNASSIGNED',
      }) + '\n',
    );
  } finally {
    await destroyDatabase(database);
  }
}

function safeOperationErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'GOVUK_RSH_OPERATION_FAILED';
  if (/^[A-Z0-9_]+$/u.test(error.message)) return error.message;
  if (error.name === 'TypeError' && error.message === 'fetch failed') {
    const cause = error.cause;
    const causeCode =
      cause !== null && typeof cause === 'object' && 'code' in cause
        ? String(cause.code)
        : '';
    const safeNetworkCodes = new Set([
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
    ]);
    return safeNetworkCodes.has(causeCode)
      ? 'GOVUK_RSH_NETWORK_' + causeCode
      : 'GOVUK_RSH_NETWORK_UNAVAILABLE';
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 'GOVUK_RSH_REQUEST_TIMEOUT';
  }
  return 'GOVUK_RSH_OPERATION_FAILED';
}

main().catch((error: unknown) => {
  process.stderr.write(safeOperationErrorCode(error) + '\n');
  process.exitCode = 1;
});
