import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
do $dependencies$
begin
  if not exists(select 1 from pg_roles where rolname='dialektik_corporate_live_writer')
    or to_regprocedure('public.dialektik_corporate_live_source_write_allowed(dialektik_ulid)') is null then
    raise exception 'MIGRATION_070_REQUIRED_CORPORATE_LIVE_DEPENDENCIES_MISSING';
  end if;
end;
$dependencies$;

-- Invalid or unapproved feed URLs are quarantined before article persistence.
-- Keep those source-item identities available to the restricted acquisition
-- writer only when the source still has an approved corporate-live grant.
drop policy if exists corporate_live_quarantine_exclusion_select on public.live_exposure_exclusions;
create policy corporate_live_quarantine_exclusion_select
  on public.live_exposure_exclusions for select to dialektik_corporate_live_writer
  using (
    canonical_url is null
    and source_item_id is not null
    and registry_key is not null
    and (reason like 'live_feed_quarantine:%' or reason='live_feed_source_item_identity')
    and exists (
      select 1
      from public.live_source_policies policy
      join public.sources source on source.id=policy.source_id
      where policy.registry_key=live_exposure_exclusions.registry_key
        and source.name=live_exposure_exclusions.publisher_name
        and public.dialektik_corporate_live_source_write_allowed(policy.source_id)
    )
  );

drop policy if exists corporate_live_quarantine_exclusion_insert on public.live_exposure_exclusions;
create policy corporate_live_quarantine_exclusion_insert
  on public.live_exposure_exclusions for insert to dialektik_corporate_live_writer
  with check (
    canonical_url is null
    and source_item_id is not null
    and registry_key is not null
    and (reason like 'live_feed_quarantine:%' or reason='live_feed_source_item_identity')
    and exists (
      select 1
      from public.live_source_policies policy
      join public.sources source on source.id=policy.source_id
      where policy.registry_key=live_exposure_exclusions.registry_key
        and source.name=live_exposure_exclusions.publisher_name
        and public.dialektik_corporate_live_source_write_allowed(policy.source_id)
    )
  );

-- Receipts for malformed or disallowed URLs remain auditable without making
-- those URLs eligible for persistence as articles.
drop policy if exists corporate_live_quarantine_receipt_select on public.live_acquisition_receipts;
create policy corporate_live_quarantine_receipt_select
  on public.live_acquisition_receipts for select to dialektik_corporate_live_writer
  using (
    canonical_url is null
    and source_item_id is not null
    and disposition='QUARANTINED'
    and error_code is not null
    and discovery_channel='rss_atom'
    and exists (
      select 1 from public.live_source_policies policy
      where policy.id=live_acquisition_receipts.policy_id
        and policy.source_id=live_acquisition_receipts.source_id
        and public.dialektik_corporate_live_source_write_allowed(policy.source_id)
    )
  );

drop policy if exists corporate_live_quarantine_receipt_insert on public.live_acquisition_receipts;
create policy corporate_live_quarantine_receipt_insert
  on public.live_acquisition_receipts for insert to dialektik_corporate_live_writer
  with check (
    canonical_url is null
    and source_item_id is not null
    and disposition='QUARANTINED'
    and error_code is not null
    and discovery_channel='rss_atom'
    and exists (
      select 1 from public.live_source_policies policy
      where policy.id=live_acquisition_receipts.policy_id
        and policy.source_id=live_acquisition_receipts.source_id
        and public.dialektik_corporate_live_source_write_allowed(policy.source_id)
    )
  );
`;

export const corporateLiveQuarantineIdentityDdl = { schema: SCHEMA } as const;

export const corporateLiveQuarantineIdentityMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(corporateLiveQuarantineIdentityDdl.schema).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Corporate live quarantine RLS must be reviewed and revoked explicitly.');
  },
};
