-- Applied to dialektik-dev on 2026-10-28 UTC. Retained for review and recovery.
-- Restore independent CHECK constraints from migrations 017, 018 and 022.
-- Refuses to replace existing constraints. No existing rows are modified.
-- Two constraints are NOT VALID because historical rows need reconciliation.
-- articles_live_origin_exclusion is intentionally separate: it conflicts with
-- the current Event-to-Article read design and requires an explicit resolution.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  expected record;
begin
  for expected in select * from (values
    ('sources', 'sources_origin_check'),
    ('articles', 'articles_origin_check'),
    ('live_source_policies', 'live_source_policies_id_check'),
    ('live_source_policies', 'live_source_policies_rights_class_check'),
    ('live_source_policies', 'live_source_policies_storage_policy_check'),
    ('live_source_policies', 'live_source_policies_rights_evidence_url_check'),
    ('live_source_policies', 'live_source_policies_check'),
    ('live_exposure_exclusions', 'live_exposure_exclusions_id_check'),
    ('live_exposure_exclusions', 'live_exposure_exclusions_content_hash_check'),
    ('live_exposure_exclusions', 'live_exposure_exclusions_exclusion_status_check'),
    ('live_exposure_exclusions', 'live_exposure_exclusions_check'),
    ('live_acquisition_receipts', 'live_acquisition_receipts_discovery_channel_check'),
    ('live_acquisition_receipts', 'live_acquisition_receipts_raw_payload_hash_check'),
    ('live_acquisition_receipts', 'live_acquisition_receipts_disposition_check'),
    ('live_article_versions', 'live_article_versions_version_number_check'),
    ('live_article_versions', 'live_article_versions_metadata_hash_check'),
    ('live_article_versions', 'live_article_versions_headline_check'),
    ('live_article_versions', 'live_article_versions_content_hash_check'),
    ('prospective_content_rights_write_guards', 'prospective_content_rights_write_guards_revision_check')
  ) as checks(table_name, constraint_name)
  loop
    if exists (
      select 1 from pg_constraint c
      where c.conrelid = format('public.%I', expected.table_name)::regclass
        and c.conname = expected.constraint_name
    ) then
      raise exception 'Constraint %.% already exists; inspect before restoration',
        expected.table_name, expected.constraint_name;
    end if;
  end loop;
end
$$;

alter table public.sources add constraint sources_origin_check
  check (origin in ('FIXTURE', 'STRESS_SYNTHETIC', 'LIVE_REAL'));
alter table public.articles add constraint articles_origin_check
  check (origin in ('FIXTURE', 'STRESS_SYNTHETIC', 'LIVE_REAL'));

alter table public.live_source_policies add constraint live_source_policies_id_check
  check (id ~ '^[0-9a-f]{64}$');
alter table public.live_source_policies add constraint live_source_policies_rights_class_check
  check (rights_class in ('LIVE_READY', 'DISCOVERY_ONLY', 'LICENSE_REQUIRED', 'PERMISSION_REQUIRED',
    'PROHIBITED_OR_UNSAFE', 'TECHNICALLY_UNRELIABLE'));
alter table public.live_source_policies add constraint live_source_policies_storage_policy_check
  check (storage_policy in ('METADATA_ONLY', 'METADATA_AND_FEED_EXCERPT'));
alter table public.live_source_policies add constraint live_source_policies_rights_evidence_url_check
  check (rights_evidence_url ~ '^https://');
alter table public.live_source_policies add constraint live_source_policies_check
  check (not active or rights_class = 'LIVE_READY');

-- 19 existing exclusions have non-SHA-256 IDs; protect future rows first.
alter table public.live_exposure_exclusions add constraint live_exposure_exclusions_id_check
  check (id ~ '^[0-9a-f]{64}$') not valid;
alter table public.live_exposure_exclusions add constraint live_exposure_exclusions_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');
alter table public.live_exposure_exclusions add constraint live_exposure_exclusions_exclusion_status_check
  check (exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2');
alter table public.live_exposure_exclusions add constraint live_exposure_exclusions_check
  check (canonical_url is not null or source_item_id is not null);

-- Four existing receipts use a nonstandard channel; protect future rows first.
alter table public.live_acquisition_receipts add constraint live_acquisition_receipts_discovery_channel_check
  check (discovery_channel in ('rss_atom', 'official_api')) not valid;
alter table public.live_acquisition_receipts add constraint live_acquisition_receipts_raw_payload_hash_check
  check (raw_payload_hash ~ '^[0-9a-f]{64}$');
alter table public.live_acquisition_receipts add constraint live_acquisition_receipts_disposition_check
  check (disposition in ('PERSISTED', 'QUARANTINED'));

alter table public.live_article_versions add constraint live_article_versions_version_number_check
  check (version_number > 0);
alter table public.live_article_versions add constraint live_article_versions_metadata_hash_check
  check (metadata_hash ~ '^[0-9a-f]{64}$');
alter table public.live_article_versions add constraint live_article_versions_headline_check
  check (btrim(headline) <> '');
alter table public.live_article_versions add constraint live_article_versions_content_hash_check
  check (content_hash ~ '^[0-9a-f]{64}$');

alter table public.prospective_content_rights_write_guards
  add constraint prospective_content_rights_write_guards_revision_check check (revision >= 0);

commit;
