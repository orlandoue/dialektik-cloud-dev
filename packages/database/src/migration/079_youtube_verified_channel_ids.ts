import { sql, type Migration } from 'kysely';

// IDs were resolved through channels.list on 2026-11-02 and matched to each publisher.
// Only append to the existing rights-approved corporate connection history.
export const youtubeVerifiedChannelIdsSql = String.raw`
do $migration$
declare mapping record; current_connection record; expected integer := 0;
begin
  for mapping in select * from (values
    ('01M4YDQK00YT09ADNRAD10CH11','UCczkrFICr0xEgDsk51zZojA'),
    ('01M4YDQK00YT05CNNCH11E0001','UCpOAcjJNAp0Y0fhznRrXIJQ'),
    ('01M4YDQK00YT08C00PERAT1VA1','UC13uZwIWmnmBJQuiTJWbVhQ'),
    ('01M4YDQK00YT15E1M0STRAD0R1','UCAOZvFm0xSBcom35r6-mcEA'),
    ('01M4YDQK00YT271ATERCERATV1','UCEQ_IiWGNvyvwSF3Sd-aQFA'),
    ('01M4YDQK00YT31P0DERJVD1C1A','UCo0C1-ocUG9a0Yb3iO0V-xg'),
    ('01M4YDQK00YT14RAD10DVNA001','UC2dUjKdv0sezxuflNK4w8Pg'),
    ('01M4YDQK00YT17THEC11N1CTV1','UCKr6ve0z-_k1bC_jW3TAWtA'),
    ('01M4YDQK00YT24TVRN0C0PAN01','UCoMBIlBDtaxuqUfTLzV6PDQ')
  ) as ids(source_id,channel_id)
  loop
    select c.* into current_connection from public.corporate_live_source_connections c
      join public.sources s on s.id=c.source_id and s.canonical_domain='youtube.com' and s.origin='LIVE_REAL'
      where c.source_id=mapping.source_id::dialektik_ulid order by c.sequence_number desc limit 1;
    if not found or not current_connection.active or current_connection.discovery_channel <> 'youtube_data_api_v3' then
      raise exception 'YOUTUBE_CORPORATE_CONNECTION_MISSING: %',mapping.source_id;
    end if;
    if current_connection.channel_url = 'https://www.youtube.com/channel/' || mapping.channel_id then
      expected := expected + 1; continue;
    end if;
    if current_connection.channel_url <> 'https://www.youtube.com/' then
      raise exception 'YOUTUBE_CORPORATE_CHANNEL_CHANGED: %',mapping.source_id;
    end if;
    insert into public.corporate_live_source_connections
      (id,source_id,sequence_number,rights_decision_id,endpoint,channel_url,discovery_channel,allowed_article_domains,active,approved_by,recorded_at)
    values (public.dialektik_generate_ulid(),current_connection.source_id,current_connection.sequence_number+1,
      current_connection.rights_decision_id,current_connection.endpoint,'https://www.youtube.com/channel/' || mapping.channel_id,
      current_connection.discovery_channel,current_connection.allowed_article_domains,true,current_connection.approved_by,date_trunc('milliseconds',clock_timestamp()));
    expected := expected + 1;
  end loop;
  if expected <> 9 then raise exception 'YOUTUBE_CHANNEL_MAPPING_INCOMPLETE'; end if;
end $migration$;
`;
export const youtubeVerifiedChannelIdsMigration: Migration = {
  async up(db) { await sql.raw(youtubeVerifiedChannelIdsSql).execute(db); },
  async down() { throw new Error('Corporate source connection history is append-only.'); },
};
