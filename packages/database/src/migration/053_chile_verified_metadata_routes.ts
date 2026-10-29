import { sql, type Migration } from 'kysely';

const UP = String.raw`
do $$
begin
  if not exists (select 1 from public.sources where id='01M4YDQK00CH1000B10B10CH11'
      and name='BioBioChile' and canonical_domain='biobiochile.cl' and origin='LIVE_REAL')
    or not exists (select 1 from public.sources where id='01M4YDQK00CH100E1M0STRAD0R'
      and name='El Mostrador' and canonical_domain='elmostrador.cl' and origin='LIVE_REAL') then
    raise exception 'Chile source identities do not match the reviewed metadata routes';
  end if;
  if (select id from public.live_source_policies where source_id='01M4YDQK00CH1000B10B10CH11'
      order by recorded_at desc,id desc limit 1) not in (
        '54503d6ec3f1322c62523499a0a2f9f947a9a1abb53d51a1965dd818aca893e6',
        'b61ce396a797d247d8f9644f7a342d6d2b917f10265b8952e742c21bb7db8b45')
    or (select id from public.live_source_policies where source_id='01M4YDQK00CH100E1M0STRAD0R'
      order by recorded_at desc,id desc limit 1) not in (
        '693875eda3947368d0406ae1a2c45e314982db2b4d7a19c6ac5bae558921c01e',
        '7c114b89687ebfea00f312ebd500ed92ac6c0196315bae11743cd2c2243908dd') then
    raise exception 'Unexpected latest source policy; inspect before adding a metadata route';
  end if;
  if exists (select 1 from public.live_source_policies where id in (
      '54503d6ec3f1322c62523499a0a2f9f947a9a1abb53d51a1965dd818aca893e6',
      '693875eda3947368d0406ae1a2c45e314982db2b4d7a19c6ac5bae558921c01e')
      and (not active or rights_class<>'LIVE_READY' or storage_policy<>'METADATA_ONLY'
        or policy->>'rightsReviewStatus'<>'APPROVED')) then
    raise exception 'The existing source review is not active or metadata-only';
  end if;
end $$;

insert into public.live_source_policies (
  id,source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,
  rights_verified_at,policy,recorded_at
)
select 'b61ce396a797d247d8f9644f7a342d6d2b917f10265b8952e742c21bb7db8b45',
  s.id,'chile-rss-biobiochile-v1','LIVE_READY','METADATA_ONLY',true,
  'https://www.bcn.cl/leychile/navegar?idNorma=28933','2026-10-29T00:00:00Z',
  '{"sourceId":"01M4YDQK00CH1000B10B10CH11","registryKey":"chile-rss-biobiochile-v1","publisherName":"BioBioChile","canonicalDomain":"biobiochile.cl","sourceType":"radio","publisherFamily":"BioBioChile","category":"news","discoveryChannel":"rss_atom","endpoint":"https://www.biobiochile.cl/static/feed-rss","rightsClass":"LIVE_READY","storagePolicy":"METADATA_ONLY","active":true,"rightsEvidenceUrl":"https://www.bcn.cl/leychile/navegar?idNorma=28933","rightsVerifiedAt":"2026-10-29T00:00:00.000Z","attribution":"BioBioChile; titular, fecha y enlace canónico. Sin extracto ni cuerpo.","language":"es","allowedArticleDomains":["biobiochile.cl","www.biobiochile.cl"],"market":"CL","rightsReviewStatus":"APPROVED","authorizationReference":"CL-LEY-17336-ART38-71B-METADATA-BIOBIO-2026","rightsModel":"PUBLIC_RSS_METADATA_ONLY_NO_BILATERAL_CONTRACT","externalAiTransmissionAllowed":false}'::jsonb,
  greatest(clock_timestamp(),coalesce((select max(recorded_at)+interval '1 millisecond'
    from public.live_source_policies where source_id=s.id),clock_timestamp()))
from public.sources s where s.id='01M4YDQK00CH1000B10B10CH11'
  and not exists (select 1 from public.live_source_policies where id='b61ce396a797d247d8f9644f7a342d6d2b917f10265b8952e742c21bb7db8b45')
on conflict (id) do nothing;

insert into public.live_source_policies (
  id,source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,
  rights_verified_at,policy,recorded_at
)
select '7c114b89687ebfea00f312ebd500ed92ac6c0196315bae11743cd2c2243908dd',
  s.id,'chile-rss-elmostrador-v1','LIVE_READY','METADATA_ONLY',true,
  'https://www.bcn.cl/leychile/navegar?idNorma=28933','2026-10-29T00:00:00Z',
  '{"sourceId":"01M4YDQK00CH100E1M0STRAD0R","registryKey":"chile-rss-elmostrador-v1","publisherName":"El Mostrador","canonicalDomain":"elmostrador.cl","sourceType":"digital_native","publisherFamily":"El Mostrador","category":"news","discoveryChannel":"news_sitemap","endpoint":"https://www.elmostrador.cl/sitemap_news.xml","rightsClass":"LIVE_READY","storagePolicy":"METADATA_ONLY","active":true,"rightsEvidenceUrl":"https://www.bcn.cl/leychile/navegar?idNorma=28933","rightsVerifiedAt":"2026-10-29T00:00:00.000Z","attribution":"El Mostrador; titular, fecha y enlace canónico. Sin extracto ni cuerpo.","language":"es","allowedArticleDomains":["elmostrador.cl","www.elmostrador.cl"],"market":"CL","rightsReviewStatus":"APPROVED","authorizationReference":"CL-LEY-17336-ART38-71B-METADATA-ELMOSTRADOR-2026","rightsModel":"PUBLIC_RSS_METADATA_ONLY_NO_BILATERAL_CONTRACT","externalAiTransmissionAllowed":false}'::jsonb,
  greatest(clock_timestamp(),coalesce((select max(recorded_at)+interval '1 millisecond'
    from public.live_source_policies where source_id=s.id),clock_timestamp()))
from public.sources s where s.id='01M4YDQK00CH100E1M0STRAD0R'
  and not exists (select 1 from public.live_source_policies where id='7c114b89687ebfea00f312ebd500ed92ac6c0196315bae11743cd2c2243908dd')
on conflict (id) do nothing;
`;

export const chileVerifiedMetadataRoutesMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Source policy and receipt history is append-only.');
  },
};
