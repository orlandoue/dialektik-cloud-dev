import { Kysely, sql } from 'kysely';

const SEMANTIC_WRITER_ROLE = 'dialektik_semantic_writer';
const CORE_APP_ROLE = 'dialektik_core_app';
const CORE_RUNTIME_ROLE = 'dialektik_core_runtime';
const LIVE_WRITER_ROLE = 'dialektik_govuk_metadata_writer';

/**
 * Migration 043: Pack Semilla de Fuentes (GOV.UK Dual Publisher + 10 Fuentes Chilenas)
 * y Permisos RLS de Escritura para el Motor Semántico (Acontecimientos, Historia y Contradicciones).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${SEMANTIC_WRITER_ROLE}') THEN
        CREATE ROLE ${SEMANTIC_WRITER_ROLE} NOLOGIN;
      END IF;
    END
    $$;

    GRANT USAGE ON SCHEMA public TO ${SEMANTIC_WRITER_ROLE};
    GRANT ${SEMANTIC_WRITER_ROLE} TO ${CORE_APP_ROLE};
    GRANT ${SEMANTIC_WRITER_ROLE} TO ${LIVE_WRITER_ROLE};

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${CORE_RUNTIME_ROLE}') THEN
        EXECUTE 'GRANT ${SEMANTIC_WRITER_ROLE} TO ${CORE_RUNTIME_ROLE}';
      END IF;
    END
    $$;
  `).execute(db);

  const semanticTables = [
    'events',
    'event_topics',
    'topics',
    'categories',
    'occurrences',
    'assertions',
    'claim_spans',
    'evidence',
    'evidence_assessments',
    'relationships',
    'relationship_endpoints',
    'contradiction_publications',
    'positions',
    'primary_facts',
    'attribution_chain',
  ];

  for (const table of semanticTables) {
    await sql.raw(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '${table}'
        ) THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.${table} TO ${SEMANTIC_WRITER_ROLE}, ${CORE_APP_ROLE}, ${LIVE_WRITER_ROLE}';
          EXECUTE 'DROP POLICY IF EXISTS dialektik_semantic_writer_${table}_write ON public.${table}';
          EXECUTE 'CREATE POLICY dialektik_semantic_writer_${table}_write ON public.${table} FOR ALL TO ${SEMANTIC_WRITER_ROLE}, ${CORE_APP_ROLE}, ${LIVE_WRITER_ROLE} USING (true) WITH CHECK (true)';
        END IF;
      END
      $$;
    `).execute(db);
  }

  await sql.raw(`
    ALTER TABLE public.live_source_policies
      DROP CONSTRAINT IF EXISTS live_source_policies_check,
      DROP CONSTRAINT IF EXISTS live_source_policies_rights_class_check,
      DROP CONSTRAINT IF EXISTS live_source_policies_storage_policy_check;

    ALTER TABLE public.live_source_policies
      ADD CONSTRAINT live_source_policies_rights_class_check
      CHECK (rights_class = ANY (ARRAY['PUBLIC_DOMAIN'::text, 'CREATIVE_COMMONS'::text, 'COMMERCIAL_LICENSE'::text, 'PROPRIETARY'::text, 'FAIR_USE'::text, 'UNKNOWN'::text, 'public_domain'::text, 'creative_commons'::text, 'proprietary'::text]));

    ALTER TABLE public.live_source_policies
      ADD CONSTRAINT live_source_policies_storage_policy_check
      CHECK (storage_policy = ANY (ARRAY['FULL_TEXT_PERMANENT'::text, 'INDEX_ONLY_EXCERPT_SHORT_LIVED'::text, 'EPHEMERAL_30_DAYS'::text, 'METADATA_ONLY'::text, 'metadata_only'::text]));

    ALTER TABLE public.live_source_policies
      ADD CONSTRAINT live_source_policies_check
      CHECK (
        (NOT active)
        OR (
          rights_class IS NOT NULL
          AND storage_policy IS NOT NULL
          AND rights_evidence_url IS NOT NULL
          AND jsonb_typeof(policy) = 'object'
        )
      );

    INSERT INTO public.sources (
      id, name, source_type, is_issuing_entity, canonical_domain, created_at, origin
    )
    VALUES
      ('01M4YDQK00WS344WW8RCPCEQHE', 'Regulator of Social Housing (GOV.UK)', 'official_statistics'::public.source_type, true, 'gov.uk', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00WS344WW8RCPCEQHF', 'Ministry of Housing, Communities & Local Government (GOV.UK)', 'official_statistics'::public.source_type, true, 'gov.uk', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH100000SENAPRED', 'SENAPRED Chile', 'official_statistics'::public.source_type, true, 'senapred.gob.cl', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH10000000CSN0CH', 'Centro Sismológico Nacional (U. de Chile)', 'official_statistics'::public.source_type, true, 'sismologia.cl', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH100000BCENTRA1', 'Banco Central de Chile', 'official_statistics'::public.source_type, true, 'bcentral.cl', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH100000000G0BC1', 'Gobierno de Chile (Prensa Oficial)', 'official_statistics'::public.source_type, true, 'gob.cl', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH1000B10B10CH11', 'BioBioChile', 'radio'::public.source_type, false, 'biobiochile.cl', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH100C00PERAT1VA', 'Cooperativa.cl', 'radio'::public.source_type, false, 'cooperativa.cl', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH100001ATERCERA', 'La Tercera', 'daily_newspaper'::public.source_type, false, 'latercera.com', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH100E1M0STRAD0R', 'El Mostrador', 'digital_native'::public.source_type, false, 'elmostrador.cl', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH1000000000EM01', 'Emol', 'daily_newspaper'::public.source_type, false, 'emol.com', NOW(), 'LIVE_REAL'),
      ('01M4YDQK00CH1000C1PERCH11E', 'CIPER Chile', 'digital_native'::public.source_type, false, 'ciperchile.cl', NOW(), 'LIVE_REAL')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.live_source_policies (
      id, source_id, registry_key, rights_class, storage_policy, active, rights_evidence_url, rights_verified_at, policy, recorded_at
    )
    VALUES
      ('04bb0122d4d51305a1ab53451a5731a93271be0dfeffe400db83716395f53d3b', '01M4YDQK00WS344WW8RCPCEQHE', 'product-govuk-rsh-content-api-v1', 'PUBLIC_DOMAIN', 'METADATA_ONLY', true, 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', NOW(), '{"registry_key":"product-govuk-rsh-content-api-v1","rights_class":"PUBLIC_DOMAIN","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.gov.uk/api/search.json?filter_organisations=regulator-of-social-housing","metadata_only":true}'::jsonb, NOW()),
      ('571b9f2bd841737fb40a42e46110c5bd87643bc23746fa389bb26edce0306b49', '01M4YDQK00WS344WW8RCPCEQHF', 'product-govuk-mhclg-content-api-v1', 'PUBLIC_DOMAIN', 'METADATA_ONLY', true, 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', NOW(), '{"registry_key":"product-govuk-mhclg-content-api-v1","rights_class":"PUBLIC_DOMAIN","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.gov.uk/api/search.json?filter_organisations=ministry-of-housing-communities-local-government","metadata_only":true}'::jsonb, NOW()),
      ('e0726395339fba1b610b34a153684ac25ef3df31aa42025614803bc20d1e37f1', '01M4YDQK00CH100000SENAPRED', 'chile-official-senapred-v1', 'PUBLIC_DOMAIN', 'METADATA_ONLY', true, 'https://senapred.gob.cl/', NOW(), '{"registry_key":"chile-official-senapred-v1","rights_class":"PUBLIC_DOMAIN","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://senapred.gob.cl/feed/","metadata_only":true}'::jsonb, NOW()),
      ('d34ca9b9022d0f2d2e84645a8217ed01eafd97cd37b96ba958b1ff72730ce5b3', '01M4YDQK00CH10000000CSN0CH', 'chile-official-csn-v1', 'PUBLIC_DOMAIN', 'METADATA_ONLY', true, 'https://www.sismologia.cl/', NOW(), '{"registry_key":"chile-official-csn-v1","rights_class":"PUBLIC_DOMAIN","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.sismologia.cl/","metadata_only":true}'::jsonb, NOW()),
      ('3c4e6222f140a6e6f00e7485a0d5d9f25953628b1c3b9edce451cd43ebfe2fc3', '01M4YDQK00CH100000BCENTRA1', 'chile-official-bcentral-v1', 'PUBLIC_DOMAIN', 'METADATA_ONLY', true, 'https://www.bcentral.cl/', NOW(), '{"registry_key":"chile-official-bcentral-v1","rights_class":"PUBLIC_DOMAIN","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.bcentral.cl/noticias","metadata_only":true}'::jsonb, NOW()),
      ('8dd2a2c233f780913e2216eea889c9f3bc584641e7f7b447723339989d828c7b', '01M4YDQK00CH100000000G0BC1', 'chile-official-gobcl-v1', 'PUBLIC_DOMAIN', 'METADATA_ONLY', true, 'https://www.gob.cl/', NOW(), '{"registry_key":"chile-official-gobcl-v1","rights_class":"PUBLIC_DOMAIN","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.gob.cl/noticias/","metadata_only":true}'::jsonb, NOW()),
      ('54503d6ec3f1322c62523499a0a2f9f947a9a1abb53d51a1965dd818aca893e6', '01M4YDQK00CH1000B10B10CH11', 'chile-rss-biobiochile-v1', 'PROPRIETARY', 'METADATA_ONLY', true, 'https://www.biobiochile.cl/', NOW(), '{"registry_key":"chile-rss-biobiochile-v1","rights_class":"PROPRIETARY","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.biobiochile.cl/lista/categorias/nacional","metadata_only":true}'::jsonb, NOW()),
      ('1323709f72fca41493d772cfa0460235dbe5c041bb46b80456d5b1a3cdfc54e8', '01M4YDQK00CH100C00PERAT1VA', 'chile-rss-cooperativa-v1', 'PROPRIETARY', 'METADATA_ONLY', true, 'https://www.cooperativa.cl/', NOW(), '{"registry_key":"chile-rss-cooperativa-v1","rights_class":"PROPRIETARY","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.cooperativa.cl/noticias/site/tax/port/all/rss____1.xml","metadata_only":true}'::jsonb, NOW()),
      ('5242af5bcf9da29fa605a1dc769962ec42b76d2e0bdd560551cb5a0786cbffcd', '01M4YDQK00CH100001ATERCERA', 'chile-rss-latercera-v1', 'PROPRIETARY', 'METADATA_ONLY', true, 'https://www.latercera.com/', NOW(), '{"registry_key":"chile-rss-latercera-v1","rights_class":"PROPRIETARY","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml","metadata_only":true}'::jsonb, NOW()),
      ('693875eda3947368d0406ae1a2c45e314982db2b4d7a19c6ac5bae558921c01e', '01M4YDQK00CH100E1M0STRAD0R', 'chile-rss-elmostrador-v1', 'PROPRIETARY', 'METADATA_ONLY', true, 'https://www.elmostrador.cl/', NOW(), '{"registry_key":"chile-rss-elmostrador-v1","rights_class":"PROPRIETARY","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.elmostrador.cl/destacado/feed/","metadata_only":true}'::jsonb, NOW()),
      ('a9a237db0b18e739748d2be60de1a18620624bf7f6c7f32f6512845ebcb3252c', '01M4YDQK00CH1000000000EM01', 'chile-rss-emol-v1', 'PROPRIETARY', 'METADATA_ONLY', true, 'https://www.emol.com/', NOW(), '{"registry_key":"chile-rss-emol-v1","rights_class":"PROPRIETARY","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.emol.com/rss/rss.asp","metadata_only":true}'::jsonb, NOW()),
      ('aafe4625e2af0e1b1b4560de235d3e70bd05ac504f769fc1495293d5aed0a00d', '01M4YDQK00CH1000C1PERCH11E', 'chile-rss-ciperchile-v1', 'CREATIVE_COMMONS', 'METADATA_ONLY', true, 'https://www.ciperchile.cl/', NOW(), '{"registry_key":"chile-rss-ciperchile-v1","rights_class":"CREATIVE_COMMONS","storage_policy":"METADATA_ONLY","channel":"rss_or_api","feed_url":"https://www.ciperchile.cl/feed/","metadata_only":true}'::jsonb, NOW())
    ON CONFLICT (id) DO NOTHING;

    DO $$
    BEGIN
      INSERT INTO public.prospective_content_rights_write_guards (source_id)
      SELECT id FROM public.sources WHERE origin = 'LIVE_REAL'
      ON CONFLICT (source_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped direct insert into prospective_content_rights_write_guards: %', SQLERRM;
    END
    $$;
  `).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    DELETE FROM public.live_source_policies
    WHERE registry_key LIKE 'chile-%' OR registry_key = 'product-govuk-mhclg-content-api-v1';

    DELETE FROM public.sources
    WHERE id LIKE '01M4YDQK00CH1%' OR id = '01M4YDQK00WS344WW8RCPCEQHF';
  `).execute(db);
}
