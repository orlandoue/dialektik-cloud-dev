import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
create table public.corporate_live_source_connections (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references public.sources(id),
  sequence_number integer not null check (sequence_number > 0),
  rights_decision_id dialektik_ulid not null references public.personal_owner_source_rights_decisions(id),
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  channel_url text check (channel_url is null or (channel_url ~ '^https://' and length(channel_url) <= 2048)),
  discovery_channel text not null check (discovery_channel in ('rss_atom','news_sitemap','youtube_data_api_v3')),
  allowed_article_domains jsonb not null check (jsonb_typeof(allowed_article_domains)='array'
    and jsonb_array_length(allowed_article_domains) between 1 and 8),
  active boolean not null,
  approved_by dialektik_ulid not null references public.users(id),
  recorded_at timestamptz(3) not null check (recorded_at <= clock_timestamp()),
  unique(source_id,sequence_number)
);
create index corporate_live_source_connections_latest
  on public.corporate_live_source_connections(source_id,sequence_number desc);
create function public.dialektik_corporate_live_connection_append_only()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode='55000',message='corporate source connection history is append-only';
  end if;
  if new.sequence_number <> coalesce((select max(sequence_number)+1
      from public.corporate_live_source_connections where source_id=new.source_id),1) then
    raise exception using errcode='23514',message='corporate source connection sequence is invalid';
  end if;
  if not exists (
    select 1 from public.sources s
    where s.id=new.source_id
      and (lower(split_part(split_part(new.endpoint,'://',2),'/',1))=s.canonical_domain
        or lower(split_part(split_part(new.endpoint,'://',2),'/',1))='www.'||s.canonical_domain)
  ) then
    raise exception using errcode='23514',message='corporate source endpoint domain is invalid';
  end if;
  if exists(select 1 from jsonb_array_elements_text(new.allowed_article_domains) d
    where d.value !~ '^[a-z0-9.-]{1,253}$' or d.value like '.%' or d.value like '%.'
      or d.value like '%..%') then
    raise exception using errcode='23514',message='corporate article domain is invalid';
  end if;
  if not exists(select 1 from public.users where id=new.approved_by and role='editor') then
    raise exception using errcode='42501',message='corporate source connection requires an editor';
  end if;
  return new;
end;
$$;
create trigger corporate_live_source_connections_append_only
  before update or delete on public.corporate_live_source_connections
  for each row execute function public.dialektik_corporate_live_connection_append_only();
create trigger corporate_live_source_connections_no_truncate
  before truncate on public.corporate_live_source_connections
  for each statement execute function public.dialektik_corporate_live_connection_append_only();
create trigger corporate_live_source_connections_validate
  before insert on public.corporate_live_source_connections
  for each row execute function public.dialektik_corporate_live_connection_append_only();
alter table public.corporate_live_source_connections enable row level security;
revoke all on public.corporate_live_source_connections from public,anon,authenticated,service_role;
grant select on public.corporate_live_source_connections to dialektik_core_app;
create policy corporate_live_source_connections_core_read
  on public.corporate_live_source_connections for select to dialektik_core_app using(true);

create table public.corporate_live_source_poll_state (
  source_id dialektik_ulid primary key references public.sources(id),
  etag text check (etag is null or (length(etag)<=512 and position(chr(10) in etag)=0 and position(chr(13) in etag)=0)),
  last_modified text check (last_modified is null or (length(last_modified)<=128 and position(chr(10) in last_modified)=0 and position(chr(13) in last_modified)=0)),
  poll_interval_seconds integer not null check (poll_interval_seconds between 30 and 2592000),
  consecutive_failures smallint not null default 0 check (consecutive_failures between 0 and 12),
  last_http_status smallint check (last_http_status is null or last_http_status between 100 and 599),
  last_status text not null check (last_status ~ '^[A-Z0-9_]{1,64}$'),
  last_polled_at timestamptz(3),
  last_success_at timestamptz(3),
  next_poll_at timestamptz(3) not null,
  lease_until timestamptz(3),
  updated_at timestamptz(3) not null,
  check (last_success_at is null or last_polled_at is not null)
);
alter table public.corporate_live_source_poll_state enable row level security;
revoke all on public.corporate_live_source_poll_state from public,anon,authenticated,service_role;
grant select,insert,update on public.corporate_live_source_poll_state to dialektik_core_app;
create policy corporate_live_source_poll_state_core_read
  on public.corporate_live_source_poll_state for select to dialektik_core_app using(true);
create policy corporate_live_source_poll_state_core_insert
  on public.corporate_live_source_poll_state for insert to dialektik_core_app with check(true);
create policy corporate_live_source_poll_state_core_update
  on public.corporate_live_source_poll_state for update to dialektik_core_app using(true) with check(true);

create table public.corporate_live_metadata_backfill_attempts (
  source_id dialektik_ulid not null references public.sources(id),
  article_id dialektik_ulid not null references public.articles(id),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('EXCERPT_FOUND','NO_PUBLIC_DESCRIPTION','FETCH_BLOCKED')),
  attempted_at timestamptz(3) not null,
  retry_after timestamptz(3) not null,
  primary key(source_id,article_id,input_sha256,attempted_at)
);
alter table public.corporate_live_metadata_backfill_attempts enable row level security;
revoke all on public.corporate_live_metadata_backfill_attempts from public,anon,authenticated,service_role;
grant select,insert on public.corporate_live_metadata_backfill_attempts to dialektik_core_app;
create policy corporate_live_metadata_backfill_core_read
  on public.corporate_live_metadata_backfill_attempts for select to dialektik_core_app using(true);
create policy corporate_live_metadata_backfill_core_insert
  on public.corporate_live_metadata_backfill_attempts for insert to dialektik_core_app with check(true);
`;

const SEED = String.raw`
do $seed$
declare
  source_row record;
  old_decision record;
  decision_id dialektik_ulid;
  policy_id text;
  connection_id dialektik_ulid;
  connection_sequence integer;
  decision_sequence integer;
  now_value timestamptz(3);
  provider_hash text;
  route_hash text;
  allowed_domains jsonb;
  channel_url text;
  discovery_value text;
  registered integer := 0;
  editor_id dialektik_ulid := '01M4YDQK00ED1T0R0R1AND0VE1';
begin
  if not exists(select 1 from public.users where id=editor_id and role='editor' and status='active') then
    raise exception 'MIGRATION_066_EDITOR_NOT_ACTIVE';
  end if;
  select evidence_sha256 into provider_hash
    from public.personal_owner_provider_authorizations
    where owner_identity='orlandoue' and provider_type='llm_cloudflare_workers_ai'
      and model_id='@cf/meta/llama-3.1-8b-instruct' and decision_status='AUTHORIZED'
      and valid_from<=clock_timestamp() and (expires_at is null or expires_at>clock_timestamp())
    order by recorded_at desc,id desc limit 1;
  if provider_hash is null or provider_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'MIGRATION_066_PROVIDER_AUTHORIZATION_MISSING';
  end if;
  for source_row in
    select s.id::text as source_id,s.name,s.canonical_domain,s.source_type,
      lp.policy->>'endpoint' as endpoint,lp.policy->>'rightsEvidenceUrl' as rights_url,
      lp.policy->>'rightsReviewStatus' as rights_review_status,
      lp.rights_class,lp.storage_policy,lp.active,
      coalesce(lp.policy->>'language','es') as language
    from public.sources s
    join lateral(select p.* from public.live_source_policies p where p.source_id=s.id
      order by p.recorded_at desc,p.id desc limit 1) lp on true
    where s.origin='LIVE_REAL' and (
      s.canonical_domain in ('biobiochile.cl','ciperchile.cl','cooperativa.cl','diarioeldia.cl','elmostrador.cl','latercera.com')
      or s.canonical_domain='youtube.com')
    order by s.canonical_domain,s.name,s.id
  loop
    if source_row.active is distinct from true or source_row.rights_class<>'LIVE_READY'
      or source_row.storage_policy<>'METADATA_AND_FEED_EXCERPT'
      or source_row.rights_review_status<>'APPROVED'
      or source_row.endpoint is null or source_row.endpoint !~ '^https://'
      or source_row.endpoint='https://supabase.com'
      or source_row.rights_url is null or source_row.rights_url !~ '^https://' then
      raise exception 'MIGRATION_066_SOURCE_POLICY_NOT_APPROVED: %',source_row.canonical_domain;
    end if;
    select * into old_decision from public.personal_owner_source_rights_decisions
      where source_id=source_row.source_id::dialektik_ulid and owner_identity='orlandoue'
      order by sequence_number desc limit 1;
    if not found or old_decision.decision_status<>'AUTHORIZED'
      or old_decision.valid_from>clock_timestamp()
      or (old_decision.expires_at is not null and old_decision.expires_at<=clock_timestamp())
      or old_decision.scopes->>'acquisition'<>'true'
      or old_decision.scopes->>'metadata_storage'<>'true'
      or old_decision.scopes->>'excerpt_storage'<>'true'
      or old_decision.scopes->>'external_ai_transmission'<>'true'
      or old_decision.scopes->>'derived_semantic_persistence'<>'true'
      or old_decision.scopes->>'fulltext_acquisition'<>'false'
      or old_decision.scopes->>'fulltext_persistence'<>'false'
      or old_decision.rights_evidence_url is null
      or old_decision.rights_evidence_sha256 is null then
      raise exception 'MIGRATION_066_SOURCE_RIGHTS_NOT_AUTHORIZED: %',source_row.canonical_domain;
    end if;
    if old_decision.local_processing then
      decision_id := old_decision.id;
    else
      perform 1 from public.prospective_content_rights_write_guards
        where source_id=source_row.source_id::dialektik_ulid for update;
      if not found then raise exception 'MIGRATION_066_SOURCE_RIGHTS_GUARD_MISSING'; end if;
      select coalesce(max(sequence_number),0)+1 into decision_sequence
        from public.personal_owner_source_rights_decisions where source_id=source_row.source_id::dialektik_ulid;
      decision_id := public.dialektik_generate_ulid();
      now_value := clock_timestamp();
      insert into public.personal_owner_source_rights_decisions
        (id,owner_identity,source_id,sequence_number,publisher_identity,acquisition_method,rights_evidence_url,
         rights_evidence_sha256,scopes,attribution,restrictions,decision_status,decision_provenance,
         valid_from,expires_at,recorded_at,local_processing)
      values (decision_id,'orlandoue',source_row.source_id::dialektik_ulid,decision_sequence,
        old_decision.publisher_identity,old_decision.acquisition_method,old_decision.rights_evidence_url,
        old_decision.rights_evidence_sha256,old_decision.scopes,old_decision.attribution,
        old_decision.restrictions||jsonb_build_object('corporate_live_acquisition',true,
          'maximum_public_excerpt_characters',700,'fulltext_acquisition',false),
        'AUTHORIZED',left('EDITOR_APPROVED_CORPORATE_LIVE_ACQUISITION:'||editor_id::text||':'||old_decision.id::text,500),
        now_value,old_decision.expires_at,now_value,true);
    end if;

    policy_id := encode(extensions.digest(convert_to(
      'dialektik-live-semantic-excerpt-policy-v3'||E'\n'||source_row.source_id||E'\n'||decision_id::text||E'\n'||old_decision.rights_evidence_sha256,
      'UTF8'),'sha256'),'hex');
    now_value := clock_timestamp();
    insert into public.content_access_policies
      (id,source_id,content_access_mode,metadata_storage,excerpt_storage,fulltext_acquisition,
       fulltext_machine_processing,fulltext_persistence,derived_semantic_persistence,minimal_evidence_fragment,
       redisplay,external_source_link,evidence_quote_max_codepoints,rights_evidence_url,rights_verified_at,
       recorded_at,local_processing,external_ai_transmission,rights_evidence_sha256,
       personal_owner_source_rights_decision_id)
    values (policy_id,source_row.source_id::dialektik_ulid,'EXCERPT_EPHEMERAL',true,true,false,
      false,false,true,true,false,false,300,old_decision.rights_evidence_url,now_value,now_value,
      true,(old_decision.scopes->>'external_ai_transmission')::boolean,old_decision.rights_evidence_sha256,decision_id)
    on conflict(id) do nothing;
    route_hash := encode(extensions.digest(convert_to(old_decision.rights_evidence_sha256||E'\n'||
      provider_hash||E'\n'||policy_id||E'\nEXTERNAL_LLM_PROCESSING_ALLOWED','UTF8'),'sha256'),'hex');
    insert into public.live_semantic_source_route_grants
      (id,source_id,policy_id,provider_type,processing_route,fulltext_acquisition,machine_processing,
       derived_persistence,fulltext_persistence,evidence_fragments,rights_receipt_sha256,recorded_at)
    values (public.dialektik_generate_ulid(),source_row.source_id::dialektik_ulid,policy_id,
      'llm_cloudflare_workers_ai','EXTERNAL_LLM_PROCESSING_ALLOWED',false,true,true,false,true,route_hash,now_value)
    on conflict(source_id,policy_id,provider_type) do nothing;

    allowed_domains := jsonb_build_array(source_row.canonical_domain,'www.'||source_row.canonical_domain);
    discovery_value := case when source_row.canonical_domain='youtube.com' then 'youtube_data_api_v3'
      when source_row.canonical_domain='elmostrador.cl' then 'news_sitemap' else 'rss_atom' end;
    if source_row.canonical_domain='youtube.com' then
      channel_url := case when source_row.endpoint ~ 'channel_id=UC[A-Za-z0-9_-]{22}'
        then 'https://www.youtube.com/channel/'||substring(source_row.endpoint from 'channel_id=(UC[A-Za-z0-9_-]{22})')
        else 'https://www.youtube.com/' end;
    else channel_url := null; end if;
    select coalesce(max(sequence_number),0)+1 into connection_sequence
      from public.corporate_live_source_connections where source_id=source_row.source_id::dialektik_ulid;
    connection_id := public.dialektik_generate_ulid();
    insert into public.corporate_live_source_connections
      (id,source_id,sequence_number,rights_decision_id,endpoint,channel_url,discovery_channel,
       allowed_article_domains,active,approved_by,recorded_at)
    values (connection_id,source_row.source_id::dialektik_ulid,connection_sequence,decision_id,
      source_row.endpoint,channel_url,discovery_value,allowed_domains,true,editor_id,clock_timestamp());
    insert into public.corporate_live_source_poll_state
      (source_id,poll_interval_seconds,last_status,next_poll_at,updated_at)
    values (source_row.source_id::dialektik_ulid,
      case when source_row.canonical_domain='elmostrador.cl' then 30
        when source_row.canonical_domain='youtube.com' then 86400 else 900 end,
      'PENDING',clock_timestamp(),clock_timestamp())
    on conflict(source_id) do nothing;
    registered := registered+1;
  end loop;
  if registered<>38 then raise exception 'MIGRATION_066_SOURCE_COUNT_INVALID: %',registered; end if;
end;
$seed$;
`;

export const corporateLiveAcquisitionMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
    await sql.raw(SEED).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Corporate live acquisition decisions and connections are forward-only.');
  },
};
