import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

/**
 * ATTACK 047 candidate. This migration is intentionally unvalidated until it
 * passes the isolated PostgreSQL 17.11 recovery and ACL suite. Do not apply it
 * to a managed database on the strength of static review alone.
 */
const UP = String.raw`
DO $preflight$
DECLARE
  v_writer oid;
  v_invoker oid;
BEGIN
  IF current_user <> 'postgres'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = current_user AND (rolsuper OR rolcreaterole)
     )
     OR NOT pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'ATTACK047 requires the reviewed postgres migration principal';
  END IF;

  SELECT oid INTO v_writer
  FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_metadata_writer'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit;
  SELECT oid INTO v_invoker
  FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_rsh_invoker'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
    AND rolconnlimit = 2;
  IF v_writer IS NULL OR v_invoker IS NULL THEN
    RAISE EXCEPTION 'ATTACK047 requires the exact restricted, NOLOGIN 043 roles';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = v_invoker OR roleid = v_invoker
  ) THEN
    RAISE EXCEPTION 'ATTACK047 invoker must have no role memberships';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = v_writer
      AND NOT (
        member = current_user::pg_catalog.regrole
        AND grantor <> current_user::pg_catalog.regrole
        AND admin_option AND NOT inherit_option AND NOT set_option
      )
  ) THEN
    RAISE EXCEPTION 'ATTACK047 found an unexpected writer membership';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = v_writer AND member = current_user::pg_catalog.regrole
      AND grantor <> current_user::pg_catalog.regrole
      AND admin_option AND NOT inherit_option AND NOT set_option
  ) THEN
    RAISE EXCEPTION 'ATTACK047 migration principal lacks ADMIN OPTION on the exact writer role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity
    WHERE usename IN ('dialektik_govuk_rsh_invoker','dialektik_govuk_metadata_writer')
      AND pid <> pg_catalog.pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'ATTACK047 requires zero invoker and writer sessions';
  END IF;
  IF pg_catalog.to_regnamespace('dialektik_ops') IS NULL
     OR pg_catalog.has_schema_privilege(v_invoker, 'dialektik_ops', 'CREATE')
     OR NOT pg_catalog.has_schema_privilege(v_invoker, 'dialektik_ops', 'USAGE') THEN
    RAISE EXCEPTION 'ATTACK047 requires the existing closed operations schema';
  END IF;
  IF pg_catalog.to_regprocedure('dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)') IS NULL
     OR (SELECT proowner FROM pg_catalog.pg_proc
         WHERE oid = 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)'::pg_catalog.regprocedure) <> v_writer THEN
    RAISE EXCEPTION 'ATTACK047 requires the reviewed 043 writer function and owner';
  END IF;
  IF pg_catalog.has_schema_privilege(v_writer, 'dialektik_ops', 'CREATE') THEN
    RAISE EXCEPTION 'ATTACK047 refuses unexpected writer schema CREATE privilege';
  END IF;
  IF pg_catalog.to_regprocedure('dialektik_ops.govuk_rsh_metadata_recovery_status()') IS NOT NULL THEN
    RAISE EXCEPTION 'ATTACK047 status function already exists; inspect before migration';
  END IF;
END;
$preflight$;

-- The writer already has the exact read columns and row-scoped RLS from 041-043.
-- No table grants, RLS changes, secrets, or persistent role memberships are added.
GRANT dialektik_govuk_metadata_writer TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
-- CREATE is granted only inside the migration transaction so the fixed
-- SECURITY DEFINER function can be owned by the restricted writer role.
-- The privilege is revoked again before the migration transaction commits.
GRANT CREATE ON SCHEMA dialektik_ops TO dialektik_govuk_metadata_writer;
SET LOCAL ROLE dialektik_govuk_metadata_writer;

CREATE FUNCTION dialektik_ops.govuk_rsh_metadata_recovery_status()
RETURNS text
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = on
SET statement_timeout = '5s'
AS $status$
DECLARE
  v_source_count bigint;
  v_guard_count bigint;
  v_policy_count bigint;
  v_exclusion_count bigint;
  v_receipt_count bigint;
  v_article_count bigint;
  v_version_count bigint;
  v_total bigint;
  v_other_invoker_sessions bigint;
  v_direct_write_relations bigint;
  v_direct_read_relations bigint;
  v_other_definer_functions bigint;
  v_writer_oid oid;
  v_invoker_oid oid;
  v_writer_function oid;
  v_status_function oid;
  v_recovery_lock_held boolean;
  v_expected_hash text;
  v_metadata_json text;
  v_exact_match boolean;
  v_policy CONSTANT jsonb := '{
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
  }'::jsonb;
BEGIN
  -- No parameters: this endpoint can address only the single operation fixed by 043.
  IF session_user <> 'dialektik_govuk_rsh_invoker'
     OR current_user <> 'dialektik_govuk_metadata_writer' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ATTACK047_CALLER_DENIED';
  END IF;

  -- The caller must acquire the same transaction advisory lock in an earlier
  -- statement on this connection. The STABLE routine performs only reads.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks AS lock
    WHERE lock.locktype = 'advisory'
      AND lock.database = (
        SELECT database.oid FROM pg_catalog.pg_database AS database
        WHERE database.datname = pg_catalog.current_database()
      )
      AND lock.classid = 20261018::oid
      AND lock.objid = 86::oid
      AND lock.objsubid = 2
      AND lock.pid = pg_catalog.pg_backend_pid()
      AND lock.granted
  ) INTO v_recovery_lock_held;
  IF NOT v_recovery_lock_held THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;
  IF NOT pg_catalog.row_security_active('public.sources'::pg_catalog.regclass)
     OR NOT pg_catalog.row_security_active('public.prospective_content_rights_write_guards'::pg_catalog.regclass)
     OR NOT pg_catalog.row_security_active('public.live_source_policies'::pg_catalog.regclass)
     OR NOT pg_catalog.row_security_active('public.live_exposure_exclusions'::pg_catalog.regclass)
     OR NOT pg_catalog.row_security_active('public.live_acquisition_receipts'::pg_catalog.regclass)
     OR NOT pg_catalog.row_security_active('public.articles'::pg_catalog.regclass)
     OR NOT pg_catalog.row_security_active('public.live_article_versions'::pg_catalog.regclass) THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;

  -- Any other same-role session is conservatively unknown. The caller holds the
  -- shared lock, so new writer attempts cannot enter the critical section until
  -- this read-only status transaction ends.
  SELECT pg_catalog.count(*) INTO v_other_invoker_sessions
  FROM pg_catalog.pg_stat_activity
  WHERE datname = pg_catalog.current_database()
    AND usename = session_user
    AND pid <> pg_catalog.pg_backend_pid();
  IF v_other_invoker_sessions <> 0 THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;

  -- Recheck the identity's non-escalation contract before emitting a conclusive
  -- answer. Fail closed if role attributes, memberships, or grants drifted.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = session_user AND rolcanlogin AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND NOT rolbypassrls AND NOT rolinherit AND rolconnlimit = 2
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = session_user::pg_catalog.regrole
       OR roleid = session_user::pg_catalog.regrole
  ) THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;

  SELECT oid INTO v_writer_oid FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_metadata_writer';
  SELECT oid INTO v_invoker_oid FROM pg_catalog.pg_roles
  WHERE rolname = session_user;
  v_writer_function := 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)'::pg_catalog.regprocedure;
  v_status_function := 'dialektik_ops.govuk_rsh_metadata_recovery_status()'::pg_catalog.regprocedure;
  IF v_writer_oid IS NULL OR v_invoker_oid IS NULL
     OR current_user::pg_catalog.regrole <> v_writer_oid
     OR NOT pg_catalog.has_schema_privilege(session_user, 'dialektik_ops', 'USAGE')
     OR pg_catalog.has_schema_privilege(session_user, 'dialektik_ops', 'CREATE')
     OR pg_catalog.has_schema_privilege(session_user, 'public', 'CREATE') THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;

  -- Reject ACL drift: only the writer owner and this fixed invoker may have
  -- explicit EXECUTE on either function. This also rejects PUBLIC grants.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.oid IN (v_writer_function, v_status_function)
      AND privilege.privilege_type = 'EXECUTE'
      AND (privilege.grantee NOT IN (v_writer_oid, v_invoker_oid)
        OR (privilege.grantee = v_invoker_oid AND privilege.is_grantable))
  ) THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;

  SELECT pg_catalog.count(*)::bigint INTO v_direct_write_relations
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r','p','v','m','f')
    AND pg_catalog.has_table_privilege(
      session_user, relation.oid,
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR (namespace.nspname = 'public'
      AND relation.relkind IN ('r','p','v','m','f')
      AND (pg_catalog.has_any_column_privilege(session_user, relation.oid, 'INSERT')
        OR pg_catalog.has_any_column_privilege(session_user, relation.oid, 'UPDATE')));
  SELECT pg_catalog.count(*)::bigint INTO v_direct_read_relations
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r','p','v','m','f')
    AND (pg_catalog.has_table_privilege(session_user, relation.oid, 'SELECT')
      OR pg_catalog.has_any_column_privilege(session_user, relation.oid, 'SELECT'));
  SELECT pg_catalog.count(*)::bigint INTO v_other_definer_functions
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
  WHERE routine.prosecdef
    AND namespace.nspname NOT IN ('pg_catalog','information_schema')
    AND routine.oid NOT IN (
      'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)'::pg_catalog.regprocedure,
      'dialektik_ops.govuk_rsh_metadata_recovery_status()'::pg_catalog.regprocedure
    )
    AND pg_catalog.has_function_privilege(session_user, routine.oid, 'EXECUTE');
  IF v_direct_read_relations <> 0 OR v_direct_write_relations <> 0
     OR v_other_definer_functions <> 0 THEN
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;

  v_metadata_json := '{"sourceItemId":"86f4abba-9eaa-412f-b048-5ed30aa74201"' ||
    ',"canonicalUrl":"https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh"' ||
    ',"title":"Social housing landlord downgraded by RSH"' ||
    ',"publisher":"Regulator of Social Housing"' ||
    ',"publishedAt":"2026-10-07T08:30:03.000Z"' ||
    ',"modifiedAt":"2026-10-07T08:30:03.000Z"' ||
    ',"locale":"en"' ||
    ',"rightsEvidenceUrl":"https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"' ||
    ',"rightsVerifiedAt":"2026-10-15T00:00:00.000Z"' ||
    ',"attribution":"© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0."' ||
    ',"discoveryChannel":"official_api"' ||
    ',"discoveryUrl":"https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh"}';
  v_expected_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_metadata_json, 'UTF8')),
    'hex'
  );

  -- These seven scoped counts represent the nine rows written atomically by 043.
  SELECT
    (SELECT count(*) FROM public.sources
      WHERE id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid),
    (SELECT count(*) FROM public.prospective_content_rights_write_guards
      WHERE source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid),
    (SELECT count(*) FROM public.live_source_policies
      WHERE source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
        AND registry_key = 'product-govuk-rsh-content-api-v1'),
    (SELECT count(*) FROM public.live_exposure_exclusions
      WHERE registry_key = 'product-govuk-rsh-content-api-v1'
        AND source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'),
    (SELECT count(*) FROM public.live_acquisition_receipts
      WHERE source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
        AND source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'),
    (SELECT count(*) FROM public.articles
      WHERE source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
        AND url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'),
    (SELECT count(*) FROM public.live_article_versions AS version
      JOIN public.articles AS article ON article.id = version.article_id
      WHERE article.source_id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
        AND article.url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh')
  INTO v_source_count, v_guard_count, v_policy_count, v_exclusion_count,
       v_receipt_count, v_article_count, v_version_count;
  v_total := v_source_count + v_guard_count + v_policy_count + v_exclusion_count
    + v_receipt_count + v_article_count + v_version_count;

  IF v_total = 0 THEN
    -- Absence is not enough. 043 atomically revokes this grant in the same
    -- transaction as the rows; with the shared lock, no competing session, and
    -- grant still effective, a prior commit is excluded at this linearization.
    IF pg_catalog.has_function_privilege(
      session_user,
      'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)'::pg_catalog.regprocedure,
      'EXECUTE'
    ) THEN
      RETURN 'NOT_COMMITTED';
    END IF;
    RETURN 'PENDING_OR_UNKNOWN';
  END IF;

  IF v_source_count <> 1 OR v_guard_count <> 1 OR v_policy_count <> 1
     OR v_exclusion_count <> 3 OR v_receipt_count <> 1
     OR v_article_count <> 1 OR v_version_count <> 1 THEN
    RETURN 'CONFLICT';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.sources AS source
    JOIN public.prospective_content_rights_write_guards AS guard
      ON guard.source_id = source.id
    JOIN public.live_source_policies AS policy
      ON policy.source_id = source.id
    JOIN public.live_acquisition_receipts AS receipt
      ON receipt.source_id = source.id AND receipt.policy_id = policy.id
    JOIN public.articles AS article
      ON article.source_id = source.id
    JOIN public.live_article_versions AS version
      ON version.article_id = article.id AND version.receipt_id = receipt.id
    WHERE source.id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
      AND source.name = 'Regulator of Social Housing'
      AND source.source_type = 'other'::public.source_type
      AND source.is_issuing_entity IS FALSE
      AND source.canonical_domain = 'gov.uk'
      AND source.origin = 'LIVE_REAL'
      AND source.created_at = receipt.seen_at
      AND policy.id = 'deeda2068a90c9a04e1cd0ab3942c95570892b4c6325063c421ecd7eb2c78593'
      AND policy.registry_key = 'product-govuk-rsh-content-api-v1'
      AND policy.rights_class = 'LIVE_READY'
      AND policy.storage_policy = 'METADATA_ONLY'
      AND policy.active IS TRUE
      AND policy.rights_evidence_url = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
      AND policy.rights_verified_at = '2026-10-15T00:00:00.000Z'::timestamptz
      AND policy.policy = v_policy
      AND policy.recorded_at = receipt.seen_at
      AND receipt.id = '01M4YDQK00WS344WW8RCPCEQHG'::public.dialektik_ulid
      AND receipt.exclusion_id = '547f13bf76fb1218a0b348b2fc15140a07982cd2b46ccfd463c4dd39f4ef33e0'
      AND receipt.source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
      AND receipt.discovery_channel = 'official_api'
      AND receipt.discovery_url = 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh'
      AND receipt.discovered_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
      AND receipt.canonical_url = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
      AND receipt.raw_payload_hash = v_expected_hash
      AND receipt.adapter_version = 'govuk-rsh-content-api-metadata-v1'
      AND receipt.disposition = 'PERSISTED' AND receipt.error_code IS NULL
      AND receipt.published_at = '2026-10-07T08:30:03.000Z'::timestamptz
      AND receipt.modified_at = '2026-10-07T08:30:03.000Z'::timestamptz
      AND receipt.original_published_at = '2026-10-07T08:30:03.000Z'
      AND receipt.original_modified_at = '2026-10-07T08:30:03.000Z'
      AND article.id = '01M4YDQK00WS344WW8RCPCEQHF'::public.dialektik_ulid
      AND article.event_id IS NULL
      AND article.url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
      AND article.text_original = 'Social housing landlord downgraded by RSH'
      AND article.text_normalized = 'Social housing landlord downgraded by RSH'
      AND article.lang = 'en' AND article.origin = 'LIVE_REAL'
      AND article.live_exposure_id = receipt.exclusion_id
      AND article.published_at = receipt.published_at
      AND article.captured_at = receipt.seen_at
      AND article.updated_at_source = receipt.modified_at
      AND version.id = '01M4YDQK00WS344WW8RCPCEQHH'::public.dialektik_ulid
      AND version.version_number = 1
      AND version.metadata_hash = v_expected_hash
      AND version.headline = 'Social housing landlord downgraded by RSH'
      AND version.published_at = receipt.published_at
      AND version.modified_at = receipt.modified_at
      AND version.content_hash = 'ebf7b99cd8e0ea0d0b55abd025cb98c37df6e1d756bdad549f4a73035e74bfea'
      AND version.near_duplicate_signature = 'metadata-token-set-v1:f2d5503fcda8e890ea9610dcbcf789596dd3e2bee22580dac6ebbd41b7ccca4c'
      AND version.recorded_at = receipt.seen_at
      AND version.excerpt IS NULL AND version.author IS NULL
      AND version.declared_upstream IS NULL
      AND EXISTS (
        SELECT 1 FROM public.live_exposure_exclusions AS exclusion
        WHERE exclusion.id = '547f13bf76fb1218a0b348b2fc15140a07982cd2b46ccfd463c4dd39f4ef33e0'
          AND exclusion.registry_key = 'product-govuk-rsh-content-api-v1'
          AND exclusion.publisher_name = 'Regulator of Social Housing'
          AND exclusion.canonical_url = receipt.canonical_url
          AND exclusion.source_item_id = receipt.source_item_id
          AND exclusion.discovery_url = receipt.discovery_url
          AND exclusion.reason = 'govuk_rsh_metadata_acquisition'
          AND exclusion.content_hash IS NULL AND exclusion.near_duplicate_signature IS NULL
          AND exclusion.published_at = receipt.published_at
          AND exclusion.first_seen_at = receipt.seen_at
      )
      AND EXISTS (
        SELECT 1 FROM public.live_exposure_exclusions AS exclusion
        WHERE exclusion.id = '6ca9ea4138522956e52051bb22731c3bce484c8fef1d3e077dc9d02b2efcdf3b'
          AND exclusion.registry_key = 'product-govuk-rsh-content-api-v1'
          AND exclusion.publisher_name = 'Regulator of Social Housing'
          AND exclusion.canonical_url = receipt.canonical_url
          AND exclusion.source_item_id = receipt.source_item_id
          AND exclusion.discovery_url = receipt.discovery_url
          AND exclusion.reason = 'govuk_rsh_metadata_title_hash'
          AND exclusion.content_hash = 'ebf7b99cd8e0ea0d0b55abd025cb98c37df6e1d756bdad549f4a73035e74bfea'
          AND exclusion.near_duplicate_signature = 'metadata-token-set-v1:f2d5503fcda8e890ea9610dcbcf789596dd3e2bee22580dac6ebbd41b7ccca4c'
          AND exclusion.published_at = receipt.published_at
          AND exclusion.first_seen_at = receipt.seen_at
      )
      AND EXISTS (
        SELECT 1 FROM public.live_exposure_exclusions AS exclusion
        WHERE exclusion.id = '76beba3875e24e91b5def45c673462a675df9589887d9d7fdcdcf16cfc7686bf'
          AND exclusion.registry_key = 'product-govuk-rsh-content-api-v1'
          AND exclusion.publisher_name = 'Regulator of Social Housing'
          AND exclusion.canonical_url IS NULL
          AND exclusion.source_item_id = receipt.source_item_id
          AND exclusion.discovery_url = receipt.discovery_url
          AND exclusion.reason = 'govuk_rsh_metadata_source_identity'
          AND exclusion.content_hash IS NULL AND exclusion.near_duplicate_signature IS NULL
          AND exclusion.published_at = receipt.published_at
          AND exclusion.first_seen_at = receipt.seen_at
      )
  ) INTO v_exact_match;

  IF v_exact_match THEN
    RETURN 'COMMITTED_MATCH';
  END IF;
  RETURN 'CONFLICT';
END;
$status$;

REVOKE ALL ON FUNCTION dialektik_ops.govuk_rsh_metadata_recovery_status()
  FROM PUBLIC, anon, authenticated, dialektik_core_app, postgres;
GRANT EXECUTE ON FUNCTION dialektik_ops.govuk_rsh_metadata_recovery_status()
  TO dialektik_govuk_rsh_invoker;

RESET ROLE;
REVOKE CREATE ON SCHEMA dialektik_ops FROM dialektik_govuk_metadata_writer;
REVOKE dialektik_govuk_metadata_writer FROM postgres;
`;

const DOWN = String.raw`
DO $preflight$
DECLARE
  v_writer oid;
BEGIN
  IF current_user <> 'postgres'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = current_user AND (rolsuper OR rolcreaterole)
     ) THEN
    RAISE EXCEPTION 'ATTACK047 rollback requires the reviewed postgres migration principal';
  END IF;
  SELECT oid INTO v_writer FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_metadata_writer' AND NOT rolcanlogin
    AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls;
  IF v_writer IS NULL
     OR pg_catalog.to_regprocedure('dialektik_ops.govuk_rsh_metadata_recovery_status()') IS NULL
     OR (SELECT proowner FROM pg_catalog.pg_proc
         WHERE oid = 'dialektik_ops.govuk_rsh_metadata_recovery_status()'::pg_catalog.regprocedure) <> v_writer
     OR (SELECT prosecdef FROM pg_catalog.pg_proc
         WHERE oid = 'dialektik_ops.govuk_rsh_metadata_recovery_status()'::pg_catalog.regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATTACK047 rollback refuses unexpected function identity';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = v_writer
      AND NOT (
        member = current_user::pg_catalog.regrole
        AND grantor <> current_user::pg_catalog.regrole
        AND admin_option AND NOT inherit_option AND NOT set_option
      )
  ) THEN
    RAISE EXCEPTION 'ATTACK047 rollback found an unexpected writer membership';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = v_writer AND member = current_user::pg_catalog.regrole
      AND grantor <> current_user::pg_catalog.regrole
      AND admin_option AND NOT inherit_option AND NOT set_option
  ) THEN
    RAISE EXCEPTION 'ATTACK047 rollback principal lacks ADMIN OPTION on the exact writer role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity
    WHERE usename = 'dialektik_govuk_rsh_invoker'
      AND pid <> pg_catalog.pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'ATTACK047 rollback requires zero invoker sessions';
  END IF;
END;
$preflight$;

GRANT dialektik_govuk_metadata_writer TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
SET LOCAL ROLE dialektik_govuk_metadata_writer;
REVOKE ALL ON FUNCTION dialektik_ops.govuk_rsh_metadata_recovery_status()
  FROM PUBLIC, anon, authenticated, dialektik_core_app, dialektik_govuk_rsh_invoker;
DROP FUNCTION dialektik_ops.govuk_rsh_metadata_recovery_status();
RESET ROLE;
REVOKE dialektik_govuk_metadata_writer FROM postgres;
`;

/** Inert SQL payloads exported for the separately authorized Supabase MCP path. */
export const govUkRshReceiptRecoveryUpSql = UP;
export const govUkRshReceiptRecoveryDownSql = DOWN;

export const govUkRshReceiptRecoveryMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(database: Kysely<Database>): Promise<void> {
    await sql.raw(DOWN).execute(database);
  },
};
