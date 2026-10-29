import { sql, type Migration } from 'kysely';

const UP = String.raw`
alter table public.live_acquisition_receipts
  add column if not exists discovery_channel_detail text;

do $$
begin
  if not exists (select 1 from pg_constraint
      where conrelid='public.live_acquisition_receipts'::regclass
        and conname='live_acquisition_receipts_discovery_channel_detail_check') then
    alter table public.live_acquisition_receipts
      add constraint live_acquisition_receipts_discovery_channel_detail_check
      check (discovery_channel_detail is null or discovery_channel_detail in (
        'rss_atom','official_api','govuk_content_api','news_sitemap'));
  end if;
end $$;

comment on column public.live_acquisition_receipts.discovery_channel_detail is
  'Precise discovery channel. The legacy discovery_channel column remains unchanged for compatibility.';
grant select (discovery_channel_detail)
  on table public.live_acquisition_receipts to dialektik_core_app;
`;

export const liveNewsSitemapChannelMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Acquisition provenance history must be preserved.');
  },
};
