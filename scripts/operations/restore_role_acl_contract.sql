-- Only fixed code PASS or FAIL. No user records, role secrets or identifiers selected.
-- Tested against read-only current DEV role/RLS matrix on 2026-10-21.
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dialektik_core_app'
          AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls)
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dialektik_govuk_metadata_writer'
          AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls)
  AND has_table_privilege('dialektik_core_app','public.articles','SELECT')
  AND has_table_privilege('dialektik_core_app','public.sources','SELECT')
  AND NOT has_table_privilege('dialektik_core_app','public.articles','INSERT')
  AND NOT has_table_privilege('dialektik_govuk_metadata_writer','public.articles','INSERT')
  AND NOT has_table_privilege('dialektik_govuk_metadata_writer','public.articles','UPDATE')
  AND NOT has_table_privilege('dialektik_govuk_metadata_writer','public.articles','DELETE')
  AND NOT has_table_privilege('dialektik_govuk_metadata_writer','public.events','INSERT')
  AND NOT has_table_privilege('dialektik_govuk_metadata_writer','public.semantic_occurrences','INSERT')
  AND EXISTS (SELECT 1 FROM pg_class WHERE oid='public.articles'::regclass
              AND relrowsecurity)
  AND EXISTS (SELECT 1 FROM pg_class WHERE oid='public.sources'::regclass
              AND relrowsecurity)
THEN 'PASS' ELSE 'FAIL' END;
