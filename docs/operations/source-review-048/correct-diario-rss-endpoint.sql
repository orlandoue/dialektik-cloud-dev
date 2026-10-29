-- Append a source policy with the feed used by the existing live RSS preview.
-- Preserve the owner's rights decision and the existing provenance quarantine.
begin;
do $guard$
begin
  if (select id from live_source_policies
      where source_id = '01M4YDQK00CH100D1AR10E1D1A'
      order by recorded_at desc, id desc limit 1)
      is distinct from 'dd13cb3810e306e431dbafaabe16051fdab237311118da0865c7ea1ea4d6ebcd'
  then raise exception 'SOURCE_POLICY_CHANGED'; end if;
end
$guard$;
insert into live_source_policies(id,source_id,registry_key,rights_class,storage_policy,active,
  rights_evidence_url,rights_verified_at,policy,recorded_at)
select encode(sha256(convert_to('verified-el-dia-rss-noticias:' || id,'UTF8')),'hex'),
  source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,rights_verified_at,
  jsonb_set(policy,'{endpoint}',to_jsonb('https://www.diarioeldia.cl/rss/noticias/'::text),true),
  greatest(clock_timestamp(), recorded_at + interval '1 millisecond')
from live_source_policies
where id = 'dd13cb3810e306e431dbafaabe16051fdab237311118da0865c7ea1ea4d6ebcd'
  and source_id = '01M4YDQK00CH100D1AR10E1D1A';
commit;
