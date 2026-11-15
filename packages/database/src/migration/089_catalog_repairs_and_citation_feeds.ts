import { sql, type Migration } from 'kysely';

// Catalog repairs found by services/core-api/scripts/discover-catalog-repairs.mjs
// on GitHub Actions (2026-11-15), each candidate checked with the production
// feed parser:
//
// * Seven press feeds whose only copyright marker is the publisher's own
//   feed-wide notice («Copyright 2026 The New York Times Company») and no
//   item-level marker are ingested as headline_and_citation_only: title, a
//   300-character excerpt to match and quote the occurrence, and the link to
//   the original. Item-level rights, credits and third-party upstreams are
//   still rejected item by item. NPR («For Personal Use Only») and CNN (feed
//   frozen since 2024, plain HTTP) stay off.
// * Four Spanish feeds moved to a working URL; seven YouTube channels were
//   found through the publisher's own site.
// Idempotent; it only changes rows that still need it.

export const CATALOG_REPAIRS = [
  // Publisher feed-wide notice accepted, citation-only ingestion.
  { slug: 'es-eldiario-es', type: 'RSS', citation: true },
  { slug: 'ar-clarin', type: 'RSS', citation: true },
  { slug: 'ar-perfil', type: 'RSS', citation: true },
  { slug: 'us-pbs-newshour', type: 'RSS', citation: true },
  { slug: 'us-the-new-york-times', type: 'RSS', citation: true },
  { slug: 'us-fox-news', type: 'RSS', citation: true },
  { slug: 'us-propublica', type: 'RSS', citation: true },
  // Working feed URLs (the catalog ones answered 404/406/HTML).
  { slug: 'es-libertad-digital', type: 'RSS', endpoint: 'https://www.libertaddigital.com/rss.xml' },
  { slug: 'es-la-sexta', type: 'RSS', endpoint: 'https://www.lasexta.com/rss/348128.xml' },
  { slug: 'es-antena-3-noticias', type: 'RSS', endpoint: 'https://www.antena3.com/noticias/rss/4013050.xml' },
  { slug: 'es-onda-cero', type: 'RSS', endpoint: 'https://www.ondacero.es/rss/8145.xml' },
  // Channels linked from the publisher's own site.
  { slug: 'es-el-confidencial', type: 'YOUTUBE', channel: 'UCY2hu_NT5NDbBU-HGxgqMuA' },
  { slug: 'ar-perfil', type: 'YOUTUBE', channel: 'UCl6L85YuyK4rVn5NI--dHUw' },
  { slug: 'ar-ambito-financiero', type: 'YOUTUBE', channel: 'UCXKphgduQN0dXiz_ioRTfeA' },
  { slug: 'ar-el-cronista', type: 'YOUTUBE', channel: 'UCZi6C9-a4fYKiBoIuEJ80ZA' },
  { slug: 'ar-tiempo-argentino', type: 'YOUTUBE', channel: 'UCE5zJG1lnng_dcuVE8MzEKg' },
  { slug: 'ar-el-destape', type: 'YOUTUBE', channel: 'UC5wAqJ9NF0fpGH9dVf3h6HA' },
  { slug: 'ar-cadena-3', type: 'YOUTUBE', channel: 'UCNxohbqfDp8YxW_Mji2XMHA' },
] as const;

export const catalogRepairsSql = String.raw`
alter table public.media_catalog_entries
  add column if not exists ingestion_mode text
    check (ingestion_mode is null or ingestion_mode = 'headline_and_citation_only'),
  add column if not exists publisher_copyright_notice text
    check (publisher_copyright_notice is null or publisher_copyright_notice = 'ACCEPTED');

-- The registration function records the citation-only mode in the policy.
do $patch$
declare
  definition text;
  anchor constant text := '  insert into public.live_source_policies (id,source_id,registry_key,rights_class,storage_policy,active,';
begin
  select pg_get_functiondef('public.dialektik_register_media_catalog_source(text,text)'::regprocedure) into definition;
  if position('ingestionMode' in definition) = 0 then
    if position(anchor in definition) = 0 then
      raise exception 'MIGRATION_089_REGISTER_FUNCTION_CHANGED';
    end if;
    execute replace(definition, anchor, $c$  if e.ingestion_mode = 'headline_and_citation_only' then
    policy_json := policy_json || jsonb_build_object(
      'ingestionMode', 'headline_and_citation_only',
      'publisherCopyrightNotice', e.publisher_copyright_notice,
      'excerptMaximumCharacters', 300,
      'rightsReviewNote', 'Owner media catalog: headline, a 300-character excerpt to match and quote the occurrence, and a link to the original. The feed-wide notice names the publisher itself; item-level rights and third-party credits are still rejected. Editorial policy decision, not a bilateral license.');
  end if;
$c$ || anchor);
  end if;
end
$patch$;

do $repairs$
declare
  r record;
  e public.media_catalog_entries%rowtype;
  v_host text;
  registered integer := 0;
begin
  for r in select * from jsonb_to_recordset($list$${JSON.stringify(CATALOG_REPAIRS)}$list$::jsonb)
      as x(slug text, type text, citation boolean, endpoint text, channel text) loop
    select * into e from public.media_catalog_entries where media_group_slug = r.slug and source_type = r.type for update;
    if not found then raise exception 'MIGRATION_089_ENTRY_MISSING: % %', r.slug, r.type; end if;
    if e.verification_status in ('ACTIVE', 'EXISTING_SOURCE') and e.source_id is not null then continue; end if;
    if r.type = 'RSS' then
      v_host := lower(split_part(split_part(coalesce(r.endpoint, e.feed_url), '://', 2), '/', 1));
      update public.media_catalog_entries set
        verification_status = 'ACTIVE',
        endpoint = coalesce(r.endpoint, e.feed_url),
        feed_host = case when v_host in (e.canonical_domain, 'www.' || e.canonical_domain) then null else v_host end,
        ingestion_mode = case when r.citation then 'headline_and_citation_only' end,
        publisher_copyright_notice = case when r.citation then 'ACCEPTED' end,
        verification_reason = case when r.citation
          then 'Only the publisher''s own feed-wide copyright notice; ingested headline_and_citation_only (2026-11-15)'
          else 'Working feed found on the publisher''s site (2026-11-15)' end,
        updated_at = clock_timestamp()
      where media_group_slug = r.slug and source_type = r.type;
    else
      if exists (select 1 from public.media_catalog_entries other where other.source_type = 'YOUTUBE'
          and other.youtube_channel_id = r.channel and other.media_group_slug <> r.slug
          and other.verification_status in ('ACTIVE', 'EXISTING_SOURCE')) then
        continue;
      end if;
      update public.media_catalog_entries set verification_status = 'ACTIVE', youtube_channel_id = r.channel,
        verification_reason = 'Channel linked from the publisher''s own site (2026-11-15)', updated_at = clock_timestamp()
      where media_group_slug = r.slug and source_type = r.type;
    end if;
    if public.dialektik_register_media_catalog_source(r.slug, r.type) = 'REGISTERED' then
      registered := registered + 1;
    end if;
  end loop;
  raise notice 'MIGRATION_089 registered=%', registered;
end
$repairs$;
`;

export const catalogRepairsMigration: Migration = {
  async up(db) { await sql.raw(catalogRepairsSql).execute(db); },
  async down() { throw new Error('Source rights history is forward-only.'); },
};
