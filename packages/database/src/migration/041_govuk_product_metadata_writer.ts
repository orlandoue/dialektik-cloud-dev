import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const UP = String.raw`
DO $role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dialektik_govuk_metadata_writer') THEN
    RAISE EXCEPTION 'dialektik_govuk_metadata_writer already exists; inspect it before migration';
  END IF;
  CREATE ROLE dialektik_govuk_metadata_writer
    LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 1;
END;
$role$;

GRANT USAGE ON SCHEMA public TO dialektik_govuk_metadata_writer;

-- Reads are column-scoped for validation, deduplication and immutable-trigger checks.
GRANT SELECT (id, name, source_type, is_issuing_entity, canonical_domain, origin)
  ON TABLE public.sources TO dialektik_govuk_metadata_writer;
-- The existing source trigger names source_id as its ON CONFLICT arbiter.
GRANT SELECT (source_id)
  ON TABLE public.prospective_content_rights_write_guards TO dialektik_govuk_metadata_writer;
GRANT SELECT (id, source_id, registry_key, rights_class, storage_policy, active, rights_evidence_url, rights_verified_at, policy, recorded_at)
  ON TABLE public.live_source_policies TO dialektik_govuk_metadata_writer;
GRANT SELECT (id, registry_key, publisher_name, canonical_url, source_item_id, published_at, first_seen_at, discovery_url, reason, content_hash, near_duplicate_signature)
  ON TABLE public.live_exposure_exclusions TO dialektik_govuk_metadata_writer;
GRANT SELECT (id, source_id, policy_id, exclusion_id, source_item_id, canonical_url, raw_payload_hash, adapter_version, disposition)
  ON TABLE public.live_acquisition_receipts TO dialektik_govuk_metadata_writer;
GRANT SELECT (id, source_id, event_id, url_canonical, origin, live_exposure_id, captured_at)
  ON TABLE public.articles TO dialektik_govuk_metadata_writer;
GRANT SELECT (article_id, version_number, metadata_hash)
  ON TABLE public.live_article_versions TO dialektik_govuk_metadata_writer;

-- Inserts are column-scoped; no UPDATE, DELETE, TRUNCATE, schema DDL or semantic-table writes.
GRANT INSERT (id, name, source_type, is_issuing_entity, canonical_domain, origin, created_at)
  ON TABLE public.sources TO dialektik_govuk_metadata_writer;
-- The existing AFTER INSERT source trigger seeds this append-only guard as the invoker.
-- The guard trigger rejects direct inserts (trigger depth must be nested under Sources).
GRANT INSERT (source_id)
  ON TABLE public.prospective_content_rights_write_guards TO dialektik_govuk_metadata_writer;
GRANT INSERT (id, source_id, registry_key, rights_class, storage_policy, active, rights_evidence_url, rights_verified_at, policy, recorded_at)
  ON TABLE public.live_source_policies TO dialektik_govuk_metadata_writer;
GRANT INSERT (id, registry_key, publisher_name, canonical_url, source_item_id, published_at, first_seen_at, discovery_url, reason, content_hash, near_duplicate_signature)
  ON TABLE public.live_exposure_exclusions TO dialektik_govuk_metadata_writer;
GRANT INSERT (id, source_id, policy_id, exclusion_id, discovery_channel, discovery_url, discovered_url, canonical_url, source_item_id, published_at, modified_at, original_published_at, original_modified_at, seen_at, raw_payload_hash, adapter_version, disposition, error_code)
  ON TABLE public.live_acquisition_receipts TO dialektik_govuk_metadata_writer;
GRANT INSERT (id, source_id, event_id, url_canonical, text_original, text_normalized, lang, published_at, captured_at, updated_at_source, origin, live_exposure_id)
  ON TABLE public.articles TO dialektik_govuk_metadata_writer;
GRANT INSERT (id, article_id, receipt_id, version_number, metadata_hash, headline, published_at, modified_at, content_hash, near_duplicate_signature, recorded_at)
  ON TABLE public.live_article_versions TO dialektik_govuk_metadata_writer;
`;

const DOWN = String.raw`
REVOKE INSERT (id, name, source_type, is_issuing_entity, canonical_domain, origin, created_at)
  ON TABLE public.sources FROM dialektik_govuk_metadata_writer;
REVOKE INSERT (source_id)
  ON TABLE public.prospective_content_rights_write_guards FROM dialektik_govuk_metadata_writer;
REVOKE INSERT (id, source_id, registry_key, rights_class, storage_policy, active, rights_evidence_url, rights_verified_at, policy, recorded_at)
  ON TABLE public.live_source_policies FROM dialektik_govuk_metadata_writer;
REVOKE INSERT (id, registry_key, publisher_name, canonical_url, source_item_id, published_at, first_seen_at, discovery_url, reason, content_hash, near_duplicate_signature)
  ON TABLE public.live_exposure_exclusions FROM dialektik_govuk_metadata_writer;
REVOKE INSERT (id, source_id, policy_id, exclusion_id, discovery_channel, discovery_url, discovered_url, canonical_url, source_item_id, published_at, modified_at, original_published_at, original_modified_at, seen_at, raw_payload_hash, adapter_version, disposition, error_code)
  ON TABLE public.live_acquisition_receipts FROM dialektik_govuk_metadata_writer;
REVOKE INSERT (id, source_id, event_id, url_canonical, text_original, text_normalized, lang, published_at, captured_at, updated_at_source, origin, live_exposure_id)
  ON TABLE public.articles FROM dialektik_govuk_metadata_writer;
REVOKE INSERT (id, article_id, receipt_id, version_number, metadata_hash, headline, published_at, modified_at, content_hash, near_duplicate_signature, recorded_at)
  ON TABLE public.live_article_versions FROM dialektik_govuk_metadata_writer;

REVOKE SELECT (id, name, source_type, is_issuing_entity, canonical_domain, origin)
  ON TABLE public.sources FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (source_id)
  ON TABLE public.prospective_content_rights_write_guards FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (id, source_id, registry_key, rights_class, storage_policy, active, rights_evidence_url, rights_verified_at, policy, recorded_at)
  ON TABLE public.live_source_policies FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (id, registry_key, publisher_name, canonical_url, source_item_id, published_at, first_seen_at, discovery_url, reason, content_hash, near_duplicate_signature)
  ON TABLE public.live_exposure_exclusions FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (id, source_id, policy_id, exclusion_id, source_item_id, canonical_url, raw_payload_hash, adapter_version, disposition)
  ON TABLE public.live_acquisition_receipts FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (id, source_id, event_id, url_canonical, origin, live_exposure_id, captured_at)
  ON TABLE public.articles FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (article_id, version_number, metadata_hash)
  ON TABLE public.live_article_versions FROM dialektik_govuk_metadata_writer;

REVOKE USAGE ON SCHEMA public FROM dialektik_govuk_metadata_writer;
DROP ROLE dialektik_govuk_metadata_writer;
`;

export const govUkProductMetadataWriterMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(database: Kysely<Database>): Promise<void> {
    await sql.raw(DOWN).execute(database);
  },
};
