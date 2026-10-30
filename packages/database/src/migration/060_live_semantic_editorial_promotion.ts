import { sql, type Migration } from "kysely";
const DDL = String.raw`
alter table public.live_semantic_pair_assessments
  add column if not exists same_event boolean not null default false;

create table if not exists public.live_semantic_editorial_promotions (
  group_id dialektik_ulid primary key references public.live_semantic_event_group_candidates(id),
  event_id dialektik_ulid not null unique references public.events(id),
  candidate_class_id dialektik_ulid not null unique references public.candidate_classes(id),
  task_id dialektik_ulid not null unique references public.moderation_tasks(id),
  proposal_id dialektik_ulid not null unique references public.moderation_review_proposals(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  correlation_id dialektik_ulid not null,
  created_at timestamptz(3) not null
);
alter table public.live_semantic_editorial_promotions enable row level security;
revoke all on public.live_semantic_editorial_promotions from public,anon,authenticated,
  dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer;

-- Supabase currently has a legacy table with this projection. Create the same
-- narrow projection on fresh installs and enforce a single row per Event.
create table if not exists public.public_events (
  id dialektik_ulid primary key references public.events(id),
  title_descriptive text not null,
  category_id dialektik_ulid not null,
  window_from timestamptz(3) not null,
  window_to timestamptz(3),
  detected_at timestamptz(3) not null,
  analysis_state analysis_state not null,
  merged_into dialektik_ulid,
  merged_by dialektik_ulid,
  merged_at timestamptz(3)
);
do $$ begin
  if exists(select 1 from public.public_events where id is null)
    or exists(select 1 from public.public_events group by id having count(*)>1) then
    raise exception 'PUBLIC_EVENTS_PROJECTION_IDENTITY_INVALID';
  end if;
end $$;
create unique index if not exists public_events_id_projection_unique
  on public.public_events(id) where id is not null;

create or replace function public.dialektik_promote_live_semantic_event_group(
  group_identity dialektik_ulid,
  actor_identity dialektik_ulid,
  correlation_identity dialektik_ulid
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  group_row public.live_semantic_event_group_candidates%rowtype;
  existing_row public.live_semantic_editorial_promotions%rowtype;
  item record;
  event_identity dialektik_ulid;
  position_identity dialektik_ulid;
  candidate_identity dialektik_ulid;
  task_identity dialektik_ulid;
  proposal_identity dialektik_ulid;
  single_editor_identity dialektik_ulid;
  category_identity dialektik_ulid;
  assertion_identity dialektik_ulid;
  span_identity dialektik_ulid;
  evidence_identity dialektik_ulid;
  relationship_identity dialektik_ulid;
  assertion_identities dialektik_ulid[] := array[]::dialektik_ulid[];
  relationship_identities dialektik_ulid[] := array[]::dialektik_ulid[];
  expected_pair_count integer;
  checked_pair_count integer;
  member_count integer;
  source_count integer;
  item_index integer := 0;
  decision_time timestamptz(3) := clock_timestamp();
  title_value text;
  summary_value text;
  event_date_from timestamptz(3);
  event_date_to timestamptz(3);
  quote_text text;
  quote_start integer;
  quote_end integer;
  assertion_text text;
  position_text text;
  payload_hash text;
  response_json jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:live-semantic-promote:'||group_identity::text,0));
  perform public.dialektik_require_context_actor(actor_identity);
  if current_setting('dialektik.actor_type',true) <> 'editor'
    or not exists(select 1 from public.users where id=actor_identity and role='editor') then
    raise exception using errcode='42501',message='LIVE_SEMANTIC_EDITOR_REQUIRED';
  end if;
  select id into single_editor_identity from public.editorial_single_editor_authorizations
    where editor_user_id=actor_identity and revoked_at is null limit 1;
  if single_editor_identity is null then
    raise exception using errcode='42501',message='LIVE_SEMANTIC_SINGLE_EDITOR_AUTHORITY_REQUIRED';
  end if;
  select * into existing_row from public.live_semantic_editorial_promotions
    where group_id=group_identity;
  if found then
    return jsonb_build_object('status','PROMOTED','groupId',group_identity::text,
      'eventId',existing_row.event_id::text,'alreadyPromoted',true);
  end if;
  select * into group_row from public.live_semantic_event_group_candidates
    where id=group_identity and review_state='REVIEW_REQUIRED' for update;
  if not found then
    raise exception using errcode='P0002',message='LIVE_SEMANTIC_GROUP_NOT_FOUND';
  end if;

  select count(*)::int,count(distinct source_id)::int into member_count,source_count
    from public.live_semantic_event_group_members where group_id=group_identity;
  if member_count < 2 or source_count < 2 then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','MULTI_SOURCE_GROUP_REQUIRED');
  end if;
  select count(*)::int into expected_pair_count
    from public.live_semantic_event_group_members left_member
    join public.live_semantic_event_group_members right_member
      on left_member.article_id < right_member.article_id
     and left_member.source_id <> right_member.source_id
    where left_member.group_id=group_identity and right_member.group_id=group_identity;
  select count(*)::int into checked_pair_count
    from public.live_semantic_pair_assessments pair_row
    join public.live_semantic_event_group_members left_member
      on left_member.group_id=pair_row.group_id and left_member.article_id::text=pair_row.left_article_id::text
    join public.live_semantic_event_group_members right_member
      on right_member.group_id=pair_row.group_id and right_member.article_id::text=pair_row.right_article_id::text
    where pair_row.group_id=group_identity and left_member.source_id<>right_member.source_id
      and pair_row.same_event and pair_row.same_event_confidence>=70
      and pair_row.relation='CONSISTENT' and pair_row.ratio_conflicting=0
      and pair_row.ratio_comparable>=50;
  if expected_pair_count=0 or checked_pair_count<>expected_pair_count then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','PAIR_CONFIRMATION_INCOMPLETE_OR_TENSION');
  end if;
  if exists(select 1 from public.live_semantic_event_group_members m
    join public.articles a on a.id=m.article_id::dialektik_ulid
    where m.group_id=group_identity and a.event_id is not null) then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','ARTICLE_ALREADY_LINKED');
  end if;

  select min(i.published_at),max(i.published_at) into event_date_from,event_date_to
    from public.live_semantic_event_group_members m
    join public.live_semantic_excerpt_inputs i on i.article_id=m.article_id::text
    where m.group_id=group_identity;
  if event_date_from is null or event_date_to-event_date_from>interval '48 hours' then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','EVENT_WINDOW_INVALID');
  end if;
  for item in
    select m.article_id::dialektik_ulid article_id,m.source_id::dialektik_ulid source_id,
      m.extraction_generation_id::dialektik_ulid generation_id,i.text_original,i.input_sha256,
      i.url_canonical,i.headline,i.published_at,i.source_name,i.policy_id,
      generation.proposal_payload->'spans'->0 span
    from public.live_semantic_event_group_members m
    join public.live_semantic_excerpt_inputs i on i.article_id=m.article_id::text
    join public.assertion_extraction_generations generation on generation.id=m.extraction_generation_id
    join public.articles article on article.id=m.article_id::dialektik_ulid
    where m.group_id=group_identity and article.event_id is null
    order by m.article_id
  loop
    quote_text := item.span->>'quoted_text';
    quote_start := nullif(item.span->>'start','')::integer;
    quote_end := nullif(item.span->>'end','')::integer;
    if quote_text is null or quote_start is null or quote_end is null
      or quote_start<0 or quote_end<=quote_start or quote_end-quote_start>300
      or substring(item.text_original from quote_start+1 for quote_end-quote_start)<>quote_text
      or not public.dialektik_live_semantic_route_allowed(
        item.article_id,item.input_sha256,'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct') then
      return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','QUOTE_OR_RIGHTS_VALIDATION_FAILED');
    end if;
  end loop;
  if (select count(*) from public.live_semantic_event_group_members where group_id=group_identity)<>member_count then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','GROUP_MEMBER_NOT_CURRENT');
  end if;

  select id into category_identity from public.categories
   where is_active and slug=case
     when group_row.proposed_event_key ~* '(afp|ipom|presupuesto|econom)' then 'economia'
     when group_row.proposed_event_key ~* '(eleccion|servel|ministro|corte|politic|monsalve)' then 'politica'
     else 'pais' end limit 1;
  if category_identity is null then
    raise exception using errcode='23503',message='LIVE_SEMANTIC_CATEGORY_NOT_CONFIGURED';
  end if;

  event_identity := public.dialektik_generate_ulid();
  position_identity := public.dialektik_generate_ulid();
  candidate_identity := public.dialektik_generate_ulid();
  task_identity := public.dialektik_generate_ulid();
  proposal_identity := public.dialektik_generate_ulid();
  title_value := left(btrim(group_row.proposed_title),240);
  summary_value := left(btrim(group_row.proposed_summary),500);

  insert into public.events(id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state)
    values(event_identity,title_value,category_identity,event_date_from,event_date_to,decision_time,'ANALYSIS_PENDING');
  update public.articles set event_id=event_identity
    where id in (select article_id::dialektik_ulid from public.live_semantic_event_group_members where group_id=group_identity);

  for item in
    select m.article_id::dialektik_ulid article_id,m.source_id::dialektik_ulid source_id,
      m.extraction_generation_id::dialektik_ulid generation_id,i.text_original,i.input_sha256,
      i.url_canonical,i.headline,i.published_at,i.source_name,i.policy_id,
      generation.proposal_payload->'spans'->0 span
    from public.live_semantic_event_group_members m
    join public.live_semantic_excerpt_inputs i on i.article_id=m.article_id::text
    join public.assertion_extraction_generations generation on generation.id=m.extraction_generation_id
    where m.group_id=group_identity order by m.article_id
  loop
    quote_text := item.span->>'quoted_text';
    quote_start := (item.span->>'start')::integer;
    quote_end := (item.span->>'end')::integer;
    assertion_text := left(btrim(item.span->>'assertion_text'),300);
    position_text := left(btrim(item.span->>'position_summary'),240);
    span_identity := public.dialektik_generate_ulid();
    assertion_identity := public.dialektik_generate_ulid();
    evidence_identity := public.dialektik_generate_ulid();
    insert into public.claim_spans(id,article_id,text_offset_start,text_offset_end,quoted_text,location,captured_at)
      values(span_identity,item.article_id,quote_start,quote_end,quote_text,
        case when quote_start<length(item.headline) then 'headline'::public.span_location else 'lede'::public.span_location end,
        decision_time);
    insert into public.assertions(id,claim_span_id,ordinal,is_principal,assertion_type,subject_ref,temporal_scope,
      population_scope,comparison_base,position_id,epistemic_class,epistemic_reason,extraction_confidence,
      version,supersedes_id,lineage_root_id,lifecycle_state)
      values(assertion_identity,span_identity,1,true,'existence',left(group_row.proposed_event_key,200),
        jsonb_build_object('from',to_char(item.published_at at time zone 'UTC','YYYY-MM-DD'),
          'to',to_char(item.published_at at time zone 'UTC','YYYY-MM-DD'),'granularity','day'),
        null,group_row.proposed_event_key,null,null,null,0.9,1,null,assertion_identity,'active');
    perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'evidence_published','live_semantic_evidence_approval');
    insert into public.evidence(id,anchor_span_id,scope_assertion_id,stance,summary,citable_source_url,
      citable_source_title,contributed_by,publication_state,approved_by,approved_at,relevance)
      values(evidence_identity,span_identity,assertion_identity,'supports',assertion_text,item.url_canonical,
        item.headline,actor_identity,'published',actor_identity,decision_time,1.0);
    assertion_identities := array_append(assertion_identities,assertion_identity);
  end loop;
  if cardinality(assertion_identities)<>member_count then
    raise exception using errcode='23514',message='LIVE_SEMANTIC_GROUP_MEMBER_COUNT_CHANGED';
  end if;

  select array_agg(assertion_id order by assertion_id) into assertion_identities from unnest(assertion_identities) assertion_id;
  select left(btrim(coalesce((generation.proposal_payload->'spans'->0->>'position_summary'),group_row.proposed_title)),240)
    into position_text
    from public.live_semantic_event_group_members m
    join public.assertion_extraction_generations generation on generation.id=m.extraction_generation_id
    where m.group_id=group_identity order by m.article_id limit 1;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'created','live_semantic_position');
  insert into public.positions(id,event_id,neutral_rank,title_text,publication_state,published_at,published_by,status)
    values(position_identity,event_identity,null,coalesce(nullif(position_text,''),title_value),'internal',null,null,'active');
  insert into public.position_title_generated_from(position_id,assertion_id,ordinal)
    select position_identity,assertion_id,row_number() over(order by assertion_id)::int
    from unnest(assertion_identities) assertion_id;

  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'moderation_decision','live_semantic_equivalence_review');
  insert into public.candidate_classes(id,event_id,model_ref,model_version,created_at,state)
    values(candidate_identity,event_identity,'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct',decision_time,'proposed');
  insert into public.candidate_class_members(candidate_class_id,assertion_id)
    select candidate_identity,assertion_id from unnest(assertion_identities) assertion_id;
  insert into public.moderation_tasks(id,task_type,target_type,target_id,state,priority,assigned_to,created_at,
    resolved_at,resolution_reason,projection_event_id,projection_position_a_id,projection_position_b_id,
    projection_hash,origin_proposal_id)
    values(task_identity,'equivalence_review','CandidateClass',candidate_identity,'pending',0,null,decision_time,
      null,null,null,null,null,null,null);
  update public.moderation_tasks set assigned_to=actor_identity where id=task_identity;
  payload_hash := encode(extensions.digest(convert_to(jsonb_build_object('outcome','accept_subset',
    'assertionIds',to_jsonb(assertion_identities))::text,'UTF8'),'sha256'),'hex');
  -- Proposal members are immutable after their parent proposal exists. The FK
  -- is deferred, so insert the members first, matching the moderation service.
  insert into public.moderation_review_proposal_members(proposal_id,assertion_id,partition_ordinal)
    select proposal_identity,assertion_id,null from unnest(assertion_identities) assertion_id;
  insert into public.moderation_review_proposals(id,task_id,candidate_class_id,outcome,proposer_id,payload_hash,
    state,submitted_at,decided_by,decided_at,decision_reason,single_editor_authorization_id)
    values(proposal_identity,task_identity,candidate_identity,'accept_subset',actor_identity,payload_hash,
      'submitted',decision_time,null,null,null,single_editor_identity);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'confirmed','live_semantic_single_editor_approval');
  update public.moderation_review_proposals set state='confirmed',decided_by=actor_identity,decided_at=decision_time
    where id=proposal_identity;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'confirmed','live_semantic_candidate_acceptance');
  update public.candidate_classes set state='accepted' where id=candidate_identity;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'confirmed','live_semantic_task_resolution');
  update public.moderation_tasks set state='resolved',resolved_at=decision_time,
    resolution_reason='live_semantic_single_editor_promotion' where id=task_identity;

  for item_index in 2..cardinality(assertion_identities) loop
    relationship_identity := public.dialektik_generate_ulid();
    relationship_identities := array_append(relationship_identities,relationship_identity);
    insert into public.relationships(id,rel_type,event_id,scope,publication_state,declared_by,confirmed_by,
      confirmed_at,non_comparable_reason,triggering_evidence_id,rectified_by,confidence,similarity_score,
      moderation_proposal_id)
      values(relationship_identity,'R01a',event_identity,'intra_event','published',actor_identity,actor_identity,
        decision_time,null,null,null,null,null,proposal_identity);
    insert into public.relationship_endpoints(relationship_id,assertion_id,role,endpoint_order)
      values(relationship_identity,assertion_identities[item_index-1],'peer',1),
        (relationship_identity,assertion_identities[item_index],'peer',2);
  end loop;
  insert into public.position_formed_by(position_id,relationship_id,ordinal)
    select position_identity,relationship_id,row_number() over(order by ordinality)::int
    from unnest(relationship_identities) with ordinality as relationships(relationship_id,ordinality);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'membership_changed','live_semantic_position_membership');
  update public.assertions set position_id=position_identity
    where id=any(assertion_identities);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'published','live_semantic_position_publication');
  update public.positions set neutral_rank=1,publication_state='published',published_at=decision_time,published_by=actor_identity
    where id=position_identity;
  update public.events set analysis_state='PUBLISHED' where id=event_identity;

  insert into public.public_events(id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,
    merged_into,merged_by,merged_at)
    select id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,merged_into,merged_by,merged_at
    from public.events where id=event_identity
    on conflict(id) where id is not null do update set title_descriptive=excluded.title_descriptive,
      category_id=excluded.category_id,window_from=excluded.window_from,window_to=excluded.window_to,
      detected_at=excluded.detected_at,analysis_state=excluded.analysis_state,
      merged_into=excluded.merged_into,merged_by=excluded.merged_by,merged_at=excluded.merged_at;

  response_json := jsonb_build_object('status','PROMOTED','groupId',group_identity::text,
    'eventId',event_identity::text,'candidateClassId',candidate_identity::text,'taskId',task_identity::text,
    'proposalId',proposal_identity::text,'articleCount',member_count,'sourceCount',source_count,
    'claimSpansCreated',member_count,'assertionsCreated',member_count,'evidenceCreated',member_count,
    'positionsCreated',1,'contradictionsPublished',0,'editorUserId',actor_identity::text);
  insert into public.live_semantic_editorial_promotions(group_id,event_id,candidate_class_id,task_id,proposal_id,
    editor_user_id,correlation_id,created_at)
    values(group_identity,event_identity,candidate_identity,task_identity,proposal_identity,actor_identity,
      correlation_identity,decision_time);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'confirmed','live_semantic_command_receipt');
  insert into public.moderation_command_receipts(actor_id,task_id,command_id,command_type,payload_hash,
    response_payload,created_at)
    values(actor_identity,task_identity,correlation_identity,'confirm_proposal',payload_hash,response_json,decision_time)
    on conflict(actor_id,task_id,command_id) do nothing;
  return response_json;
end;
$$;
revoke all on function public.dialektik_promote_live_semantic_event_group(dialektik_ulid,dialektik_ulid,dialektik_ulid)
  from public,anon,authenticated,dialektik_core_app,dialektik_headline_ai_writer;
grant execute on function public.dialektik_promote_live_semantic_event_group(dialektik_ulid,dialektik_ulid,dialektik_ulid)
  to dialektik_moderation_writer;

create or replace function public.dialektik_live_semantic_source_allowed(source_identity dialektik_ulid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,extensions as $$
 select exists(
  select 1 from public.sources s
  join lateral(select p.* from public.live_source_policies p where p.source_id=s.id order by p.recorded_at desc,p.id desc limit 1) lp on true
  join lateral(select p.* from public.content_access_policies p where p.source_id=s.id order by p.recorded_at desc,p.id desc limit 1) cp on true
  join lateral(select d.* from public.personal_owner_source_rights_decisions d where d.source_id=s.id and d.owner_identity='orlandoue' order by d.sequence_number desc limit 1) rd on true
  join lateral(select g.* from public.live_semantic_source_route_grants g where g.source_id=s.id and g.provider_type='llm_cloudflare_workers_ai' order by g.recorded_at desc,g.id desc limit 1) rg on true
  join lateral(select a.* from public.personal_owner_provider_authorizations a where a.owner_identity='orlandoue' and a.provider_type='llm_cloudflare_workers_ai' and a.model_id='@cf/meta/llama-3.1-8b-instruct' order by a.recorded_at desc,a.id desc limit 1) pa on true
  where s.id=source_identity and s.origin='LIVE_REAL'
   and s.canonical_domain in ('biobiochile.cl','ciperchile.cl','cooperativa.cl','diarioeldia.cl','elmostrador.cl','latercera.com','youtube.com')
   and lp.active and lp.rights_class='LIVE_READY' and lp.storage_policy='METADATA_AND_FEED_EXCERPT'
   and lp.policy->>'rightsReviewStatus'='APPROVED'
   and nullif(lp.policy->>'endpoint','') is not null and nullif(lp.policy->>'rightsEvidenceUrl','') is not null
   and cp.personal_owner_source_rights_decision_id=rd.id and cp.rights_evidence_sha256=rd.rights_evidence_sha256
   and rg.policy_id=cp.id and cp.content_access_mode='EXCERPT_EPHEMERAL' and cp.excerpt_storage
   and cp.external_ai_transmission and cp.derived_semantic_persistence and cp.minimal_evidence_fragment
   and cp.evidence_quote_max_codepoints between 1 and 300
   and not cp.fulltext_acquisition and not cp.fulltext_machine_processing and not cp.fulltext_persistence and not cp.redisplay
   and rd.decision_status='AUTHORIZED' and (rd.expires_at is null or rd.expires_at>statement_timestamp())
   and rd.scopes->>'excerpt_storage'='true' and rd.scopes->>'external_ai_transmission'='true'
   and rd.scopes->>'derived_semantic_persistence'='true' and rd.scopes->>'fulltext_acquisition'='false'
   and rd.scopes->>'fulltext_persistence'='false'
   and rg.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED' and not rg.fulltext_acquisition
   and rg.machine_processing and rg.derived_persistence and not rg.fulltext_persistence and rg.evidence_fragments
   and pa.decision_status='AUTHORIZED' and pa.valid_from<=statement_timestamp()
   and (pa.expires_at is null or pa.expires_at>statement_timestamp())
 )
$$;
`;

const SEED = String.raw`
do $seed$
declare
  source_row record;
  provider_hash text;
  now_value timestamptz(3) := clock_timestamp();
  is_youtube boolean;
  evidence_url text;
  provenance text;
  scopes jsonb;
  restrictions jsonb;
  receipt jsonb;
  generated_rights_hash text;
  rights_hash text;
  decision_identity dialektik_ulid;
  decision_time timestamptz(3);
  next_sequence integer;
  live_policy jsonb;
  live_policy_identity text;
  content_policy_identity text;
  route_hash text;
  el_mostrador_grants integer;
  youtube_grants integer;
begin
  if (select count(*) from public.sources s
      join lateral(select p.* from public.live_source_policies p where p.source_id=s.id
        order by p.recorded_at desc,p.id desc limit 1) lp on true
      where s.canonical_domain='elmostrador.cl' and s.origin='LIVE_REAL' and lp.active
        and lp.rights_class='LIVE_READY') <> 1
    or (select count(*) from public.sources s
      join lateral(select p.* from public.live_source_policies p where p.source_id=s.id
        order by p.recorded_at desc,p.id desc limit 1) lp on true
      where s.canonical_domain='youtube.com' and s.origin='LIVE_REAL' and lp.active
        and lp.rights_class='LIVE_READY') <> 32 then
    raise exception 'MIGRATION_060_SOURCE_CATALOG_INCOMPLETE';
  end if;
  select evidence_sha256 into provider_hash from public.personal_owner_provider_authorizations
    where owner_identity='orlandoue' and provider_type='llm_cloudflare_workers_ai'
      and model_id='@cf/meta/llama-3.1-8b-instruct' and decision_status='AUTHORIZED'
      and valid_from<=now_value and (expires_at is null or expires_at>now_value)
    order by recorded_at desc,id desc limit 1;
  if provider_hash is null then
    raise exception 'MIGRATION_060_PROVIDER_AUTHORIZATION_MISSING';
  end if;

  for source_row in
    select s.id::text id,s.name,s.canonical_domain,s.origin,lp.registry_key,lp.policy
    from public.sources s join lateral(
      select p.* from public.live_source_policies p where p.source_id=s.id
      order by p.recorded_at desc,p.id desc limit 1) lp on true
    where s.canonical_domain in ('elmostrador.cl','youtube.com')
    order by s.canonical_domain,s.id
  loop
    is_youtube := source_row.canonical_domain='youtube.com';
    evidence_url := case when is_youtube
      then 'https://developers.google.com/youtube/terms/api-services-terms-of-service'
      else 'https://www.bcn.cl/leychile/navegar?idNorma=28933' end;
    provenance := case when is_youtube
      then 'EDITOR_AUTHORIZED_YOUTUBE_API_METADATA_DESCRIPTION_EPHEMERAL_AI_2026'
      else 'EDITOR_AUTHORIZED_EL_MOSTRADOR_RSS_AND_PUBLIC_META_DESCRIPTION_ART71B_2026' end;
    scopes := jsonb_build_object('acquisition',true,'metadata_storage',true,'excerpt_storage',true,
      'fulltext_acquisition',false,'fulltext_persistence',false,'external_ai_transmission',true,
      'derived_semantic_persistence',true,'redisplay',false);
    restrictions := jsonb_build_object('maximum_excerpt_characters',700,'maximum_quote_codepoints',300,
      'cloudflare_stateless_inference',true,'cloudflare_data_policy_url',
        'https://developers.cloudflare.com/workers-ai/platform/data-usage/',
      'no_raw_prompt_or_response_retention',true,'fulltext_acquisition',false,'fulltext_persistence',false,
      'youtube_data_refresh_days',case when is_youtube then 30 else null end,
      'youtube_transcripts',false);
    receipt := jsonb_build_object('sourceId',source_row.id,'publisher',source_row.name,
      'evidenceUrl',evidence_url,'scopes',scopes,'provider','llm_cloudflare_workers_ai',
      'providerEvidenceUrl','https://developers.cloudflare.com/workers-ai/platform/data-usage/',
      'model','@cf/meta/llama-3.1-8b-instruct','maximumExcerptCharacters',700,
      'maximumEvidenceCodepoints',300,'noFullText',true,'noRawPromptOrResponseRetention',true,
      'youtubeApiKeyRequired',is_youtube,'youtubeDataRefreshDays',case when is_youtube then 30 else null end,
      'editoriallyApprovedBy','orlandoue',
      'legalReference',case when is_youtube then 'YOUTUBE_API_SERVICES_TERMS' else 'CL-LEY-17336-ART71B' end);
    generated_rights_hash := encode(extensions.digest(convert_to(receipt::text,'UTF8'),'sha256'),'hex');
    decision_identity := null;
    select d.id,d.rights_evidence_sha256,d.recorded_at into decision_identity,rights_hash,decision_time
      from public.personal_owner_source_rights_decisions d
      where d.source_id=source_row.id::dialektik_ulid and d.owner_identity='orlandoue'
        and d.decision_provenance=provenance
      order by d.sequence_number desc limit 1;
    if decision_identity is null then
      rights_hash := generated_rights_hash;
      select coalesce(max(d.sequence_number),0)::int+1 into next_sequence
        from public.personal_owner_source_rights_decisions d
        where d.source_id=source_row.id::dialektik_ulid;
      decision_identity := public.dialektik_generate_ulid();
      decision_time := now_value;
      insert into public.personal_owner_source_rights_decisions
        (id,owner_identity,source_id,sequence_number,publisher_identity,acquisition_method,rights_evidence_url,
         rights_evidence_sha256,scopes,attribution,restrictions,decision_status,decision_provenance,valid_from,
         expires_at,recorded_at,local_processing)
      values (decision_identity,'orlandoue',source_row.id::dialektik_ulid,next_sequence,source_row.name,
        case when is_youtube then 'OFFICIAL_API' else 'RSS_ATOM' end,evidence_url,rights_hash,scopes,
        left(source_row.name||'; headline, publisher attribution, publication date, canonical URL and excerpt under the editorial rule.',1000),
        restrictions,'AUTHORIZED',provenance,now_value,
        now_value+case when is_youtube then interval '30 days' else interval '90 days' end,
        now_value,false);
    end if;

    live_policy := coalesce(source_row.policy,'{}'::jsonb) || jsonb_build_object(
      'storagePolicy','METADATA_AND_FEED_EXCERPT','rightsEvidenceUrl',evidence_url,
      'rightsReviewStatus','APPROVED','rightsVerifiedAt',decision_time,
      'attribution',source_row.name||'; original headline, author, publication date, short supplied description and canonical source link.',
      'excerptMaximumCharacters',700,'excerptFallback','PUBLIC_META_DESCRIPTION');
    live_policy_identity := encode(extensions.digest(convert_to(live_policy::text,'UTF8'),'sha256'),'hex');
    insert into public.live_source_policies
      (id,source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,rights_verified_at,policy,recorded_at)
    values (live_policy_identity,source_row.id::dialektik_ulid,source_row.registry_key,'LIVE_READY',
      'METADATA_AND_FEED_EXCERPT',true,evidence_url,decision_time,live_policy,now_value)
    on conflict(id) do nothing;

    content_policy_identity := encode(extensions.digest(convert_to(
      'dialektik-live-semantic-excerpt-policy-v2'||E'\n'||source_row.id||E'\n'||decision_identity::text||E'\n'||rights_hash,
      'UTF8'),'sha256'),'hex');
    insert into public.content_access_policies
      (id,source_id,content_access_mode,metadata_storage,excerpt_storage,fulltext_acquisition,
       fulltext_machine_processing,fulltext_persistence,derived_semantic_persistence,minimal_evidence_fragment,
       redisplay,external_source_link,evidence_quote_max_codepoints,rights_evidence_url,rights_verified_at,
       recorded_at,local_processing,external_ai_transmission,rights_evidence_sha256,
       personal_owner_source_rights_decision_id)
    values (content_policy_identity,source_row.id::dialektik_ulid,'EXCERPT_EPHEMERAL',true,true,false,
      false,false,true,true,false,true,300,evidence_url,decision_time,now_value,false,true,
      rights_hash,decision_identity)
    on conflict(id) do nothing;

    route_hash := encode(extensions.digest(convert_to(
      rights_hash||E'\n'||provider_hash||E'\n'||content_policy_identity||E'\n'||'EXTERNAL_LLM_PROCESSING_ALLOWED',
      'UTF8'),'sha256'),'hex');
    insert into public.live_semantic_source_route_grants
      (id,source_id,policy_id,provider_type,processing_route,fulltext_acquisition,machine_processing,
       derived_persistence,fulltext_persistence,evidence_fragments,rights_receipt_sha256,recorded_at)
    select public.dialektik_generate_ulid(),source_row.id::dialektik_ulid,content_policy_identity,
      'llm_cloudflare_workers_ai','EXTERNAL_LLM_PROCESSING_ALLOWED',false,true,true,false,true,route_hash,now_value
    where not exists(select 1 from public.live_semantic_source_route_grants g
      where g.source_id=source_row.id::dialektik_ulid and g.policy_id=content_policy_identity
        and g.provider_type='llm_cloudflare_workers_ai'
        and g.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED');
  end loop;

  select count(*) filter(where s.canonical_domain='elmostrador.cl' and cp.excerpt_storage
      and cp.external_ai_transmission and g.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED')::int,
    count(*) filter(where s.canonical_domain='youtube.com' and cp.excerpt_storage
      and cp.external_ai_transmission and g.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED')::int
    into el_mostrador_grants,youtube_grants
  from public.sources s
  join lateral(select cp.* from public.content_access_policies cp where cp.source_id=s.id
    order by cp.recorded_at desc,cp.id desc limit 1) cp on true
  join lateral(select g.* from public.live_semantic_source_route_grants g where g.source_id=s.id
    and g.provider_type='llm_cloudflare_workers_ai' order by g.recorded_at desc,g.id desc limit 1) g on true
  where s.canonical_domain in ('elmostrador.cl','youtube.com');
  if el_mostrador_grants<>1 or youtube_grants<>32 then
    raise exception 'MIGRATION_060_GRANT_VERIFICATION_FAILED';
  end if;
end;
$seed$;
`;

export const liveSemanticEditorialPromotionMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(DDL).execute(database);
    await sql.raw(SEED).execute(database);
  },
  async down(): Promise<void> {
    throw new Error("Live semantic editorial decisions and published graph records are forward-only.");
  },
};

export const liveSemanticEditorialPromotionDdl = DDL;
