import { Kysely, sql } from 'kysely';

const WRITER_ROLE = 'dialektik_govuk_metadata_writer';
const LEGACY_PRODUCT_ROLE = 'dialektik_govuk_product_writer';
const CORE_READ_ROLE = 'dialektik_core_app';

/**
 * Migration 042: Row-Level Security (RLS) scope for live metadata ingestion.
 *
 * Synchronizes GitHub migration history with Supabase (`dialektik-dev`) and upgrades
 * the single-article hardcoded test predicates to structural `LIVE_REAL` provenance
 * guards that support multi-publisher GOV.UK (RSH + MHCLG/DLUHC) and Chilean/international sources.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Ensure both writer role aliases exist and can authenticate / inherit cleanly
  await sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${WRITER_ROLE}') THEN
        CREATE ROLE ${WRITER_ROLE} WITH
          LOGIN
          INHERIT
          NOSUPERUSER
          NOCREATEDB
          NOCREATEROLE
          NOREPLICATION
          NOBYPASSRLS
          CONNECTION LIMIT 5;
      ELSE
        ALTER ROLE ${WRITER_ROLE} WITH LOGIN INHERIT CONNECTION LIMIT 5;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LEGACY_PRODUCT_ROLE}') THEN
        CREATE ROLE ${LEGACY_PRODUCT_ROLE} NOLOGIN;
      END IF;
    END
    $$;

    GRANT ${LEGACY_PRODUCT_ROLE} TO ${WRITER_ROLE};
    GRANT USAGE ON SCHEMA public TO ${WRITER_ROLE};
    GRANT SELECT, INSERT ON public.sources TO ${WRITER_ROLE};
    GRANT SELECT, INSERT ON public.prospective_content_rights_write_guards TO ${WRITER_ROLE};
    GRANT SELECT, INSERT ON public.live_source_policies TO ${WRITER_ROLE};
    GRANT SELECT, INSERT ON public.live_exposure_exclusions TO ${WRITER_ROLE};
    GRANT SELECT, INSERT ON public.live_acquisition_receipts TO ${WRITER_ROLE};
    GRANT SELECT, INSERT ON public.articles TO ${WRITER_ROLE};
    GRANT SELECT, INSERT ON public.live_article_versions TO ${WRITER_ROLE};
  `).execute(db);

  // 2. Enable Row Level Security across all 7 live ingestion tables
  await sql.raw(`
    ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.live_source_policies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.prospective_content_rights_write_guards ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.live_exposure_exclusions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.live_acquisition_receipts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.live_article_versions ENABLE ROW LEVEL SECURITY;
  `).execute(db);

  // 3. Ensure read policies exist for dialektik_core_app
  await sql.raw(`
    DROP POLICY IF EXISTS dialektik_govuk_core_read_live_source_policies ON public.live_source_policies;
    CREATE POLICY dialektik_govuk_core_read_live_source_policies ON public.live_source_policies
      FOR SELECT TO ${CORE_READ_ROLE} USING (true);

    DROP POLICY IF EXISTS dialektik_govuk_core_read_prospective_rights_guard ON public.prospective_content_rights_write_guards;
    CREATE POLICY dialektik_govuk_core_read_prospective_rights_guard ON public.prospective_content_rights_write_guards
      FOR SELECT TO ${CORE_READ_ROLE} USING (true);

    DROP POLICY IF EXISTS dialektik_govuk_core_read_live_exposure_exclusions ON public.live_exposure_exclusions;
    CREATE POLICY dialektik_govuk_core_read_live_exposure_exclusions ON public.live_exposure_exclusions
      FOR SELECT TO ${CORE_READ_ROLE} USING (true);

    DROP POLICY IF EXISTS dialektik_govuk_core_read_live_acquisition_receipts ON public.live_acquisition_receipts;
    CREATE POLICY dialektik_govuk_core_read_live_acquisition_receipts ON public.live_acquisition_receipts
      FOR SELECT TO ${CORE_READ_ROLE} USING (true);

    DROP POLICY IF EXISTS dialektik_govuk_core_read_live_article_versions ON public.live_article_versions;
    CREATE POLICY dialektik_govuk_core_read_live_article_versions ON public.live_article_versions
      FOR SELECT TO ${CORE_READ_ROLE} USING (true);
  `).execute(db);

  // 4. Replace single-item hardcoded writer policies with structural LIVE_REAL provenance policies
  await sql.raw(`
    -- sources
    DROP POLICY IF EXISTS dialektik_govuk_writer_source_select ON public.sources;
    DROP POLICY IF EXISTS dialektik_govuk_writer_source_insert ON public.sources;

    CREATE POLICY dialektik_govuk_writer_source_select ON public.sources
      FOR SELECT TO ${WRITER_ROLE}
      USING (origin = 'LIVE_REAL' AND canonical_domain IS NOT NULL AND name IS NOT NULL);

    CREATE POLICY dialektik_govuk_writer_source_insert ON public.sources
      FOR INSERT TO ${WRITER_ROLE}
      WITH CHECK (origin = 'LIVE_REAL' AND canonical_domain IS NOT NULL AND name IS NOT NULL);

    -- live_source_policies
    DROP POLICY IF EXISTS dialektik_govuk_writer_live_source_policy_select ON public.live_source_policies;
    DROP POLICY IF EXISTS dialektik_govuk_writer_live_source_policy_insert ON public.live_source_policies;

    CREATE POLICY dialektik_govuk_writer_live_source_policy_select ON public.live_source_policies
      FOR SELECT TO ${WRITER_ROLE}
      USING (active = true AND registry_key IS NOT NULL AND source_id IS NOT NULL);

    CREATE POLICY dialektik_govuk_writer_live_source_policy_insert ON public.live_source_policies
      FOR INSERT TO ${WRITER_ROLE}
      WITH CHECK (active = true AND registry_key IS NOT NULL AND source_id IS NOT NULL);

    -- prospective_content_rights_write_guards
    DROP POLICY IF EXISTS dialektik_govuk_writer_prospective_guard_select ON public.prospective_content_rights_write_guards;
    DROP POLICY IF EXISTS dialektik_govuk_writer_prospective_guard_insert ON public.prospective_content_rights_write_guards;

    CREATE POLICY dialektik_govuk_writer_prospective_guard_select ON public.prospective_content_rights_write_guards
      FOR SELECT TO ${WRITER_ROLE}
      USING (source_id IS NOT NULL);

    CREATE POLICY dialektik_govuk_writer_prospective_guard_insert ON public.prospective_content_rights_write_guards
      FOR INSERT TO ${WRITER_ROLE}
      WITH CHECK (source_id IS NOT NULL);

    -- live_exposure_exclusions
    DROP POLICY IF EXISTS dialektik_govuk_writer_exclusion_select ON public.live_exposure_exclusions;
    DROP POLICY IF EXISTS dialektik_govuk_writer_exclusion_insert ON public.live_exposure_exclusions;

    CREATE POLICY dialektik_govuk_writer_exclusion_select ON public.live_exposure_exclusions
      FOR SELECT TO ${WRITER_ROLE}
      USING (registry_key IS NOT NULL AND source_item_id IS NOT NULL AND canonical_url IS NOT NULL);

    CREATE POLICY dialektik_govuk_writer_exclusion_insert ON public.live_exposure_exclusions
      FOR INSERT TO ${WRITER_ROLE}
      WITH CHECK (registry_key IS NOT NULL AND source_item_id IS NOT NULL AND canonical_url IS NOT NULL);

    -- live_acquisition_receipts
    DROP POLICY IF EXISTS dialektik_govuk_writer_receipt_select ON public.live_acquisition_receipts;
    DROP POLICY IF EXISTS dialektik_govuk_writer_receipt_insert ON public.live_acquisition_receipts;

    CREATE POLICY dialektik_govuk_writer_receipt_select ON public.live_acquisition_receipts
      FOR SELECT TO ${WRITER_ROLE}
      USING (source_id IS NOT NULL AND source_item_id IS NOT NULL AND canonical_url IS NOT NULL);

    CREATE POLICY dialektik_govuk_writer_receipt_insert ON public.live_acquisition_receipts
      FOR INSERT TO ${WRITER_ROLE}
      WITH CHECK (source_id IS NOT NULL AND source_item_id IS NOT NULL AND canonical_url IS NOT NULL);

    -- articles
    DROP POLICY IF EXISTS dialektik_govuk_writer_article_select ON public.articles;
    DROP POLICY IF EXISTS dialektik_govuk_writer_article_insert ON public.articles;

    CREATE POLICY dialektik_govuk_writer_article_select ON public.articles
      FOR SELECT TO ${WRITER_ROLE}
      USING (origin = 'LIVE_REAL' AND source_id IS NOT NULL AND url_canonical IS NOT NULL);

    CREATE POLICY dialektik_govuk_writer_article_insert ON public.articles
      FOR INSERT TO ${WRITER_ROLE}
      WITH CHECK (
        origin = 'LIVE_REAL'
        AND source_id IS NOT NULL
        AND url_canonical IS NOT NULL
        AND text_original IS NOT NULL
        AND text_normalized IS NOT NULL
        AND (
          live_exposure_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.live_exposure_exclusions e
            WHERE e.id = articles.live_exposure_id
              AND e.canonical_url = articles.url_canonical
          )
        )
      );

    -- live_article_versions
    DROP POLICY IF EXISTS dialektik_govuk_writer_version_select ON public.live_article_versions;
    DROP POLICY IF EXISTS dialektik_govuk_writer_version_insert ON public.live_article_versions;

    CREATE POLICY dialektik_govuk_writer_version_select ON public.live_article_versions
      FOR SELECT TO ${WRITER_ROLE}
      USING (article_id IS NOT NULL AND receipt_id IS NOT NULL);

    CREATE POLICY dialektik_govuk_writer_version_insert ON public.live_article_versions
      FOR INSERT TO ${WRITER_ROLE}
      WITH CHECK (
        article_id IS NOT NULL
        AND receipt_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.articles a
          WHERE a.id = live_article_versions.article_id
            AND a.origin = 'LIVE_REAL'
        )
      );
  `).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    DROP POLICY IF EXISTS dialektik_govuk_writer_version_insert ON public.live_article_versions;
    DROP POLICY IF EXISTS dialektik_govuk_writer_version_select ON public.live_article_versions;
    DROP POLICY IF EXISTS dialektik_govuk_writer_article_insert ON public.articles;
    DROP POLICY IF EXISTS dialektik_govuk_writer_article_select ON public.articles;
    DROP POLICY IF EXISTS dialektik_govuk_writer_receipt_insert ON public.live_acquisition_receipts;
    DROP POLICY IF EXISTS dialektik_govuk_writer_receipt_select ON public.live_acquisition_receipts;
    DROP POLICY IF EXISTS dialektik_govuk_writer_exclusion_insert ON public.live_exposure_exclusions;
    DROP POLICY IF EXISTS dialektik_govuk_writer_exclusion_select ON public.live_exposure_exclusions;
    DROP POLICY IF EXISTS dialektik_govuk_writer_prospective_guard_insert ON public.prospective_content_rights_write_guards;
    DROP POLICY IF EXISTS dialektik_govuk_writer_prospective_guard_select ON public.prospective_content_rights_write_guards;
    DROP POLICY IF EXISTS dialektik_govuk_writer_live_source_policy_insert ON public.live_source_policies;
    DROP POLICY IF EXISTS dialektik_govuk_writer_live_source_policy_select ON public.live_source_policies;
    DROP POLICY IF EXISTS dialektik_govuk_writer_source_insert ON public.sources;
    DROP POLICY IF EXISTS dialektik_govuk_writer_source_select ON public.sources;
  `).execute(db);
}