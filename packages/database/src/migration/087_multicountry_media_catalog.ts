import { sql, type Migration } from 'kysely';

import { EXISTING_SOURCE_PROFILES, MEDIA_CATALOG_ENTRIES } from './087_multicountry_media_catalog.data.js';

// Multi-country media catalog (CL, ES, AR, US).
//
// * media_catalog_entries keeps every row of the owner's verified catalog,
//   including the ones that are not ingested yet and why (verification of
//   2026-11-14, services/core-api/data/*.verification.json).
// * media_source_profiles gives every ingested source its country, media
//   group and editorial lean; the semantic engine and the public API read it.
// * Active rows are registered through the same rights chain as the Chilean
//   sources (live policy, owner rights decision, excerpt content policy,
//   Workers AI route grant, corporate connection and poll state). It records
//   the owner's editorial decision for public feed metadata and short
//   publisher-provided excerpts; it is not a bilateral licence.
// * YouTube is read from each channel's native Atom feed (no API quota).
//   Existing Chilean channels that used the Data API move to their Atom feed.
// * Idempotent: every statement can run again without duplicating rows.

const LEANS = [
  'progresista/izquierda', 'centro-izquierda', 'centro', 'centro/agencia neutral',
  'centro-derecha', 'conservador/derecha', 'periodismo de investigacion/economico',
] as const;
const leanList = LEANS.map((lean) => `'${lean}'`).join(',');

const json = (value: unknown) => {
  const text = JSON.stringify(value);
  if (text.includes('$catalog$')) throw new Error('Catalog JSON cannot contain the dollar-quote tag.');
  return `$catalog$${text}$catalog$::jsonb`;
};

export const multicountryMediaCatalogSql = String.raw`
-- 1. Storage --------------------------------------------------------------
create table if not exists public.media_catalog_entries (
  media_group_slug text not null check (media_group_slug ~ '^(cl|es|ar|us)-[a-z0-9]+(-[a-z0-9]+)*$'),
  source_type text not null check (source_type in ('RSS','YOUTUBE')),
  country_code text not null check (country_code in ('CL','ES','AR','US')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  feed_url text not null check (char_length(feed_url) <= 2048),
  website_url text not null check (website_url ~ '^https://' and char_length(website_url) <= 2048),
  youtube_handle text check (youtube_handle is null or youtube_handle ~ '^@[A-Za-z0-9._-]{1,100}$'),
  youtube_channel_id text check (youtube_channel_id is null or youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  editorial_lean text not null check (editorial_lean in (${leanList})),
  category text not null check (char_length(category) <= 40),
  language text not null check (language in ('es','en')),
  catalog_active boolean not null,
  verification_status text not null check (verification_status in ('ACTIVE','EXISTING_SOURCE','PENDING_CHANNEL',
    'INACTIVE_UNREACHABLE','INACTIVE_RIGHTS_MARKER','INACTIVE_STALE','INACTIVE_PARSER','DUPLICATE_CHANNEL')),
  verification_reason text check (verification_reason is null or char_length(verification_reason) <= 300),
  endpoint text check (endpoint is null or (endpoint ~ '^https://' and char_length(endpoint) <= 2048)),
  feed_host text check (feed_host is null or feed_host ~ '^[a-z0-9.-]{1,253}$'),
  duplicate_of text,
  existing_registry_key text,
  planned_source_id dialektik_ulid,
  source_id dialektik_ulid references public.sources(id),
  source_name text not null,
  source_kind source_type not null,
  canonical_domain text not null check (canonical_domain ~ '^[a-z0-9.-]{1,253}$'),
  allowed_domains jsonb not null check (jsonb_typeof(allowed_domains)='array'),
  registry_key text not null check (registry_key ~ '^[a-z0-9-]{1,120}$'),
  rights_url text not null check (rights_url ~ '^https://'),
  authorization_reference text not null check (char_length(authorization_reference) <= 160),
  resolution_attempts integer not null default 0 check (resolution_attempts >= 0),
  last_resolution_at timestamptz(3),
  last_resolution_status text check (last_resolution_status is null or last_resolution_status ~ '^[A-Z0-9_]{1,64}$'),
  updated_at timestamptz(3) not null default clock_timestamp(),
  primary key (media_group_slug, source_type)
);

create table if not exists public.media_source_profiles (
  source_id dialektik_ulid primary key references public.sources(id),
  country_code text not null check (country_code in ('CL','ES','AR','US')),
  media_group_slug text not null check (media_group_slug ~ '^(cl|es|ar|us)-[a-z0-9]+(-[a-z0-9]+)*$'),
  media_group_name text not null check (char_length(media_group_name) between 1 and 120),
  editorial_lean text check (editorial_lean is null or editorial_lean in (${leanList})),
  modality text not null check (modality in ('RSS','YOUTUBE','SITEMAP','OFFICIAL')),
  language text not null default 'es' check (language in ('es','en')),
  semantic_enabled boolean not null default true,
  updated_at timestamptz(3) not null default clock_timestamp()
);
create index if not exists media_source_profiles_by_country
  on public.media_source_profiles(country_code, media_group_slug);

-- Feed hosts that differ from the publisher's own domain (a CDN), approved
-- per source. The corporate connection trigger accepts them.
create table if not exists public.media_source_feed_hosts (
  source_id dialektik_ulid not null references public.sources(id),
  host text not null check (host ~ '^[a-z0-9.-]{1,253}$'),
  primary key (source_id, host)
);

alter table public.media_catalog_entries enable row level security;
alter table public.media_source_profiles enable row level security;
alter table public.media_source_feed_hosts enable row level security;
revoke all on public.media_catalog_entries from public, anon, authenticated;
revoke all on public.media_source_profiles from public, anon, authenticated;
revoke all on public.media_source_feed_hosts from public, anon, authenticated;

do $grants$
declare role_name text;
begin
  foreach role_name in array array['dialektik_core_app','dialektik_headline_ai_writer',
    'dialektik_moderation_writer','dialektik_corporate_live_writer'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant select on public.media_source_profiles to %I', role_name);
      execute format('grant select on public.media_catalog_entries to %I', role_name);
      if not exists (select 1 from pg_policies where tablename='media_source_profiles' and policyname='media_source_profiles_read_'||role_name) then
        execute format('create policy %I on public.media_source_profiles for select to %I using (true)',
          'media_source_profiles_read_'||role_name, role_name);
      end if;
      if not exists (select 1 from pg_policies where tablename='media_catalog_entries' and policyname='media_catalog_entries_read_'||role_name) then
        execute format('create policy %I on public.media_catalog_entries for select to %I using (true)',
          'media_catalog_entries_read_'||role_name, role_name);
      end if;
    end if;
  end loop;
end
$grants$;

-- 2. Governance patches (applied to whatever definition is live) -----------
do $patch$
declare
  definition text;
  old_clause constant text := $c$s.canonical_domain in ('biobiochile.cl','ciperchile.cl','cooperativa.cl','diarioeldia.cl','elmostrador.cl','latercera.com','youtube.com')$c$;
  old_host constant text := $c$or (s.canonical_domain='biobiochile.cl'$c$;
begin
  select pg_get_functiondef('public.dialektik_live_semantic_source_allowed(dialektik_ulid)'::regprocedure) into definition;
  if position('media_source_profiles' in definition) = 0 then
    if position(old_clause in definition) = 0 then
      raise exception 'MIGRATION_087_SEMANTIC_SOURCE_FUNCTION_CHANGED';
    end if;
    execute replace(definition, old_clause, '(' || old_clause ||
      $c$ or exists(select 1 from public.media_source_profiles mp where mp.source_id=s.id and mp.semantic_enabled))$c$);
  end if;

  select pg_get_functiondef('public.dialektik_corporate_live_connection_append_only()'::regprocedure) into definition;
  if position('media_source_feed_hosts' in definition) = 0 then
    if position(old_host in definition) = 0 then
      raise exception 'MIGRATION_087_CONNECTION_FUNCTION_CHANGED';
    end if;
    execute replace(definition, old_host,
      $c$or exists(select 1 from public.media_source_feed_hosts h where h.source_id=s.id
          and h.host=lower(split_part(split_part(new.endpoint,'://',2),'/',1)))
        $c$ || old_host);
  end if;
end
$patch$;

-- 3. Registration of one catalog row through the full rights chain ---------
create or replace function public.dialektik_register_media_catalog_source(p_slug text, p_type text)
returns text language plpgsql security definer
set search_path = pg_catalog, public, extensions as $fn$
declare
  e public.media_catalog_entries%rowtype;
  sid dialektik_ulid;
  endpoint text;
  channel_url text;
  policy_id text;
  policy_json jsonb;
  scopes jsonb := jsonb_build_object('acquisition',true,'metadata_storage',true,'excerpt_storage',true,
    'fulltext_acquisition',false,'fulltext_persistence',false,'external_ai_transmission',true,
    'derived_semantic_persistence',true,'redisplay',false);
  provenance constant text := 'OWNER_MEDIA_CATALOG_2026_11_MULTICOUNTRY';
  decision record;
  decision_id dialektik_ulid;
  rights_hash text;
  content_policy text;
  provider_hash text;
  current_connection record;
  editor_id constant dialektik_ulid := '01M4YDQK00ED1T0R0R1AND0VE1';
  stamp timestamptz(3);
begin
  select * into e from public.media_catalog_entries where media_group_slug = p_slug and source_type = p_type for update;
  if not found then raise exception 'MEDIA_CATALOG_ENTRY_MISSING: % %', p_slug, p_type; end if;
  if e.verification_status <> 'ACTIVE' then return 'NOT_ACTIVE'; end if;
  if e.planned_source_id is null then raise exception 'MEDIA_CATALOG_SOURCE_ID_MISSING: %', p_slug; end if;
  sid := e.planned_source_id;
  if p_type = 'YOUTUBE' then
    if e.youtube_channel_id is null then return 'CHANNEL_PENDING'; end if;
    endpoint := 'https://www.youtube.com/feeds/videos.xml?channel_id=' || e.youtube_channel_id;
    channel_url := 'https://www.youtube.com/channel/' || e.youtube_channel_id;
  else
    endpoint := e.endpoint;
    channel_url := null;
  end if;

  -- Source identity.
  insert into public.sources (id,name,source_type,is_issuing_entity,canonical_domain,created_at,origin)
  values (sid, e.source_name, e.source_kind, false, e.canonical_domain, clock_timestamp(), 'LIVE_REAL')
  on conflict (id) do nothing;
  if not exists (select 1 from public.sources where id = sid and origin = 'LIVE_REAL'
      and canonical_domain = e.canonical_domain) then
    raise exception 'MEDIA_CATALOG_SOURCE_IDENTITY_CONFLICT: %', p_slug;
  end if;
  if e.feed_host is not null then
    insert into public.media_source_feed_hosts (source_id, host) values (sid, e.feed_host) on conflict do nothing;
  end if;

  -- Live source policy (append-only; a new endpoint is a new version).
  policy_id := encode(digest(convert_to('dialektik-media-catalog-policy-v1' || E'\n' || sid || E'\n' || endpoint, 'UTF8'), 'sha256'), 'hex');
  policy_json := jsonb_build_object(
    'sourceId', sid, 'registryKey', e.registry_key, 'publisherName', e.source_name,
    'canonicalDomain', e.canonical_domain, 'sourceType', e.source_kind::text, 'publisherFamily', e.display_name,
    'category', e.category, 'discoveryChannel', 'rss_atom', 'endpoint', endpoint, 'channelUrl', channel_url,
    'rightsClass', 'LIVE_READY', 'storagePolicy', 'METADATA_AND_FEED_EXCERPT', 'active', true,
    'rightsEvidenceUrl', e.rights_url, 'rightsVerifiedAt', '2026-11-14T00:00:00.000Z',
    'attribution', e.source_name || '; title, date, publisher-provided feed excerpt and canonical link.',
    'language', e.language, 'allowedArticleDomains', e.allowed_domains, 'market', e.country_code,
    'mediaGroupSlug', e.media_group_slug, 'editorialLean', e.editorial_lean,
    'rightsReviewStatus', 'APPROVED', 'authorizationReference', e.authorization_reference,
    'rightsRegime', 'PUBLIC_RSS_METADATA_ONLY_NO_BILATERAL_CONTRACT', 'excerptMaximumCharacters', 700,
    'externalAiTransmissionAllowed', true,
    'rightsReviewNote', 'Owner media catalog of 2026-11-14: public feed metadata and publisher-provided excerpts capped at 700 characters; editorial policy decision, not a bilateral license.');
  insert into public.live_source_policies (id,source_id,registry_key,rights_class,storage_policy,active,
    rights_evidence_url,rights_verified_at,policy,recorded_at)
  select policy_id, sid, e.registry_key, 'LIVE_READY', 'METADATA_AND_FEED_EXCERPT', true, e.rights_url,
    '2026-11-14T00:00:00Z', policy_json,
    greatest(clock_timestamp(), coalesce((select max(recorded_at) + interval '1 millisecond'
      from public.live_source_policies where source_id = sid), clock_timestamp()))
  where not exists (select 1 from public.live_source_policies where id = policy_id);

  -- Owner rights decision (one per source for this catalog).
  select * into decision from public.personal_owner_source_rights_decisions
    where source_id = sid and owner_identity = 'orlandoue' order by sequence_number desc limit 1;
  if found and decision.decision_provenance = provenance and decision.decision_status = 'AUTHORIZED'
      and decision.local_processing and (decision.expires_at is null or decision.expires_at > clock_timestamp()) then
    decision_id := decision.id;
    rights_hash := decision.rights_evidence_sha256;
  else
    rights_hash := encode(digest(convert_to(jsonb_build_object('sourceId', sid, 'name', e.source_name,
      'evidenceUrl', e.rights_url, 'scopes', scopes, 'decision', provenance, 'approvedBy', 'orlandoue',
      'reference', e.authorization_reference)::text, 'UTF8'), 'sha256'), 'hex');
    decision_id := public.dialektik_generate_ulid();
    stamp := clock_timestamp() - interval '1 second';
    insert into public.personal_owner_source_rights_decisions
      (id,owner_identity,source_id,sequence_number,publisher_identity,acquisition_method,rights_evidence_url,
       rights_evidence_sha256,scopes,attribution,restrictions,decision_status,decision_provenance,valid_from,
       expires_at,recorded_at,local_processing)
    values (decision_id, 'orlandoue', sid,
      coalesce((select max(sequence_number) from public.personal_owner_source_rights_decisions where source_id = sid), 0) + 1,
      e.source_name, 'RSS_ATOM', e.rights_url, rights_hash, scopes,
      e.source_name || '; source title, publication date, publisher-provided excerpt, canonical source link.',
      jsonb_build_object('maximum_excerpt_characters', 700, 'maximum_quote_codepoints', 300,
        'cloudflare_stateless_inference', true, 'no_raw_prompt_or_response_retention', true,
        'corporate_live_acquisition', true, 'maximum_public_excerpt_characters', 700, 'fulltext_acquisition', false),
      'AUTHORIZED', provenance, stamp, stamp + interval '365 days', stamp, true);
  end if;

  -- Excerpt content policy and Workers AI route grant.
  content_policy := encode(digest(convert_to('dialektik-live-semantic-excerpt-policy-v3' || E'\n' || sid || E'\n'
    || decision_id || E'\n' || rights_hash, 'UTF8'), 'sha256'), 'hex');
  stamp := clock_timestamp() - interval '1 second';
  insert into public.content_access_policies
    (id,source_id,content_access_mode,metadata_storage,excerpt_storage,fulltext_acquisition,
     fulltext_machine_processing,fulltext_persistence,derived_semantic_persistence,minimal_evidence_fragment,
     redisplay,external_source_link,evidence_quote_max_codepoints,rights_evidence_url,rights_verified_at,
     recorded_at,local_processing,external_ai_transmission,rights_evidence_sha256,personal_owner_source_rights_decision_id)
  values (content_policy, sid, 'EXCERPT_EPHEMERAL', true, true, false, false, false, true, true, false, false, 300,
    e.rights_url, stamp, stamp, true, true, rights_hash, decision_id)
  on conflict (id) do nothing;
  select evidence_sha256 into provider_hash from public.personal_owner_provider_authorizations
    where owner_identity = 'orlandoue' and provider_type = 'llm_cloudflare_workers_ai'
      and model_id = '@cf/meta/llama-3.1-8b-instruct' and decision_status = 'AUTHORIZED'
    order by recorded_at desc, id desc limit 1;
  if provider_hash is null then raise exception 'MEDIA_CATALOG_PROVIDER_AUTHORIZATION_MISSING'; end if;
  insert into public.live_semantic_source_route_grants
    (id,source_id,policy_id,provider_type,processing_route,fulltext_acquisition,machine_processing,
     derived_persistence,fulltext_persistence,evidence_fragments,rights_receipt_sha256,recorded_at)
  select public.dialektik_generate_ulid(), sid, content_policy, 'llm_cloudflare_workers_ai',
    'EXTERNAL_LLM_PROCESSING_ALLOWED', false, true, true, false, true,
    encode(digest(convert_to(rights_hash || E'\n' || provider_hash || E'\n' || content_policy
      || E'\nEXTERNAL_LLM_PROCESSING_ALLOWED', 'UTF8'), 'sha256'), 'hex'), stamp
  where not exists (select 1 from public.live_semantic_source_route_grants g
    where g.source_id = sid and g.policy_id = content_policy and g.provider_type = 'llm_cloudflare_workers_ai');

  -- Corporate acquisition connection and polling state.
  select * into current_connection from public.corporate_live_source_connections
    where source_id = sid order by sequence_number desc limit 1;
  if not found or not current_connection.active or current_connection.endpoint <> endpoint
      or current_connection.rights_decision_id <> decision_id or current_connection.discovery_channel <> 'rss_atom' then
    insert into public.corporate_live_source_connections
      (id,source_id,sequence_number,rights_decision_id,endpoint,channel_url,discovery_channel,
       allowed_article_domains,active,approved_by,recorded_at)
    values (public.dialektik_generate_ulid(), sid,
      coalesce((select max(sequence_number) from public.corporate_live_source_connections where source_id = sid), 0) + 1,
      decision_id, endpoint, channel_url, 'rss_atom', e.allowed_domains, true, editor_id,
      date_trunc('milliseconds', clock_timestamp()));
  end if;
  insert into public.corporate_live_source_poll_state (source_id,poll_interval_seconds,last_status,next_poll_at,updated_at)
  values (sid, case when p_type = 'YOUTUBE' then 3600 else 1800 end, 'PENDING', clock_timestamp(), clock_timestamp())
  on conflict (source_id) do nothing;

  insert into public.media_source_profiles (source_id,country_code,media_group_slug,media_group_name,editorial_lean,modality,language)
  values (sid, e.country_code, e.media_group_slug, e.display_name, e.editorial_lean, p_type, e.language)
  on conflict (source_id) do update set country_code = excluded.country_code, media_group_slug = excluded.media_group_slug,
    media_group_name = excluded.media_group_name, editorial_lean = excluded.editorial_lean,
    modality = excluded.modality, language = excluded.language, updated_at = clock_timestamp();
  update public.media_catalog_entries set source_id = sid, updated_at = clock_timestamp()
    where media_group_slug = p_slug and source_type = p_type;
  return 'REGISTERED';
end
$fn$;

-- Runtime one-time YouTube resolution (@handle -> UC...). The resolver in
-- Core records every attempt; a valid channel activates the row once.
create or replace function public.dialektik_resolve_media_catalog_channel(p_slug text, p_channel_id text, p_status text)
returns text language plpgsql security definer
set search_path = pg_catalog, public, extensions as $fn$
declare
  e public.media_catalog_entries%rowtype;
  twin text;
begin
  if p_status !~ '^[A-Z0-9_]{1,64}$' then raise exception 'MEDIA_CATALOG_RESOLUTION_STATUS_INVALID'; end if;
  select * into e from public.media_catalog_entries where media_group_slug = p_slug and source_type = 'YOUTUBE' for update;
  if not found or e.verification_status <> 'PENDING_CHANNEL' then return 'NOT_PENDING'; end if;
  update public.media_catalog_entries set resolution_attempts = resolution_attempts + 1,
    last_resolution_at = clock_timestamp(), last_resolution_status = p_status, updated_at = clock_timestamp()
    where media_group_slug = p_slug and source_type = 'YOUTUBE';
  if p_channel_id is null or p_channel_id !~ '^UC[A-Za-z0-9_-]{22}$' then return 'UNRESOLVED'; end if;
  select media_group_slug into twin from public.media_catalog_entries
    where source_type = 'YOUTUBE' and youtube_channel_id = p_channel_id and media_group_slug <> p_slug
      and verification_status in ('ACTIVE','EXISTING_SOURCE') limit 1;
  if twin is not null then
    update public.media_catalog_entries set verification_status = 'DUPLICATE_CHANNEL', duplicate_of = twin,
      youtube_channel_id = p_channel_id, updated_at = clock_timestamp()
      where media_group_slug = p_slug and source_type = 'YOUTUBE';
    return 'DUPLICATE_CHANNEL';
  end if;
  update public.media_catalog_entries set youtube_channel_id = p_channel_id, verification_status = 'ACTIVE',
    verification_reason = 'Channel resolved at runtime from ' || coalesce(e.youtube_handle, 'handle'), updated_at = clock_timestamp()
    where media_group_slug = p_slug and source_type = 'YOUTUBE';
  return public.dialektik_register_media_catalog_source(p_slug, 'YOUTUBE');
end
$fn$;

-- Existing YouTube channels read through the Data API move to their free
-- Atom feed: a new policy version and a new connection, same rights decision.
create or replace function public.dialektik_move_youtube_source_to_atom(p_source_id dialektik_ulid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, extensions as $fn$
declare
  c record;
  latest record;
  channel text;
  endpoint text;
  policy_id text;
begin
  select * into c from public.corporate_live_source_connections where source_id = p_source_id
    order by sequence_number desc limit 1;
  if not found or not c.active then return 'NO_ACTIVE_CONNECTION'; end if;
  if c.discovery_channel = 'rss_atom' then return 'ALREADY_ATOM'; end if;
  channel := substring(coalesce(c.channel_url, '') from 'channel/(UC[A-Za-z0-9_-]{22})');
  if channel is null then channel := substring(c.endpoint from 'channel_id=(UC[A-Za-z0-9_-]{22})'); end if;
  if channel is null then return 'CHANNEL_UNKNOWN'; end if;
  endpoint := 'https://www.youtube.com/feeds/videos.xml?channel_id=' || channel;
  select * into latest from public.live_source_policies where source_id = p_source_id
    order by recorded_at desc, id desc limit 1;
  if not found then return 'POLICY_MISSING'; end if;
  if latest.policy->>'endpoint' <> endpoint then
    policy_id := encode(digest(convert_to('dialektik-youtube-atom-v1' || E'\n' || p_source_id || E'\n' || endpoint, 'UTF8'), 'sha256'), 'hex');
    insert into public.live_source_policies (id,source_id,registry_key,rights_class,storage_policy,active,
      rights_evidence_url,rights_verified_at,policy,recorded_at)
    select policy_id, p_source_id, latest.registry_key, latest.rights_class, latest.storage_policy, latest.active,
      latest.rights_evidence_url, latest.rights_verified_at,
      latest.policy || jsonb_build_object('endpoint', endpoint, 'discoveryChannel', 'rss_atom',
        'channelUrl', 'https://www.youtube.com/channel/' || channel),
      greatest(clock_timestamp(), latest.recorded_at + interval '1 millisecond')
    where not exists (select 1 from public.live_source_policies where id = policy_id);
  end if;
  insert into public.corporate_live_source_connections
    (id,source_id,sequence_number,rights_decision_id,endpoint,channel_url,discovery_channel,
     allowed_article_domains,active,approved_by,recorded_at)
  values (public.dialektik_generate_ulid(), p_source_id, c.sequence_number + 1, c.rights_decision_id, endpoint,
    'https://www.youtube.com/channel/' || channel, 'rss_atom', c.allowed_article_domains, true, c.approved_by,
    date_trunc('milliseconds', clock_timestamp()));
  update public.corporate_live_source_poll_state set poll_interval_seconds = 3600, next_poll_at = clock_timestamp(),
    lease_until = null, last_status = 'PENDING', updated_at = clock_timestamp()
    where source_id = p_source_id;
  return 'MOVED';
end
$fn$;

revoke all on function public.dialektik_register_media_catalog_source(text,text) from public, anon, authenticated;
revoke all on function public.dialektik_resolve_media_catalog_channel(text,text,text) from public, anon, authenticated;
revoke all on function public.dialektik_move_youtube_source_to_atom(dialektik_ulid) from public, anon, authenticated;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_corporate_live_writer') then
    grant execute on function public.dialektik_resolve_media_catalog_channel(text,text,text) to dialektik_corporate_live_writer;
  end if;
end
$grant$;

-- 4. Catalog rows -----------------------------------------------------------
insert into public.media_catalog_entries (media_group_slug,source_type,country_code,display_name,feed_url,website_url,
  youtube_handle,youtube_channel_id,editorial_lean,category,language,catalog_active,verification_status,
  verification_reason,endpoint,feed_host,duplicate_of,existing_registry_key,planned_source_id,source_name,
  source_kind,canonical_domain,allowed_domains,registry_key,rights_url,authorization_reference)
select x.slug,x.type,x.country,x.display_name,x.feed_url,x.website_url,x.handle,x.channel_id,x.lean,x.category,
  x.language,x.catalog_active,x.status,x.reason,x.endpoint,x.feed_host,x.duplicate_of,x.existing_registry_key,
  x.source_id::dialektik_ulid,x.source_name,x.source_kind::source_type,x.canonical_domain,x.allowed_domains,
  x.registry_key,x.rights_url,x.authorization_reference
from jsonb_to_recordset(${json(MEDIA_CATALOG_ENTRIES)}) as x(slug text,type text,country text,display_name text,
  feed_url text,website_url text,handle text,channel_id text,lean text,category text,language text,
  catalog_active boolean,status text,reason text,endpoint text,feed_host text,duplicate_of text,
  existing_registry_key text,source_id text,source_name text,source_kind text,canonical_domain text,
  allowed_domains jsonb,registry_key text,rights_url text,authorization_reference text)
on conflict (media_group_slug, source_type) do update set
  country_code = excluded.country_code, display_name = excluded.display_name, feed_url = excluded.feed_url,
  website_url = excluded.website_url, youtube_handle = excluded.youtube_handle,
  editorial_lean = excluded.editorial_lean, category = excluded.category, language = excluded.language,
  catalog_active = excluded.catalog_active, endpoint = excluded.endpoint, feed_host = excluded.feed_host,
  existing_registry_key = excluded.existing_registry_key, source_name = excluded.source_name,
  source_kind = excluded.source_kind, canonical_domain = excluded.canonical_domain,
  allowed_domains = excluded.allowed_domains, registry_key = excluded.registry_key, rights_url = excluded.rights_url,
  authorization_reference = excluded.authorization_reference, updated_at = clock_timestamp(),
  -- A channel resolved at runtime is kept; otherwise the verified record wins.
  youtube_channel_id = coalesce(public.media_catalog_entries.youtube_channel_id, excluded.youtube_channel_id),
  verification_status = case when public.media_catalog_entries.verification_status = 'ACTIVE'
    and excluded.verification_status = 'PENDING_CHANNEL' then 'ACTIVE' else excluded.verification_status end,
  verification_reason = case when public.media_catalog_entries.verification_status = 'ACTIVE'
    and excluded.verification_status = 'PENDING_CHANNEL' then public.media_catalog_entries.verification_reason
    else excluded.verification_reason end,
  duplicate_of = excluded.duplicate_of,
  planned_source_id = coalesce(public.media_catalog_entries.planned_source_id, excluded.planned_source_id);

-- 5. Register active rows, attach existing sources, profile the rest --------
do $seed$
declare
  e record;
  p record;
  sid dialektik_ulid;
  registered integer := 0;
  attached integer := 0;
  moved integer := 0;
  outcome text;
begin
  if not exists (select 1 from public.users where id = '01M4YDQK00ED1T0R0R1AND0VE1' and role = 'editor') then
    raise exception 'MIGRATION_087_EDITOR_NOT_ACTIVE';
  end if;

  -- Existing production sources: country, group and lean.
  for p in select * from jsonb_to_recordset(${json(EXISTING_SOURCE_PROFILES)})
      as x(registry_key text, slug text, name text, modality text, country text, lean text) loop
    for sid in select distinct lp.source_id from public.live_source_policies lp
        where regexp_replace(lp.registry_key, '^(corporate-)+', '') = p.registry_key loop
      insert into public.media_source_profiles (source_id,country_code,media_group_slug,media_group_name,editorial_lean,modality,language)
      values (sid, p.country, p.slug, p.name, p.lean, p.modality, 'es')
      on conflict (source_id) do update set country_code = excluded.country_code,
        media_group_slug = excluded.media_group_slug, media_group_name = excluded.media_group_name,
        editorial_lean = excluded.editorial_lean, modality = excluded.modality, updated_at = clock_timestamp();
    end loop;
  end loop;

  for e in select * from public.media_catalog_entries where verification_status = 'EXISTING_SOURCE' loop
    select lp.source_id into sid from public.live_source_policies lp
      where regexp_replace(lp.registry_key, '^(corporate-)+', '') = e.existing_registry_key
      order by lp.recorded_at desc limit 1;
    if sid is not null then
      update public.media_catalog_entries set source_id = sid, updated_at = clock_timestamp()
        where media_group_slug = e.media_group_slug and source_type = e.source_type;
      attached := attached + 1;
    end if;
  end loop;

  for e in select * from public.media_catalog_entries where verification_status = 'ACTIVE'
      order by country_code, media_group_slug, source_type loop
    outcome := public.dialektik_register_media_catalog_source(e.media_group_slug, e.source_type);
    if outcome = 'REGISTERED' then registered := registered + 1; end if;
  end loop;

  for sid in select s.id from public.sources s
      join lateral (select c.* from public.corporate_live_source_connections c where c.source_id = s.id
        order by c.sequence_number desc limit 1) c on c.active and c.discovery_channel = 'youtube_data_api_v3'
      where s.canonical_domain = 'youtube.com' and s.origin = 'LIVE_REAL' loop
    if public.dialektik_move_youtube_source_to_atom(sid) = 'MOVED' then moved := moved + 1; end if;
  end loop;

  raise notice 'MIGRATION_087 registered=% attached=% youtube_moved_to_atom=%', registered, attached, moved;
end
$seed$;
`;

export const multicountryMediaCatalogMigration: Migration = {
  async up(db) { await sql.raw(multicountryMediaCatalogSql).execute(db); },
  async down() { throw new Error('Media catalog and source rights history are forward-only.'); },
};
