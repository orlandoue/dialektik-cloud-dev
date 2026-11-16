import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const UP = String.raw`
DO $preflight$
DECLARE
  writer_oid oid;
  rights_guard_function_oid oid;
  scoped_writer_policy_count integer;
  core_read_policy_count integer;
  rls_table_count integer;
  rights_guard_trigger_count integer;
  rights_guard_source text;
  receipt_validator_oid oid;
  receipt_validator_source text;
  article_validator_oid oid;
  article_validator_source text;
  version_validator_oid oid;
  version_validator_source text;
  receipt_validator_trigger_count integer;
  article_validator_trigger_count integer;
  version_validator_trigger_count integer;
BEGIN
  IF current_user <> 'postgres'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = current_user AND rolcreaterole
     )
     OR NOT pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'GOV.UK one-shot migration requires the managed postgres role with CREATEROLE and target-database CREATE';
  END IF;

  SELECT oid INTO writer_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_metadata_writer'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit;
  IF writer_oid IS NULL THEN
    RAISE EXCEPTION 'GOV.UK metadata writer must exist with NOLOGIN and restricted attributes';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'dialektik_govuk_rsh_invoker'
  ) THEN
    RAISE EXCEPTION 'dialektik_govuk_rsh_invoker already exists; inspect it before migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = writer_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = writer_oid
      AND NOT (
        member = current_user::regrole
        AND grantor <> current_user::regrole
        AND admin_option
        AND NOT inherit_option
        AND NOT set_option
      )
  ) THEN
    RAISE EXCEPTION 'GOV.UK writer has an unexpected membership; only the restricted PostgreSQL 17 creator-admin grant is accepted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND rolsuper
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = writer_oid
      AND member = current_user::regrole
      AND admin_option
  ) THEN
    RAISE EXCEPTION 'GOV.UK migration requires PostgreSQL 17 ADMIN OPTION on the exact writer role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon','authenticated','dialektik_core_app')
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'GOV.UK one-shot migration requires the expected client and Core roles';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'dialektik_ops') THEN
    RAISE EXCEPTION 'dialektik_ops already exists; inspect before creating the one-shot function';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity
    WHERE usename = 'dialektik_govuk_metadata_writer'
      AND pid <> pg_catalog.pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'GOV.UK metadata writer has an active session';
  END IF;

  SELECT count(*)::integer INTO rls_table_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = ANY (ARRAY[
      'sources','articles','live_source_policies','live_exposure_exclusions',
      'live_acquisition_receipts','live_article_versions',
      'prospective_content_rights_write_guards'
    ])
    AND relation.relrowsecurity;
  IF rls_table_count <> 7 THEN
    RAISE EXCEPTION 'GOV.UK one-shot migration requires RLS on all seven bounded tables';
  END IF;

  SELECT oid, prosrc INTO rights_guard_function_oid, rights_guard_source
  FROM pg_catalog.pg_proc
  WHERE proname = 'dialektik_seed_prospective_rights_guard'
    AND pronamespace = 'public'::pg_catalog.regnamespace
    AND prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND proowner = current_user::pg_catalog.regrole
    AND NOT prosecdef
    AND proconfig IS NULL;
  IF rights_guard_function_oid IS NULL OR btrim(pg_catalog.regexp_replace(
       rights_guard_source, '[[:space:]]+', ' ', 'g'
     )) <> 'begin insert into prospective_content_rights_write_guards(source_id) values (new.id) on conflict (source_id) do nothing; return new; end;' THEN
    RAISE EXCEPTION 'GOV.UK one-shot requires the reviewed invoker rights-guard trigger body';
  END IF;
  SELECT count(*)::integer INTO rights_guard_trigger_count
  FROM pg_catalog.pg_trigger
  WHERE tgfoid = rights_guard_function_oid
    AND NOT tgisinternal
    AND tgrelid = 'public.sources'::pg_catalog.regclass
    AND tgname = ANY (ARRAY[
      'sources_seed_prospective_rights_guard_after_insert',
      'sources_seed_prospective_rights_guard_after_id_update'
    ]);
  IF rights_guard_trigger_count <> 2 THEN
    RAISE EXCEPTION 'GOV.UK one-shot requires both reviewed prospective-rights source triggers';
  END IF;

  SELECT oid, prosrc INTO receipt_validator_oid, receipt_validator_source
  FROM pg_catalog.pg_proc
  WHERE proname = 'dialektik_validate_live_receipt'
    AND pronamespace = 'public'::pg_catalog.regnamespace
    AND prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND proowner = current_user::pg_catalog.regrole
    AND NOT prosecdef AND proconfig IS NULL;
  SELECT oid, prosrc INTO article_validator_oid, article_validator_source
  FROM pg_catalog.pg_proc
  WHERE proname = 'dialektik_validate_live_article'
    AND pronamespace = 'public'::pg_catalog.regnamespace
    AND prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND proowner = current_user::pg_catalog.regrole
    AND NOT prosecdef AND proconfig IS NULL;
  SELECT oid, prosrc INTO version_validator_oid, version_validator_source
  FROM pg_catalog.pg_proc
  WHERE proname = 'dialektik_validate_live_version'
    AND pronamespace = 'public'::pg_catalog.regnamespace
    AND prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND proowner = current_user::pg_catalog.regrole
    AND NOT prosecdef AND proconfig IS NULL;
  IF receipt_validator_oid IS NULL OR lower(btrim(pg_catalog.regexp_replace(
       receipt_validator_source, '[[:space:]]+', ' ', 'g'
     ))) <> 'begin if not exists ( select 1 from live_source_policies p join live_exposure_exclusions e on e.id = new.exclusion_id join sources s on s.id = p.source_id where p.id = new.policy_id and p.source_id = new.source_id and s.origin = ''live_real'' and e.registry_key = p.registry_key and p.active and p.rights_class = ''live_ready'' ) then raise exception using errcode = ''23514'', message = ''live receipt requires matching source policy and permanent exclusion''; end if; return new; end;'
     OR article_validator_oid IS NULL OR lower(btrim(pg_catalog.regexp_replace(
       article_validator_source, '[[:space:]]+', ' ', 'g'
     ))) <> 'begin if tg_op = ''update'' and old.origin = ''live_real'' and ( new.origin is distinct from old.origin or new.live_exposure_id is distinct from old.live_exposure_id or new.source_id is distinct from old.source_id or new.url_canonical is distinct from old.url_canonical ) then raise exception using errcode = ''23514'', message = ''live article identity and exclusion are permanent''; end if; if new.origin = ''live_real'' and not exists ( select 1 from sources s join live_source_policies p on p.source_id = s.id join live_exposure_exclusions e on e.id = new.live_exposure_id where s.id = new.source_id and s.origin = ''live_real'' and p.active and p.rights_class = ''live_ready'' and p.registry_key = e.registry_key and e.canonical_url = new.url_canonical ) then raise exception using errcode = ''23514'', message = ''live article requires permitted source and matching exclusion''; end if; return new; end;'
     OR version_validator_oid IS NULL OR lower(btrim(pg_catalog.regexp_replace(
       version_validator_source, '[[:space:]]+', ' ', 'g'
     ))) <> 'begin if not exists ( select 1 from articles a join live_acquisition_receipts r on r.id = new.receipt_id join live_source_policies p on p.id = r.policy_id where a.id = new.article_id and a.origin = ''live_real'' and a.source_id = r.source_id and a.live_exposure_id = r.exclusion_id and r.disposition = ''persisted'' and p.active and p.rights_class = ''live_ready'' and (new.excerpt is null or p.storage_policy = ''metadata_and_feed_excerpt'') and exists (select 1 from live_exposure_exclusions e where e.registry_key = p.registry_key and e.canonical_url = r.canonical_url and e.content_hash = new.content_hash and e.near_duplicate_signature = new.near_duplicate_signature) ) then raise exception using errcode = ''23514'', message = ''live version requires linked permitted acquisition receipt''; end if; return new; end;' THEN
    RAISE EXCEPTION 'GOV.UK one-shot requires the reviewed invoker live receipt/article/version validator bodies';
  END IF;
  SELECT count(*)::integer INTO receipt_validator_trigger_count
  FROM pg_catalog.pg_trigger
  WHERE tgfoid = receipt_validator_oid AND NOT tgisinternal
    AND tgrelid = 'public.live_acquisition_receipts'::pg_catalog.regclass
    AND tgname = 'live_receipts_validate';
  SELECT count(*)::integer INTO article_validator_trigger_count
  FROM pg_catalog.pg_trigger
  WHERE tgfoid = article_validator_oid AND NOT tgisinternal
    AND tgrelid = 'public.articles'::pg_catalog.regclass
    AND tgname = 'articles_validate_live';
  SELECT count(*)::integer INTO version_validator_trigger_count
  FROM pg_catalog.pg_trigger
  WHERE tgfoid = version_validator_oid AND NOT tgisinternal
    AND tgrelid = 'public.live_article_versions'::pg_catalog.regclass
    AND tgname = 'live_versions_validate';
  IF receipt_validator_trigger_count <> 1 OR article_validator_trigger_count <> 1
     OR version_validator_trigger_count <> 1 THEN
    RAISE EXCEPTION 'GOV.UK one-shot requires the reviewed receipt/article/version validator triggers';
  END IF;

  SELECT count(*)::integer INTO scoped_writer_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'sources','articles','live_source_policies','live_exposure_exclusions',
      'live_acquisition_receipts','live_article_versions',
      'prospective_content_rights_write_guards'
    ])
    AND 'dialektik_govuk_metadata_writer' = ANY (roles);
  SELECT count(*)::integer INTO core_read_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'sources','articles','live_source_policies','live_exposure_exclusions',
      'live_acquisition_receipts','live_article_versions',
      'prospective_content_rights_write_guards'
    ])
    AND roles = ARRAY['dialektik_core_app']::name[]
    AND cmd = 'SELECT';
  IF scoped_writer_policy_count <> 14 OR core_read_policy_count <> 7 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'sources','articles','live_source_policies','live_exposure_exclusions',
        'live_acquisition_receipts','live_article_versions',
        'prospective_content_rights_write_guards'
      ])
      AND roles && ARRAY['public','anon','authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'GOV.UK writer/Core RLS policies differ from the reviewed 042 boundary';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sources
    WHERE id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
  ) OR EXISTS (
    SELECT 1 FROM public.articles
    WHERE url_canonical = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh'
  ) OR EXISTS (
    SELECT 1 FROM public.live_acquisition_receipts
    WHERE source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
  ) OR EXISTS (
    SELECT 1 FROM public.articles
    WHERE id IN ('01M4YDQK00WS344WW8RCPCEQHF'::public.dialektik_ulid)
  ) OR EXISTS (
    SELECT 1 FROM public.live_acquisition_receipts
    WHERE id = '01M4YDQK00WS344WW8RCPCEQHG'::public.dialektik_ulid
  ) OR EXISTS (
    SELECT 1 FROM public.live_article_versions
    WHERE id = '01M4YDQK00WS344WW8RCPCEQHH'::public.dialektik_ulid
  ) THEN
    RAISE EXCEPTION 'GOV.UK target already has records; inspect before installing the one-shot function';
  END IF;
END;
$preflight$;

-- Keep the invoker trigger functional under this SECURITY DEFINER function's closed search_path.
CREATE OR REPLACE FUNCTION public.dialektik_seed_prospective_rights_guard()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO public.prospective_content_rights_write_guards(source_id)
  VALUES (NEW.id)
  ON CONFLICT (source_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- The SECURITY DEFINER writer has a closed search_path. Preserve these invoker
-- validators while making every relation lookup independent of caller search_path.
CREATE OR REPLACE FUNCTION public.dialektik_validate_live_receipt() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.live_source_policies AS policy
    JOIN public.live_exposure_exclusions AS exclusion ON exclusion.id = NEW.exclusion_id
    JOIN public.sources AS source ON source.id = policy.source_id
    WHERE policy.id = NEW.policy_id AND policy.source_id = NEW.source_id
      AND source.origin = 'LIVE_REAL'
      AND exclusion.registry_key = policy.registry_key
      AND policy.active AND policy.rights_class = 'LIVE_READY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'live receipt requires matching source policy and permanent exclusion';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialektik_validate_live_article() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.origin = 'LIVE_REAL' AND (
    NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.live_exposure_id IS DISTINCT FROM OLD.live_exposure_id
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.url_canonical IS DISTINCT FROM OLD.url_canonical
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'live article identity and exclusion are permanent';
  END IF;
  IF NEW.origin = 'LIVE_REAL' AND NOT EXISTS (
    SELECT 1 FROM public.sources AS source
    JOIN public.live_source_policies AS policy ON policy.source_id = source.id
    JOIN public.live_exposure_exclusions AS exclusion ON exclusion.id = NEW.live_exposure_id
    WHERE source.id = NEW.source_id AND source.origin = 'LIVE_REAL'
      AND policy.active AND policy.rights_class = 'LIVE_READY'
      AND policy.registry_key = exclusion.registry_key
      AND exclusion.canonical_url = NEW.url_canonical
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'live article requires permitted source and matching exclusion';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialektik_validate_live_version() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.articles AS article
    JOIN public.live_acquisition_receipts AS receipt ON receipt.id = NEW.receipt_id
    JOIN public.live_source_policies AS policy ON policy.id = receipt.policy_id
    WHERE article.id = NEW.article_id AND article.origin = 'LIVE_REAL'
      AND article.source_id = receipt.source_id
      AND article.live_exposure_id = receipt.exclusion_id
      AND receipt.disposition = 'PERSISTED'
      AND policy.active AND policy.rights_class = 'LIVE_READY'
      AND (NEW.excerpt IS NULL OR policy.storage_policy = 'METADATA_AND_FEED_EXCERPT')
      AND EXISTS (
        SELECT 1 FROM public.live_exposure_exclusions AS exclusion
        WHERE exclusion.registry_key = policy.registry_key
          AND exclusion.canonical_url = receipt.canonical_url
          AND exclusion.content_hash = NEW.content_hash
          AND exclusion.near_duplicate_signature = NEW.near_duplicate_signature
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'live version requires linked permitted acquisition receipt';
  END IF;
  RETURN NEW;
END;
$function$;

DO $invoker_role$
BEGIN
  EXECUTE 'CREATE ROLE dialektik_govuk_rsh_invoker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2';
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO dialektik_govuk_rsh_invoker', pg_catalog.current_database());
END;
$invoker_role$;

CREATE SCHEMA dialektik_ops AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA dialektik_ops FROM PUBLIC, anon, authenticated,
  dialektik_core_app, dialektik_govuk_metadata_writer;
GRANT USAGE, CREATE ON SCHEMA dialektik_ops TO dialektik_govuk_metadata_writer;
GRANT USAGE ON SCHEMA dialektik_ops TO dialektik_govuk_rsh_invoker;
-- Narrow extra reads used only to prove exact persisted metadata on a retry.
GRANT SELECT (created_at) ON TABLE public.sources
  TO dialektik_govuk_metadata_writer;
GRANT SELECT (discovery_channel, discovery_url, discovered_url, published_at,
  modified_at, original_published_at, original_modified_at, seen_at, error_code)
  ON TABLE public.live_acquisition_receipts TO dialektik_govuk_metadata_writer;
GRANT SELECT (text_original, text_normalized, lang, published_at, updated_at_source)
  ON TABLE public.articles TO dialektik_govuk_metadata_writer;
GRANT SELECT (id, receipt_id, headline, published_at, modified_at, content_hash,
  near_duplicate_signature, recorded_at, excerpt, author, declared_upstream)
  ON TABLE public.live_article_versions TO dialektik_govuk_metadata_writer;
GRANT dialektik_govuk_metadata_writer TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

SET LOCAL ROLE dialektik_govuk_metadata_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA dialektik_ops
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(p_metadata jsonb)
RETURNS TABLE (
  result_state text,
  result_source_id text,
  result_article_id text,
  result_receipt_id text,
  result_canonical_url text,
  result_source_item_id text,
  result_metadata_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = on
AS $function$
DECLARE
  v_keys text[];
  v_article_id public.dialektik_ulid;
  v_receipt_id public.dialektik_ulid;
  v_version_id public.dialektik_ulid;
  v_published_text text;
  v_modified_text text;
  v_acquired_text text;
  v_metadata_hash text;
  v_published_at timestamptz(3);
  v_modified_at timestamptz(3);
  v_acquired_at timestamptz(3);
  v_metadata_json text;
  v_expected_metadata_hash text;
  v_source_count integer;
  v_guard_count integer;
  v_policy_count integer;
  v_exclusion_count integer;
  v_receipt_count integer;
  v_article_count integer;
  v_version_count integer;
  v_total integer;
  v_current_writer record;
  v_current_invoker record;
  v_other_definer_count integer;
  v_direct_write_relation_count integer;
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
  v_source_id CONSTANT public.dialektik_ulid := '01M4YDQK00WS344WW8RCPCEQHE';
  v_target_article_id CONSTANT public.dialektik_ulid := '01M4YDQK00WS344WW8RCPCEQHF';
  v_target_receipt_id CONSTANT public.dialektik_ulid := '01M4YDQK00WS344WW8RCPCEQHG';
  v_target_version_id CONSTANT public.dialektik_ulid := '01M4YDQK00WS344WW8RCPCEQHH';
  v_source_item_id CONSTANT text := '86f4abba-9eaa-412f-b048-5ed30aa74201';
  v_registry_key CONSTANT text := 'product-govuk-rsh-content-api-v1';
  v_publisher CONSTANT text := 'Regulator of Social Housing';
  v_title CONSTANT text := 'Social housing landlord downgraded by RSH';
  v_canonical_url CONSTANT text := 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh';
  v_discovery_url CONSTANT text := 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh';
  v_rights_url CONSTANT text := 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
  v_rights_reviewed_at CONSTANT timestamptz(3) := '2026-10-15T00:00:00.000Z';
  v_policy_id CONSTANT text := 'deeda2068a90c9a04e1cd0ab3942c95570892b4c6325063c421ecd7eb2c78593';
  v_canonical_exclusion_id CONSTANT text := '547f13bf76fb1218a0b348b2fc15140a07982cd2b46ccfd463c4dd39f4ef33e0';
  v_title_exclusion_id CONSTANT text := '6ca9ea4138522956e52051bb22731c3bce484c8fef1d3e077dc9d02b2efcdf3b';
  v_identity_exclusion_id CONSTANT text := '76beba3875e24e91b5def45c673462a675df9589887d9d7fdcdcf16cfc7686bf';
  v_content_hash CONSTANT text := 'ebf7b99cd8e0ea0d0b55abd025cb98c37df6e1d756bdad549f4a73035e74bfea';
  v_near_duplicate_signature CONSTANT text := 'metadata-token-set-v1:f2d5503fcda8e890ea9610dcbcf789596dd3e2bee22580dac6ebbd41b7ccca4c';
BEGIN
  IF session_user <> 'dialektik_govuk_rsh_invoker'
     OR current_user <> 'dialektik_govuk_metadata_writer' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GOVUK_RSH_CALLER_DENIED';
  END IF;

  -- Serializes simultaneous calls. All writes and EXECUTE consumption commit or roll back together.
  PERFORM pg_catalog.pg_advisory_xact_lock(20261018, 86);

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS privilege
    WHERE function.oid = 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)'::pg_catalog.regprocedure
      AND privilege.grantee = session_user::pg_catalog.regrole
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GOVUK_RSH_ONE_SHOT_AUTHORIZATION_REQUIRED';
  END IF;

  SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication,
         rolbypassrls, rolinherit, rolconnlimit
    INTO v_current_invoker
  FROM pg_catalog.pg_roles
  WHERE rolname = session_user;
  IF NOT FOUND OR NOT v_current_invoker.rolcanlogin OR v_current_invoker.rolsuper
     OR v_current_invoker.rolcreatedb OR v_current_invoker.rolcreaterole
     OR v_current_invoker.rolreplication OR v_current_invoker.rolbypassrls
     OR v_current_invoker.rolinherit OR v_current_invoker.rolconnlimit <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GOVUK_RSH_INVOKER_ROLE_NOT_RESTRICTED';
  END IF;

  SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication,
         rolbypassrls, rolinherit
    INTO v_current_writer
  FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_metadata_writer';
  IF NOT FOUND OR v_current_writer.rolcanlogin OR v_current_writer.rolsuper
     OR v_current_writer.rolcreatedb OR v_current_writer.rolcreaterole
     OR v_current_writer.rolreplication OR v_current_writer.rolbypassrls
     OR v_current_writer.rolinherit
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members AS membership
       WHERE membership.member IN (
         'dialektik_govuk_metadata_writer'::pg_catalog.regrole,
         session_user::pg_catalog.regrole
       ) OR membership.roleid IN (
         'dialektik_govuk_metadata_writer'::pg_catalog.regrole,
         session_user::pg_catalog.regrole
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GOVUK_RSH_WRITER_ROLE_NOT_RESTRICTED';
  END IF;

  IF pg_catalog.has_database_privilege(session_user, pg_catalog.current_database(), 'CREATE')
     OR pg_catalog.has_schema_privilege(session_user, 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege(session_user, 'dialektik_ops', 'CREATE')
     OR pg_catalog.has_table_privilege(session_user, 'public.sources', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege(session_user, 'public.articles', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege(session_user, 'public.live_source_policies', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege(session_user, 'public.live_exposure_exclusions', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege(session_user, 'public.live_acquisition_receipts', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege(session_user, 'public.live_article_versions', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege(session_user, 'public.events', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GOVUK_RSH_INVOKER_HAS_DIRECT_WRITE_PRIVILEGES';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_direct_write_relation_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r','p','v','m','f')
    AND pg_catalog.has_table_privilege(
      session_user, relation.oid,
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    );
  IF v_direct_write_relation_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GOVUK_RSH_INVOKER_HAS_UNEXPECTED_PUBLIC_SCHEMA_WRITE_PRIVILEGES';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_other_definer_count
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
  WHERE routine.prosecdef
    AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND routine.oid <> 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)'::pg_catalog.regprocedure
    -- 044 adds the one fixed, read-only recovery function that this invoker
    -- must also call; no other SECURITY DEFINER routine is permitted.
    AND routine.oid IS DISTINCT FROM pg_catalog.to_regprocedure(
      'dialektik_ops.govuk_rsh_metadata_recovery_status()'
    )
    AND pg_catalog.has_function_privilege(session_user, routine.oid, 'EXECUTE');
  IF v_other_definer_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GOVUK_RSH_INVOKER_CAN_EXECUTE_OTHER_DEFINER_FUNCTIONS';
  END IF;

  IF p_metadata IS NULL OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_OBJECT_REQUIRED';
  END IF;
  SELECT pg_catalog.array_agg(key ORDER BY key) INTO v_keys
  FROM pg_catalog.jsonb_object_keys(p_metadata) AS key;
  IF v_keys IS DISTINCT FROM ARRAY[
    'acquiredAt','metadataHash','modifiedAt','publishedAt'
  ]::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_FIELDS_OUT_OF_SCOPE';
  END IF;
  IF pg_catalog.jsonb_typeof(p_metadata -> 'metadataHash') <> 'string'
     OR pg_catalog.jsonb_typeof(p_metadata -> 'publishedAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_metadata -> 'acquiredAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_metadata -> 'modifiedAt') NOT IN ('string','null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_TYPES_INVALID';
  END IF;

  IF (p_metadata ->> 'metadataHash') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_IDENTIFIERS_INVALID';
  END IF;

  v_published_text := p_metadata ->> 'publishedAt';
  v_modified_text := p_metadata ->> 'modifiedAt';
  v_acquired_text := p_metadata ->> 'acquiredAt';
  v_metadata_hash := p_metadata ->> 'metadataHash';
  IF v_published_text <> '2026-10-07T08:30:03.000Z'
     OR v_modified_text IS DISTINCT FROM '2026-10-07T08:30:03.000Z' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_DATES_OUT_OF_SCOPE';
  END IF;
  IF v_published_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     OR v_acquired_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     OR (v_modified_text IS NOT NULL AND v_modified_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_DATES_INVALID';
  END IF;
  v_article_id := v_target_article_id;
  v_receipt_id := v_target_receipt_id;
  v_version_id := v_target_version_id;
  v_published_at := v_published_text::timestamptz(3);
  v_modified_at := v_modified_text::timestamptz(3);
  v_acquired_at := v_acquired_text::timestamptz(3);
  IF NOT pg_catalog.isfinite(v_published_at)
     OR NOT pg_catalog.isfinite(v_acquired_at)
     OR (v_modified_at IS NOT NULL AND NOT pg_catalog.isfinite(v_modified_at))
     OR v_published_at > v_acquired_at
     OR (v_modified_at IS NOT NULL AND (v_modified_at < v_published_at OR v_modified_at > v_acquired_at))
     OR v_acquired_at < v_rights_reviewed_at
     OR v_acquired_at > pg_catalog.statement_timestamp() + interval '5 minutes'
     OR pg_catalog.statement_timestamp() > v_rights_reviewed_at + interval '30 days' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_DATE_OR_RIGHTS_WINDOW_INVALID';
  END IF;

  -- Reproduce the exact bounded application projection; this is a hash of metadata only.
  v_metadata_json := '{"sourceItemId":"' || v_source_item_id ||
    '","canonicalUrl":"' || v_canonical_url ||
    '","title":"' || v_title ||
    '","publisher":"' || v_publisher ||
    '","publishedAt":"' || v_published_text ||
    '","modifiedAt":' || CASE WHEN v_modified_text IS NULL THEN 'null' ELSE '"' || v_modified_text || '"' END ||
    ',"locale":"en","rightsEvidenceUrl":"' || v_rights_url ||
    '","rightsVerifiedAt":"2026-10-15T00:00:00.000Z"' ||
    ',"attribution":"© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0."' ||
    ',"discoveryChannel":"official_api","discoveryUrl":"' || v_discovery_url || '"}';
  v_expected_metadata_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_metadata_json, 'UTF8')),
    'hex'
  );
  IF v_metadata_hash <> v_expected_metadata_hash THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'GOVUK_RSH_METADATA_HASH_MISMATCH';
  END IF;

  SELECT pg_catalog.count(id)::integer INTO v_source_count
  FROM public.sources WHERE id = v_source_id;
  SELECT pg_catalog.count(source_id)::integer INTO v_guard_count
  FROM public.prospective_content_rights_write_guards WHERE source_id = v_source_id;
  SELECT pg_catalog.count(id)::integer INTO v_policy_count
  FROM public.live_source_policies WHERE source_id = v_source_id AND registry_key = v_registry_key;
  SELECT pg_catalog.count(id)::integer INTO v_exclusion_count
  FROM public.live_exposure_exclusions
  WHERE registry_key = v_registry_key AND source_item_id = v_source_item_id;
  SELECT pg_catalog.count(id)::integer INTO v_receipt_count
  FROM public.live_acquisition_receipts WHERE source_id = v_source_id AND source_item_id = v_source_item_id;
  SELECT pg_catalog.count(id)::integer INTO v_article_count
  FROM public.articles WHERE source_id = v_source_id AND url_canonical = v_canonical_url;
  SELECT pg_catalog.count(version.id)::integer INTO v_version_count
  FROM public.live_article_versions AS version
  JOIN public.articles AS article ON article.id = version.article_id
  WHERE article.source_id = v_source_id AND article.url_canonical = v_canonical_url;
  v_total := v_source_count + v_guard_count + v_policy_count + v_exclusion_count
    + v_receipt_count + v_article_count + v_version_count;

  IF v_total > 0 THEN
    IF v_source_count = 1 AND v_guard_count = 1 AND v_policy_count = 1
       AND v_exclusion_count = 3 AND v_receipt_count = 1
       AND v_article_count = 1 AND v_version_count = 1
       AND EXISTS (
         SELECT 1 FROM public.sources
         WHERE id = v_source_id AND name = v_publisher
           AND source_type = 'other'::public.source_type
           AND is_issuing_entity IS FALSE AND canonical_domain = 'gov.uk'
            AND origin = 'LIVE_REAL' AND created_at = v_acquired_at
       ) AND EXISTS (
         SELECT 1 FROM public.live_source_policies
         WHERE id = v_policy_id AND source_id = v_source_id
           AND registry_key = v_registry_key AND rights_class = 'LIVE_READY'
           AND storage_policy = 'METADATA_ONLY' AND active IS TRUE
           AND rights_evidence_url = v_rights_url
            AND rights_verified_at = v_rights_reviewed_at AND policy = v_policy
            AND recorded_at = v_acquired_at
       ) AND EXISTS (
         SELECT 1 FROM public.live_exposure_exclusions
         WHERE id = v_canonical_exclusion_id AND registry_key = v_registry_key
           AND publisher_name = v_publisher AND canonical_url = v_canonical_url
           AND source_item_id = v_source_item_id AND discovery_url = v_discovery_url
           AND reason = 'govuk_rsh_metadata_acquisition'
            AND published_at = v_published_at AND first_seen_at = v_acquired_at
           AND content_hash IS NULL AND near_duplicate_signature IS NULL
       ) AND EXISTS (
         SELECT 1 FROM public.live_exposure_exclusions
         WHERE id = v_title_exclusion_id AND registry_key = v_registry_key
           AND publisher_name = v_publisher AND canonical_url = v_canonical_url
           AND source_item_id = v_source_item_id AND discovery_url = v_discovery_url
           AND reason = 'govuk_rsh_metadata_title_hash'
            AND published_at = v_published_at AND first_seen_at = v_acquired_at
           AND content_hash = v_content_hash
           AND near_duplicate_signature = v_near_duplicate_signature
       ) AND EXISTS (
         SELECT 1 FROM public.live_exposure_exclusions
         WHERE id = v_identity_exclusion_id AND registry_key = v_registry_key
           AND publisher_name = v_publisher AND canonical_url IS NULL
           AND source_item_id = v_source_item_id AND discovery_url = v_discovery_url
           AND reason = 'govuk_rsh_metadata_source_identity'
            AND published_at = v_published_at AND first_seen_at = v_acquired_at
           AND content_hash IS NULL AND near_duplicate_signature IS NULL
       ) AND EXISTS (
         SELECT 1 FROM public.live_acquisition_receipts
          WHERE id = v_receipt_id AND source_id = v_source_id AND policy_id = v_policy_id
           AND exclusion_id = v_canonical_exclusion_id
           AND source_item_id = v_source_item_id AND canonical_url = v_canonical_url
           AND discovery_channel = 'official_api' AND discovery_url = v_discovery_url
            AND discovered_url = v_canonical_url
           AND raw_payload_hash = v_metadata_hash
           AND adapter_version = 'govuk-rsh-content-api-metadata-v1'
           AND disposition = 'PERSISTED' AND error_code IS NULL
           AND published_at = v_published_at AND modified_at IS NOT DISTINCT FROM v_modified_at
            AND original_published_at = v_published_text
            AND original_modified_at IS NOT DISTINCT FROM v_modified_text
            AND seen_at = v_acquired_at
       ) AND EXISTS (
         SELECT 1 FROM public.articles
          WHERE id = v_article_id AND source_id = v_source_id AND event_id IS NULL
           AND url_canonical = v_canonical_url AND origin = 'LIVE_REAL'
           AND text_original = v_title AND text_normalized = v_title AND lang = 'en'
           AND published_at = v_published_at AND captured_at = v_acquired_at
           AND updated_at_source IS NOT DISTINCT FROM v_modified_at
       ) AND EXISTS (
         SELECT 1 FROM public.live_article_versions AS version
         JOIN public.articles AS article ON article.id = version.article_id
         JOIN public.live_acquisition_receipts AS receipt ON receipt.id = version.receipt_id
          WHERE version.id = v_version_id AND version.article_id = v_article_id
            AND article.source_id = v_source_id AND article.url_canonical = v_canonical_url
            AND article.event_id IS NULL AND version.receipt_id = v_receipt_id
            AND version.receipt_id = receipt.id AND version.version_number = 1
           AND version.metadata_hash = v_metadata_hash AND version.headline = v_title
           AND version.published_at = v_published_at
           AND version.modified_at IS NOT DISTINCT FROM v_modified_at
           AND version.content_hash = v_content_hash
           AND version.near_duplicate_signature = v_near_duplicate_signature
           AND version.excerpt IS NULL AND version.author IS NULL
            AND version.declared_upstream IS NULL AND version.recorded_at = v_acquired_at
       ) THEN
      REVOKE EXECUTE ON FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)
        FROM dialektik_govuk_rsh_invoker;
      RETURN QUERY SELECT 'already_persisted'::text, v_source_id::text,
        (SELECT article.id::text FROM public.articles AS article
         WHERE article.source_id = v_source_id AND article.url_canonical = v_canonical_url),
        (SELECT receipt.id::text FROM public.live_acquisition_receipts AS receipt
         WHERE receipt.source_id = v_source_id AND receipt.source_item_id = v_source_item_id),
        v_canonical_url, v_source_item_id, v_metadata_hash;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'GOVUK_RSH_PARTIAL_OR_CONFLICTING_EXISTENCE';
  END IF;

  INSERT INTO public.sources (
    id, name, source_type, is_issuing_entity, canonical_domain, origin, created_at
  ) VALUES (
    v_source_id, v_publisher, 'other'::public.source_type, FALSE, 'gov.uk', 'LIVE_REAL', v_acquired_at
  );

  INSERT INTO public.live_source_policies (
    id, source_id, registry_key, rights_class, storage_policy, active,
    rights_evidence_url, rights_verified_at, policy, recorded_at
  ) VALUES (
    v_policy_id, v_source_id, v_registry_key, 'LIVE_READY', 'METADATA_ONLY', TRUE,
    v_rights_url, v_rights_reviewed_at, v_policy, v_acquired_at
  );

  INSERT INTO public.live_exposure_exclusions (
    id, registry_key, publisher_name, canonical_url, source_item_id,
    published_at, first_seen_at, discovery_url, reason, content_hash,
    near_duplicate_signature
  ) VALUES
    (v_canonical_exclusion_id, v_registry_key, v_publisher, v_canonical_url,
     v_source_item_id, v_published_at, v_acquired_at, v_discovery_url,
     'govuk_rsh_metadata_acquisition', NULL, NULL),
    (v_title_exclusion_id, v_registry_key, v_publisher, v_canonical_url,
     v_source_item_id, v_published_at, v_acquired_at, v_discovery_url,
     'govuk_rsh_metadata_title_hash', v_content_hash, v_near_duplicate_signature),
    (v_identity_exclusion_id, v_registry_key, v_publisher, NULL,
     v_source_item_id, v_published_at, v_acquired_at, v_discovery_url,
     'govuk_rsh_metadata_source_identity', NULL, NULL);

  INSERT INTO public.live_acquisition_receipts (
    id, source_id, policy_id, exclusion_id, discovery_channel, discovery_url,
    discovered_url, canonical_url, source_item_id, published_at, modified_at,
    original_published_at, original_modified_at, seen_at, raw_payload_hash,
    adapter_version, disposition, error_code
  ) VALUES (
    v_receipt_id, v_source_id, v_policy_id, v_canonical_exclusion_id,
    'official_api', v_discovery_url, v_canonical_url, v_canonical_url,
    v_source_item_id, v_published_at, v_modified_at, v_published_text,
    v_modified_text, v_acquired_at, v_metadata_hash,
    'govuk-rsh-content-api-metadata-v1', 'PERSISTED', NULL
  );

  INSERT INTO public.articles (
    id, source_id, event_id, url_canonical, text_original, text_normalized,
    lang, published_at, captured_at, updated_at_source, origin, live_exposure_id
  ) VALUES (
    v_article_id, v_source_id, NULL, v_canonical_url, v_title, v_title,
    'en', v_published_at, v_acquired_at, v_modified_at, 'LIVE_REAL',
    v_canonical_exclusion_id
  );

  INSERT INTO public.live_article_versions (
    id, article_id, receipt_id, version_number, metadata_hash, headline,
    published_at, modified_at, content_hash, near_duplicate_signature, recorded_at
  ) VALUES (
    v_version_id, v_article_id, v_receipt_id, 1, v_metadata_hash, v_title,
    v_published_at, v_modified_at, v_content_hash, v_near_duplicate_signature,
    v_acquired_at
  );

  SELECT pg_catalog.count(id)::integer INTO v_source_count
  FROM public.sources WHERE id = v_source_id;
  SELECT pg_catalog.count(source_id)::integer INTO v_guard_count
  FROM public.prospective_content_rights_write_guards WHERE source_id = v_source_id;
  SELECT pg_catalog.count(id)::integer INTO v_policy_count
  FROM public.live_source_policies WHERE source_id = v_source_id AND registry_key = v_registry_key;
  SELECT pg_catalog.count(id)::integer INTO v_exclusion_count
  FROM public.live_exposure_exclusions
  WHERE registry_key = v_registry_key AND source_item_id = v_source_item_id;
  SELECT pg_catalog.count(id)::integer INTO v_receipt_count
  FROM public.live_acquisition_receipts WHERE source_id = v_source_id AND source_item_id = v_source_item_id;
  SELECT pg_catalog.count(id)::integer INTO v_article_count
  FROM public.articles WHERE source_id = v_source_id AND url_canonical = v_canonical_url;
  SELECT pg_catalog.count(version.id)::integer INTO v_version_count
  FROM public.live_article_versions AS version
  JOIN public.articles AS article ON article.id = version.article_id
  WHERE article.source_id = v_source_id AND article.url_canonical = v_canonical_url;
  IF v_source_count <> 1 OR v_guard_count <> 1 OR v_policy_count <> 1
     OR v_exclusion_count <> 3 OR v_receipt_count <> 1
     OR v_article_count <> 1 OR v_version_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'GOVUK_RSH_EXPECTED_NINE_ROWS_NOT_WRITTEN';
  END IF;

  -- This ACL change is transactional with the nine rows. A successful commit consumes the grant.
  REVOKE EXECUTE ON FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)
    FROM dialektik_govuk_rsh_invoker;
  RETURN QUERY SELECT 'persisted'::text, v_source_id::text, v_article_id::text,
    v_receipt_id::text, v_canonical_url, v_source_item_id, v_metadata_hash;
END;
$function$;

REVOKE ALL ON FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)
  FROM PUBLIC, anon, authenticated, dialektik_core_app, postgres,
  dialektik_govuk_rsh_invoker;
RESET ROLE;
-- The NOLOGIN SECURITY DEFINER owner needs schema USAGE to resolve its own
-- regprocedure identity checks; it receives no schema CREATE privilege.
REVOKE CREATE ON SCHEMA dialektik_ops FROM dialektik_govuk_metadata_writer;
REVOKE dialektik_govuk_metadata_writer FROM postgres;
`;

const DOWN = String.raw`
DO $preflight$
DECLARE
  invoker_oid oid;
  validator_body_count integer;
  validator_trigger_count integer;
BEGIN
  -- Serialize rollback against the one-shot invocation. The lock is held by
  -- this migration transaction until the function and invoker are removed.
  PERFORM pg_catalog.pg_advisory_xact_lock(20261018, 86);

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'dialektik_ops')
     AND (EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
       ) AS privilege
       WHERE function.oid = 'dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)'::pg_catalog.regprocedure
         AND privilege.grantee = 'postgres'::pg_catalog.regrole
         AND privilege.privilege_type = 'EXECUTE'
     ) OR EXISTS (
       SELECT 1 FROM public.sources
       WHERE id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid
     ) OR EXISTS (
       SELECT 1 FROM public.live_acquisition_receipts
       WHERE source_item_id = '86f4abba-9eaa-412f-b048-5ed30aa74201'
     )) THEN
    RAISE EXCEPTION 'GOV.UK one-shot function is authorized or has data; refusing rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity
    WHERE usename = 'dialektik_govuk_metadata_writer'
      AND pid <> pg_catalog.pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'GOV.UK metadata writer has an active session; refusing rollback';
  END IF;

  SELECT oid INTO invoker_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_rsh_invoker'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
    AND rolconnlimit = 2;
  IF invoker_oid IS NULL THEN
    RAISE EXCEPTION 'GOV.UK rollback requires the exact restricted NOLOGIN invoker role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity
    WHERE usename = 'dialektik_govuk_rsh_invoker'
      AND pid <> pg_catalog.pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'GOV.UK invoker has an active session; drain it before rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = invoker_oid OR roleid = invoker_oid
  ) THEN
    RAISE EXCEPTION 'GOV.UK invoker has an unexpected role membership; refusing rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_shdepend
    WHERE refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
      AND refobjid = invoker_oid AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'GOV.UK invoker owns an unexpected object; inspect before rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sources WHERE id = '01M4YDQK00WS344WW8RCPCEQHE'::public.dialektik_ulid)
     OR COALESCE(btrim(pg_catalog.regexp_replace((
       SELECT prosrc FROM pg_catalog.pg_proc
       WHERE proname = 'dialektik_seed_prospective_rights_guard'
         AND pronamespace = 'public'::pg_catalog.regnamespace
         AND NOT prosecdef AND proconfig IS NULL
     ), '[[:space:]]+', ' ', 'g')), '') <>
       'BEGIN INSERT INTO public.prospective_content_rights_write_guards(source_id) VALUES (NEW.id) ON CONFLICT (source_id) DO NOTHING; RETURN NEW; END;' THEN
    RAISE EXCEPTION 'GOV.UK rollback requires unused target and unchanged rights-guard trigger function';
  END IF;
  SELECT count(*)::integer INTO validator_body_count
  FROM pg_catalog.pg_proc AS function
  WHERE function.pronamespace = 'public'::pg_catalog.regnamespace
    AND function.proowner = current_user::pg_catalog.regrole
    AND NOT function.prosecdef AND function.proconfig IS NULL
    AND CASE function.proname
      WHEN 'dialektik_validate_live_receipt' THEN lower(btrim(pg_catalog.regexp_replace(
        function.prosrc, '[[:space:]]+', ' ', 'g'
      ))) = 'begin if not exists ( select 1 from public.live_source_policies as policy join public.live_exposure_exclusions as exclusion on exclusion.id = new.exclusion_id join public.sources as source on source.id = policy.source_id where policy.id = new.policy_id and policy.source_id = new.source_id and source.origin = ''live_real'' and exclusion.registry_key = policy.registry_key and policy.active and policy.rights_class = ''live_ready'' ) then raise exception using errcode = ''23514'', message = ''live receipt requires matching source policy and permanent exclusion''; end if; return new; end;'
      WHEN 'dialektik_validate_live_article' THEN lower(btrim(pg_catalog.regexp_replace(
        function.prosrc, '[[:space:]]+', ' ', 'g'
      ))) = 'begin if tg_op = ''update'' and old.origin = ''live_real'' and ( new.origin is distinct from old.origin or new.live_exposure_id is distinct from old.live_exposure_id or new.source_id is distinct from old.source_id or new.url_canonical is distinct from old.url_canonical ) then raise exception using errcode = ''23514'', message = ''live article identity and exclusion are permanent''; end if; if new.origin = ''live_real'' and not exists ( select 1 from public.sources as source join public.live_source_policies as policy on policy.source_id = source.id join public.live_exposure_exclusions as exclusion on exclusion.id = new.live_exposure_id where source.id = new.source_id and source.origin = ''live_real'' and policy.active and policy.rights_class = ''live_ready'' and policy.registry_key = exclusion.registry_key and exclusion.canonical_url = new.url_canonical ) then raise exception using errcode = ''23514'', message = ''live article requires permitted source and matching exclusion''; end if; return new; end;'
      WHEN 'dialektik_validate_live_version' THEN lower(btrim(pg_catalog.regexp_replace(
        function.prosrc, '[[:space:]]+', ' ', 'g'
      ))) = 'begin if not exists ( select 1 from public.articles as article join public.live_acquisition_receipts as receipt on receipt.id = new.receipt_id join public.live_source_policies as policy on policy.id = receipt.policy_id where article.id = new.article_id and article.origin = ''live_real'' and article.source_id = receipt.source_id and article.live_exposure_id = receipt.exclusion_id and receipt.disposition = ''persisted'' and policy.active and policy.rights_class = ''live_ready'' and (new.excerpt is null or policy.storage_policy = ''metadata_and_feed_excerpt'') and exists ( select 1 from public.live_exposure_exclusions as exclusion where exclusion.registry_key = policy.registry_key and exclusion.canonical_url = receipt.canonical_url and exclusion.content_hash = new.content_hash and exclusion.near_duplicate_signature = new.near_duplicate_signature ) ) then raise exception using errcode = ''23514'', message = ''live version requires linked permitted acquisition receipt''; end if; return new; end;'
      ELSE FALSE
    END;
  SELECT count(*)::integer INTO validator_trigger_count
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_proc AS function ON function.oid = trigger.tgfoid
  WHERE NOT trigger.tgisinternal
    AND ((trigger.tgname = 'live_receipts_validate'
          AND trigger.tgrelid = 'public.live_acquisition_receipts'::pg_catalog.regclass
          AND function.proname = 'dialektik_validate_live_receipt')
      OR (trigger.tgname = 'articles_validate_live'
          AND trigger.tgrelid = 'public.articles'::pg_catalog.regclass
          AND function.proname = 'dialektik_validate_live_article')
      OR (trigger.tgname = 'live_versions_validate'
          AND trigger.tgrelid = 'public.live_article_versions'::pg_catalog.regclass
          AND function.proname = 'dialektik_validate_live_version'));
  IF validator_body_count <> 3 OR validator_trigger_count <> 3 THEN
    RAISE EXCEPTION 'GOV.UK rollback requires the unchanged three invoker validator functions';
  END IF;
END;
$preflight$;

-- A successful rollback destroys the login principal and its stored verifier.
-- Requiring NOLOGIN and zero sessions above makes this a quiescent, fail-closed
-- removal; the migration transaction rolls back all changes if any dependency
-- or privilege remains.
ALTER ROLE dialektik_govuk_rsh_invoker NOLOGIN PASSWORD NULL;
REVOKE ALL ON SCHEMA dialektik_ops FROM dialektik_govuk_rsh_invoker;
DO $revoke_invoker_connect$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE CONNECT ON DATABASE %I FROM dialektik_govuk_rsh_invoker',
    pg_catalog.current_database()
  );
END;
$revoke_invoker_connect$;

REVOKE SELECT (created_at) ON TABLE public.sources
  FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (discovery_channel, discovery_url, discovered_url, published_at,
  modified_at, original_published_at, original_modified_at, seen_at, error_code)
  ON TABLE public.live_acquisition_receipts FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (text_original, text_normalized, lang, published_at, updated_at_source)
  ON TABLE public.articles FROM dialektik_govuk_metadata_writer;
REVOKE SELECT (id, receipt_id, headline, published_at, modified_at, content_hash,
  near_duplicate_signature, recorded_at, excerpt, author, declared_upstream)
  ON TABLE public.live_article_versions FROM dialektik_govuk_metadata_writer;

GRANT dialektik_govuk_metadata_writer TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
SET LOCAL ROLE dialektik_govuk_metadata_writer;
REVOKE ALL ON FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(jsonb)
  FROM PUBLIC, anon, authenticated, dialektik_core_app,
       dialektik_govuk_rsh_invoker;
DROP FUNCTION dialektik_ops.persist_govuk_rsh_metadata_once(jsonb);
RESET ROLE;
REVOKE dialektik_govuk_metadata_writer FROM postgres;
DROP SCHEMA dialektik_ops;
DO $drop_invoker$
DECLARE
  v_invoker oid;
BEGIN
  SELECT oid INTO v_invoker FROM pg_catalog.pg_roles
  WHERE rolname = 'dialektik_govuk_rsh_invoker' AND NOT rolcanlogin;
  IF v_invoker IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_stat_activity
       WHERE usename = 'dialektik_govuk_rsh_invoker'
         AND pid <> pg_catalog.pg_backend_pid()
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members
       WHERE member = v_invoker OR roleid = v_invoker
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_shdepend
       WHERE refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
         AND refobjid = v_invoker AND deptype IN ('o', 'a')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_database AS database
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
       ) AS privilege
       WHERE database.datname = pg_catalog.current_database()
         AND privilege.grantee = v_invoker
         AND privilege.privilege_type = 'CONNECT'
     ) THEN
    RAISE EXCEPTION 'GOV.UK rollback found residual invoker sessions, memberships, ownership, ACLs, or CONNECT grant';
  END IF;
  EXECUTE 'DROP ROLE dialektik_govuk_rsh_invoker';
END;
$drop_invoker$;
CREATE OR REPLACE FUNCTION public.dialektik_seed_prospective_rights_guard()
RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  insert into prospective_content_rights_write_guards(source_id)
  values (new.id)
  on conflict (source_id) do nothing;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.dialektik_validate_live_receipt() RETURNS trigger
LANGUAGE plpgsql AS $function$
begin
  if not exists (
    select 1 from live_source_policies p join live_exposure_exclusions e on e.id = new.exclusion_id
      join sources s on s.id = p.source_id
    where p.id = new.policy_id and p.source_id = new.source_id and s.origin = 'LIVE_REAL'
      and e.registry_key = p.registry_key and p.active and p.rights_class = 'LIVE_READY'
  ) then
    raise exception using errcode = '23514', message = 'live receipt requires matching source policy and permanent exclusion';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.dialektik_validate_live_article() RETURNS trigger
LANGUAGE plpgsql AS $function$
begin
  if tg_op = 'UPDATE' and old.origin = 'LIVE_REAL' and (
    new.origin is distinct from old.origin or new.live_exposure_id is distinct from old.live_exposure_id
    or new.source_id is distinct from old.source_id or new.url_canonical is distinct from old.url_canonical
  ) then
    raise exception using errcode = '23514', message = 'live article identity and exclusion are permanent';
  end if;
  if new.origin = 'LIVE_REAL' and not exists (
    select 1 from sources s join live_source_policies p on p.source_id = s.id
    join live_exposure_exclusions e on e.id = new.live_exposure_id
    where s.id = new.source_id and s.origin = 'LIVE_REAL'
      and p.active and p.rights_class = 'LIVE_READY'
      and p.registry_key = e.registry_key and e.canonical_url = new.url_canonical
  ) then
    raise exception using errcode = '23514', message = 'live article requires permitted source and matching exclusion';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.dialektik_validate_live_version() RETURNS trigger
LANGUAGE plpgsql AS $function$
begin
  if not exists (
    select 1 from articles a join live_acquisition_receipts r on r.id = new.receipt_id
      join live_source_policies p on p.id = r.policy_id
    where a.id = new.article_id and a.origin = 'LIVE_REAL'
      and a.source_id = r.source_id and a.live_exposure_id = r.exclusion_id
      and r.disposition = 'PERSISTED' and p.active and p.rights_class = 'LIVE_READY'
      and (new.excerpt is null or p.storage_policy = 'METADATA_AND_FEED_EXCERPT')
      and exists (select 1 from live_exposure_exclusions e
        where e.registry_key = p.registry_key and e.canonical_url = r.canonical_url
          and e.content_hash = new.content_hash and e.near_duplicate_signature = new.near_duplicate_signature)
  ) then
    raise exception using errcode = '23514', message = 'live version requires linked permitted acquisition receipt';
  end if;
  return new;
end;
$function$;
`;

/** Inert SQL payloads exported for the separately authorized Supabase MCP path. */
export const govUkRshOneShotMetadataUpSql = UP;
export const govUkRshOneShotMetadataDownSql = DOWN;

export const govUkRshOneShotMetadataMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(database: Kysely<Database>): Promise<void> {
    await sql.raw(DOWN).execute(database);
  },
};
