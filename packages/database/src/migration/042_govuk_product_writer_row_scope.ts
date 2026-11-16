import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const UP = String.raw`
-- Fail closed if any preexisting client/writer policy could combine with the
-- scoped policies below under PostgreSQL's permissive-policy OR semantics.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'live_source_policies','live_exposure_exclusions',
        'live_acquisition_receipts','live_article_versions',
        'prospective_content_rights_write_guards'
      ])
  ) THEN
    RAISE EXCEPTION 'unexpected preexisting policies on GOV.UK writer support tables';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('sources','articles')
      AND ('dialektik_govuk_metadata_writer' = ANY (roles)
        OR 'public' = ANY (roles) OR 'anon' = ANY (roles)
        OR 'authenticated' = ANY (roles))
  ) THEN
    RAISE EXCEPTION 'unexpected client/writer policy on sources or articles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'sources'
      AND policyname = 'dialektik_core_read' AND cmd = 'SELECT'
      AND roles = ARRAY['dialektik_core_app']::name[] AND qual = 'true'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'articles'
      AND policyname = 'dialektik_core_read' AND cmd = 'SELECT'
      AND roles = ARRAY['dialektik_core_app']::name[] AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'expected Core read policies are missing; refusing migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sources
    WHERE id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
  ) OR EXISTS (
    SELECT 1 FROM public.articles
    WHERE source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
       OR url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
  ) OR EXISTS (
    SELECT 1 FROM public.live_acquisition_receipts
    WHERE source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
      AND source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
  ) THEN
    RAISE EXCEPTION 'RSH target rows already exist; inspect before enabling one-shot writer policies';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'dialektik_govuk_metadata_writer'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'dialektik_govuk_metadata_writer'
  ) THEN
    RAISE EXCEPTION 'GOV.UK writer role is missing, login-enabled, or has unsafe role attributes';
  END IF;
END;
$preflight$;

-- Keep Core's existing read behavior when row security is enabled on these
-- internal acquisition tables. The role has no INSERT grants on them.
ALTER TABLE public.live_source_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_exposure_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_acquisition_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_article_versions ENABLE ROW LEVEL SECURITY;
-- The source insert trigger writes this guard as the invoking writer. Row
-- scope is required so the trigger's column grant cannot seed arbitrary IDs.
ALTER TABLE public.prospective_content_rights_write_guards ENABLE ROW LEVEL SECURITY;

CREATE POLICY dialektik_govuk_core_read_live_source_policies
  ON public.live_source_policies FOR SELECT TO dialektik_core_app USING (true);
CREATE POLICY dialektik_govuk_core_read_live_exposure_exclusions
  ON public.live_exposure_exclusions FOR SELECT TO dialektik_core_app USING (true);
CREATE POLICY dialektik_govuk_core_read_live_acquisition_receipts
  ON public.live_acquisition_receipts FOR SELECT TO dialektik_core_app USING (true);
CREATE POLICY dialektik_govuk_core_read_live_article_versions
  ON public.live_article_versions FOR SELECT TO dialektik_core_app USING (true);
CREATE POLICY dialektik_govuk_core_read_prospective_rights_guard
  ON public.prospective_content_rights_write_guards FOR SELECT TO dialektik_core_app USING (true);

CREATE POLICY dialektik_govuk_writer_prospective_guard_select
  ON public.prospective_content_rights_write_guards FOR SELECT TO dialektik_govuk_metadata_writer
  USING (source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid);
CREATE POLICY dialektik_govuk_writer_prospective_guard_insert
  ON public.prospective_content_rights_write_guards FOR INSERT TO dialektik_govuk_metadata_writer
  WITH CHECK (source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid);

CREATE POLICY dialektik_govuk_writer_source_select
  ON public.sources FOR SELECT TO dialektik_govuk_metadata_writer
  USING (
    id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND canonical_domain = 'gov.uk'
  );
CREATE POLICY dialektik_govuk_writer_source_insert
  ON public.sources FOR INSERT TO dialektik_govuk_metadata_writer
  WITH CHECK (
    id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND name = 'Regulator of Social Housing'
    AND source_type = 'other'::public.source_type
    AND is_issuing_entity = false
    AND canonical_domain = 'gov.uk'
    AND origin = 'LIVE_REAL'
  );

CREATE POLICY dialektik_govuk_writer_live_source_policy_select
  ON public.live_source_policies FOR SELECT TO dialektik_govuk_metadata_writer
  USING (
    source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND registry_key = 'product-govuk-rsh-content-api-v1'
  );
CREATE POLICY dialektik_govuk_writer_live_source_policy_insert
  ON public.live_source_policies FOR INSERT TO dialektik_govuk_metadata_writer
  WITH CHECK (
    source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND registry_key = 'product-govuk-rsh-content-api-v1'
    AND rights_class = 'LIVE_READY'
    AND storage_policy = 'METADATA_ONLY'
    AND active = true
    AND rights_evidence_url = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
    AND rights_verified_at = '2026-10-15T00:00:00.000Z'::timestamptz
    AND policy = '{
      "sourceId":"01M4YDQK00WS344WW8RCPCEQHE",
      "registryKey":"product-govuk-rsh-content-api-v1",
      "publisherName":"Regulator of Social Housing",
      "canonicalDomain":"gov.uk",
      "sourceType":"other",
      "publisherFamily":"Regulator of Social Housing",
      "category":null,
      "discoveryChannel":"official_api",
      "endpoint":"https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh",
      "rightsClass":"LIVE_READY",
      "storagePolicy":"METADATA_ONLY",
      "active":true,
      "rightsEvidenceUrl":"https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
      "rightsVerifiedAt":"2026-10-15T00:00:00.000Z",
      "attribution":"© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0.",
      "language":"en",
      "allowedArticleDomains":["www.gov.uk"],
      "metadataStorageGranted":true,
      "externalSourceLinkGranted":true,
      "fulltextAcquisition":false,
      "fulltextMachineProcessing":false,
      "fulltextPersistence":false,
      "derivedSemanticPersistence":false,
      "thirdPartyContent":"excluded",
      "attachments":"excluded",
      "images":"excluded",
      "polling":"disabled"
    }'::jsonb
  );

CREATE POLICY dialektik_govuk_writer_exclusion_select
  ON public.live_exposure_exclusions FOR SELECT TO dialektik_govuk_metadata_writer
  USING (
    registry_key = 'product-govuk-rsh-content-api-v1'
    AND publisher_name = 'Regulator of Social Housing'
    AND source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
    AND discovery_url = 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh'
    AND (canonical_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
         OR canonical_url IS NULL)
  );
CREATE POLICY dialektik_govuk_writer_exclusion_insert
  ON public.live_exposure_exclusions FOR INSERT TO dialektik_govuk_metadata_writer
  WITH CHECK (
    registry_key = 'product-govuk-rsh-content-api-v1'
    AND publisher_name = 'Regulator of Social Housing'
    AND source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
    AND discovery_url = 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh'
    AND (
      (reason = 'govuk_rsh_metadata_acquisition'
       AND canonical_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
       AND content_hash IS NULL AND near_duplicate_signature IS NULL)
      OR
      (reason = 'govuk_rsh_metadata_title_hash'
       AND canonical_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
       AND content_hash ~ '^[0-9a-f]{64}$'
       AND near_duplicate_signature ~ '^metadata-token-set-v1:[0-9a-f]{64}$')
      OR
      (reason = 'govuk_rsh_metadata_source_identity'
       AND canonical_url IS NULL AND content_hash IS NULL
       AND near_duplicate_signature IS NULL)
    )
  );

CREATE POLICY dialektik_govuk_writer_receipt_select
  ON public.live_acquisition_receipts FOR SELECT TO dialektik_govuk_metadata_writer
  USING (
    source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
  );
CREATE POLICY dialektik_govuk_writer_receipt_insert
  ON public.live_acquisition_receipts FOR INSERT TO dialektik_govuk_metadata_writer
  WITH CHECK (
    source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
    AND discovery_channel = 'official_api'
    AND discovery_url = 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh'
    AND discovered_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
    AND canonical_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
    AND raw_payload_hash ~ '^[0-9a-f]{64}$'
    AND adapter_version = 'govuk-rsh-content-api-metadata-v1'
    AND disposition = 'PERSISTED'
    AND error_code IS NULL
    AND EXISTS (
      SELECT 1 FROM public.live_source_policies p
      WHERE p.id = policy_id
        AND p.source_id = live_acquisition_receipts.source_id
        AND p.registry_key = 'product-govuk-rsh-content-api-v1'
        AND p.rights_class = 'LIVE_READY'
        AND p.storage_policy = 'METADATA_ONLY'
        AND p.active = true
    )
    AND EXISTS (
      SELECT 1 FROM public.live_exposure_exclusions e
      WHERE e.id = exclusion_id
        AND e.registry_key = 'product-govuk-rsh-content-api-v1'
        AND e.source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
        AND e.canonical_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
        AND e.reason = 'govuk_rsh_metadata_acquisition'
    )
  );

CREATE POLICY dialektik_govuk_writer_article_select
  ON public.articles FOR SELECT TO dialektik_govuk_metadata_writer
  USING (
    source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND origin = 'LIVE_REAL'
    AND event_id IS NULL
    AND url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
  );
CREATE POLICY dialektik_govuk_writer_article_insert
  ON public.articles FOR INSERT TO dialektik_govuk_metadata_writer
  WITH CHECK (
    source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
    AND event_id IS NULL
    AND url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
    AND origin = 'LIVE_REAL'
    AND lang = 'en'
    AND text_original = 'Social housing landlord downgraded by RSH'
    AND text_normalized = 'Social housing landlord downgraded by RSH'
    AND EXISTS (
      SELECT 1 FROM public.live_exposure_exclusions e
      WHERE e.id = live_exposure_id
        AND e.registry_key = 'product-govuk-rsh-content-api-v1'
        AND e.source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
        AND e.canonical_url = articles.url_canonical
        AND e.reason = 'govuk_rsh_metadata_acquisition'
    )
  );

CREATE POLICY dialektik_govuk_writer_version_select
  ON public.live_article_versions FOR SELECT TO dialektik_govuk_metadata_writer
  USING (
    EXISTS (
      SELECT 1 FROM public.live_acquisition_receipts r
      WHERE r.id = receipt_id
        AND r.source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
        AND r.source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
    )
  );
CREATE POLICY dialektik_govuk_writer_version_insert
  ON public.live_article_versions FOR INSERT TO dialektik_govuk_metadata_writer
  WITH CHECK (
    metadata_hash ~ '^[0-9a-f]{64}$'
    AND content_hash ~ '^[0-9a-f]{64}$'
    AND near_duplicate_signature ~ '^metadata-token-set-v1:[0-9a-f]{64}$'
    AND char_length(headline) BETWEEN 1 AND 1024
    AND EXISTS (
      SELECT 1 FROM public.articles a
      WHERE a.id = article_id
        AND a.source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
        AND a.url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
        AND a.origin = 'LIVE_REAL' AND a.event_id IS NULL
    )
    AND headline = 'Social housing landlord downgraded by RSH'
    AND EXISTS (
      SELECT 1 FROM public.live_acquisition_receipts r
      WHERE r.id = receipt_id
        AND r.source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
        AND r.source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
        AND r.raw_payload_hash = metadata_hash
        AND r.disposition = 'PERSISTED'
    )
  );
`;

const DOWN = String.raw`
DO $down$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'live_source_policies','live_exposure_exclusions',
        'live_acquisition_receipts','live_article_versions',
        'prospective_content_rights_write_guards'
      ])
      AND policyname NOT IN (
        'dialektik_govuk_core_read_live_source_policies',
        'dialektik_govuk_core_read_live_exposure_exclusions',
        'dialektik_govuk_core_read_live_acquisition_receipts',
        'dialektik_govuk_core_read_live_article_versions',
        'dialektik_govuk_writer_live_source_policy_select',
        'dialektik_govuk_writer_live_source_policy_insert',
        'dialektik_govuk_writer_exclusion_select',
        'dialektik_govuk_writer_exclusion_insert',
        'dialektik_govuk_writer_receipt_select',
        'dialektik_govuk_writer_receipt_insert',
        'dialektik_govuk_writer_version_select',
        'dialektik_govuk_writer_version_insert',
        'dialektik_govuk_core_read_prospective_rights_guard',
        'dialektik_govuk_writer_prospective_guard_select',
        'dialektik_govuk_writer_prospective_guard_insert'
      )
  ) THEN
    RAISE EXCEPTION 'additional policies exist on GOV.UK writer RLS tables; inspect before rollback';
  END IF;
END;
$down$;

DROP POLICY dialektik_govuk_writer_version_insert ON public.live_article_versions;
DROP POLICY dialektik_govuk_writer_version_select ON public.live_article_versions;
DROP POLICY dialektik_govuk_core_read_live_article_versions ON public.live_article_versions;
ALTER TABLE public.live_article_versions DISABLE ROW LEVEL SECURITY;

DROP POLICY dialektik_govuk_writer_receipt_insert ON public.live_acquisition_receipts;
DROP POLICY dialektik_govuk_writer_receipt_select ON public.live_acquisition_receipts;
DROP POLICY dialektik_govuk_core_read_live_acquisition_receipts ON public.live_acquisition_receipts;
ALTER TABLE public.live_acquisition_receipts DISABLE ROW LEVEL SECURITY;

DROP POLICY dialektik_govuk_writer_exclusion_insert ON public.live_exposure_exclusions;
DROP POLICY dialektik_govuk_writer_exclusion_select ON public.live_exposure_exclusions;
DROP POLICY dialektik_govuk_core_read_live_exposure_exclusions ON public.live_exposure_exclusions;
ALTER TABLE public.live_exposure_exclusions DISABLE ROW LEVEL SECURITY;

DROP POLICY dialektik_govuk_writer_live_source_policy_insert ON public.live_source_policies;
DROP POLICY dialektik_govuk_writer_live_source_policy_select ON public.live_source_policies;
DROP POLICY dialektik_govuk_core_read_live_source_policies ON public.live_source_policies;
ALTER TABLE public.live_source_policies DISABLE ROW LEVEL SECURITY;

DROP POLICY dialektik_govuk_writer_prospective_guard_insert ON public.prospective_content_rights_write_guards;
DROP POLICY dialektik_govuk_writer_prospective_guard_select ON public.prospective_content_rights_write_guards;
DROP POLICY dialektik_govuk_core_read_prospective_rights_guard ON public.prospective_content_rights_write_guards;
ALTER TABLE public.prospective_content_rights_write_guards DISABLE ROW LEVEL SECURITY;

DROP POLICY dialektik_govuk_writer_article_insert ON public.articles;
DROP POLICY dialektik_govuk_writer_article_select ON public.articles;
DROP POLICY dialektik_govuk_writer_source_insert ON public.sources;
DROP POLICY dialektik_govuk_writer_source_select ON public.sources;
`;

export const govUkProductWriterRowScopeMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(database: Kysely<Database>): Promise<void> {
    await sql.raw(DOWN).execute(database);
  },
};
