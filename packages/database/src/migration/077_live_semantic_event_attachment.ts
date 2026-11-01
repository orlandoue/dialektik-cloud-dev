import { sql, type Migration } from "kysely";

export const liveSemanticEventAttachmentDdl = String.raw`
create table public.live_semantic_editorial_attachments (
  group_id dialektik_ulid primary key references public.live_semantic_event_group_candidates(id),
  event_id dialektik_ulid not null references public.events(id),
  article_id dialektik_ulid not null unique references public.articles(id),
  position_id dialektik_ulid not null references public.positions(id),
  assertion_id dialektik_ulid not null unique references public.assertions(id),
  evidence_id dialektik_ulid not null unique references public.evidence(id),
  relationship_id dialektik_ulid not null unique references public.relationships(id),
  proposal_id dialektik_ulid not null unique references public.moderation_review_proposals(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  correlation_id dialektik_ulid not null unique,
  created_at timestamptz(3) not null
);
alter table public.live_semantic_editorial_attachments enable row level security;
revoke all on public.live_semantic_editorial_attachments from public,anon,authenticated,service_role,
  dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer;
grant select on public.live_semantic_editorial_attachments to dialektik_core_app,dialektik_headline_ai_writer;
create policy live_semantic_attachments_core_read on public.live_semantic_editorial_attachments
  for select to dialektik_core_app using(true);
create policy live_semantic_attachments_ai_read on public.live_semantic_editorial_attachments
  for select to dialektik_headline_ai_writer using(true);

-- Attach one additional source when the selected claim was assessed as
-- consistent with an existing, editor-supported assertion in the same event.
create function public.dialektik_attach_live_semantic_article(
  group_identity dialektik_ulid,actor_identity dialektik_ulid,correlation_identity dialektik_ulid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
  decision_row public.live_semantic_editorial_decisions%rowtype;
  group_row public.live_semantic_event_group_candidates%rowtype;
  linked record;
  incoming record;
  previous_assertion public.assertions%rowtype;
  event_row public.events%rowtype;
  single_editor_identity dialektik_ulid;
  candidate_identity dialektik_ulid := public.dialektik_generate_ulid();
  task_identity dialektik_ulid := public.dialektik_generate_ulid();
  proposal_identity dialektik_ulid := public.dialektik_generate_ulid();
  span_identity dialektik_ulid := public.dialektik_generate_ulid();
  assertion_identity dialektik_ulid := public.dialektik_generate_ulid();
  evidence_identity dialektik_ulid := public.dialektik_generate_ulid();
  relationship_identity dialektik_ulid := public.dialektik_generate_ulid();
  decision_time timestamptz(3) := clock_timestamp();
  quote_text text;
  quote_start integer;
  quote_end integer;
  payload_hash text;
  assessment_config text;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:live-semantic-promote:'||group_identity::text,0));
  perform public.dialektik_require_context_actor(actor_identity);
  if current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or not exists(select 1 from public.users where id=actor_identity and role='editor') then
    raise exception using errcode='42501',message='LIVE_SEMANTIC_EDITOR_REQUIRED';
  end if;
  select id into single_editor_identity from public.editorial_single_editor_authorizations
    where editor_user_id=actor_identity and revoked_at is null limit 1;
  if single_editor_identity is null then raise exception using errcode='42501',message='LIVE_SEMANTIC_SINGLE_EDITOR_AUTHORITY_REQUIRED'; end if;
  if exists(select 1 from public.live_semantic_editorial_attachments where group_id=group_identity) then
    return jsonb_build_object('status','ALREADY_ATTACHED','groupId',group_identity::text);
  end if;
  select * into group_row from public.live_semantic_event_group_candidates where id=group_identity for update;
  select * into decision_row from public.live_semantic_editorial_decisions where group_id=group_identity
    and decision='APPROVED' and editor_user_id=actor_identity and correlation_id=correlation_identity;
  if group_row.id is null or decision_row.group_id is null or jsonb_array_length(decision_row.selected_claims)<>2
    or decision_row.approved_conflict_pair_ids<>'[]'::jsonb then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','TWO_CLAIMS_AND_EDITORIAL_DECISION_REQUIRED');
  end if;
  if (select count(*) from public.live_semantic_event_group_members where group_id=group_identity)<>2
    or (select count(distinct source_id) from public.live_semantic_event_group_members where group_id=group_identity)<>2 then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','TWO_SOURCE_GROUP_REQUIRED');
  end if;
  select member.article_id,member.source_id,member.extraction_generation_id,article.event_id,
    input.text_original,input.input_sha256,input.url_canonical,input.headline,input.published_at,
    (selection.value->>'ordinal')::integer as ordinal,
    generation.proposal_payload->'spans'->((selection.value->>'ordinal')::integer-1) as span
  into linked
  from public.live_semantic_event_group_members member
  join public.articles article on article.id=member.article_id and article.event_id is not null
  join public.live_semantic_excerpt_inputs input on input.article_id=member.article_id::text
  join public.assertion_extraction_generations generation on generation.id=member.extraction_generation_id
    and generation.state='active' and generation.input_hash=input.input_sha256
  join lateral jsonb_array_elements(decision_row.selected_claims) selection on selection.value->>'articleId'=member.article_id::text
  where member.group_id=group_identity;
  select member.article_id,member.source_id,member.extraction_generation_id,article.event_id,
    input.text_original,input.input_sha256,input.url_canonical,input.headline,input.published_at,
    (selection.value->>'ordinal')::integer as ordinal,
    generation.proposal_payload->'spans'->((selection.value->>'ordinal')::integer-1) as span
  into incoming
  from public.live_semantic_event_group_members member
  join public.articles article on article.id=member.article_id and article.event_id is null and article.origin='LIVE_REAL'
  join public.live_semantic_excerpt_inputs input on input.article_id=member.article_id::text
  join public.assertion_extraction_generations generation on generation.id=member.extraction_generation_id
    and generation.state='active' and generation.input_hash=input.input_sha256
  join lateral jsonb_array_elements(decision_row.selected_claims) selection on selection.value->>'articleId'=member.article_id::text
  where member.group_id=group_identity;
  if linked.article_id is null or incoming.article_id is null then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','ONE_LINKED_AND_ONE_NEW_ARTICLE_REQUIRED');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dialektik:live-semantic-attach:'||linked.event_id::text,0));
  select * into event_row from public.events where id=linked.event_id and origin='LIVE_REAL'
    and analysis_state='PUBLISHED' and merged_into is null for update;
  if event_row.id is null or greatest(coalesce(event_row.window_to,event_row.window_from),incoming.published_at)
      -least(event_row.window_from,incoming.published_at)>interval '48 hours' then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','EXISTING_EVENT_OR_WINDOW_INVALID');
  end if;
  assessment_config:=encode(extensions.digest(convert_to(group_row.config_sha256||E'\n'||'stance-pair-v1','UTF8'),'sha256'),'hex');
  if not exists(select 1 from public.live_semantic_claim_pair_assessments pair
    where pair.group_id=group_identity and pair.config_sha256=assessment_config and pair.same_event
      and pair.same_event_confidence>=70 and pair.relation='CONSISTENT'
      and pair.ratio_comparable>=60 and pair.ratio_conflicting<35
      and ((pair.left_article_id=linked.article_id and pair.left_claim_ordinal=linked.ordinal
        and pair.left_extraction_generation_id=linked.extraction_generation_id
        and pair.right_article_id=incoming.article_id and pair.right_claim_ordinal=incoming.ordinal
        and pair.right_extraction_generation_id=incoming.extraction_generation_id)
       or (pair.right_article_id=linked.article_id and pair.right_claim_ordinal=linked.ordinal
        and pair.right_extraction_generation_id=linked.extraction_generation_id
        and pair.left_article_id=incoming.article_id and pair.left_claim_ordinal=incoming.ordinal
        and pair.left_extraction_generation_id=incoming.extraction_generation_id))) then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','CONSISTENT_REASSESSMENT_REQUIRED');
  end if;
  quote_text:=incoming.span->>'quoted_text';
  quote_start:=nullif(incoming.span->>'start','')::integer;
  quote_end:=nullif(incoming.span->>'end','')::integer;
  if quote_text is null or quote_start is null or quote_end is null or quote_start<0
    or quote_end<=quote_start or quote_end-quote_start>300
    or substring(incoming.text_original from quote_start+1 for quote_end-quote_start)<>quote_text
    or not public.dialektik_live_semantic_route_allowed(incoming.article_id,incoming.input_sha256,
      'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct')
    or not public.dialektik_live_semantic_route_allowed(linked.article_id,linked.input_sha256,
      'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct') then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','QUOTE_OR_RIGHTS_VALIDATION_FAILED');
  end if;
  select assertion.* into previous_assertion from public.assertions assertion
  join public.claim_spans span on span.id=assertion.claim_span_id and span.article_id=linked.article_id
  join public.positions position_row on position_row.id=assertion.position_id
    and position_row.event_id=event_row.id and position_row.status='active' and position_row.publication_state='published'
  where assertion.lifecycle_state='active' and assertion.is_principal and span.tombstone_id is null
    and nullif(linked.span->>'quoted_text','') is not null
    and strpos(span.quoted_text,linked.span->>'quoted_text')>0
    and not exists(select 1 from public.assertions successor where successor.supersedes_id=assertion.id)
    and exists(select 1 from public.evidence evidence where evidence.scope_assertion_id=assertion.id
      and evidence.publication_state='published' and evidence.approved_by is not null)
  order by assertion.id limit 1;
  if previous_assertion.id is null then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','EXISTING_SUPPORTED_ASSERTION_REQUIRED');
  end if;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'membership_changed','live_semantic_article_attachment');
  update public.articles set event_id=event_row.id where id=incoming.article_id and event_id is null;
  if not found then raise exception using errcode='23514',message='LIVE_SEMANTIC_ARTICLE_CHANGED'; end if;
  insert into public.claim_spans(id,article_id,text_offset_start,text_offset_end,quoted_text,location,captured_at)
    values(span_identity,incoming.article_id,quote_start,quote_end,quote_text,
      case when quote_start<length(incoming.headline) then 'headline'::public.span_location else 'lede'::public.span_location end,decision_time);
  insert into public.assertions(id,claim_span_id,ordinal,is_principal,assertion_type,subject_ref,temporal_scope,
    population_scope,comparison_base,position_id,epistemic_class,epistemic_reason,extraction_confidence,
    version,supersedes_id,lineage_root_id,lifecycle_state)
    values(assertion_identity,span_identity,1,true,previous_assertion.assertion_type,previous_assertion.subject_ref,
      previous_assertion.temporal_scope,previous_assertion.population_scope,previous_assertion.comparison_base,
      null,null,null,previous_assertion.extraction_confidence,1,null,assertion_identity,'active');
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'evidence_published','live_semantic_attachment_evidence');
  insert into public.evidence(id,anchor_span_id,scope_assertion_id,stance,summary,citable_source_url,citable_source_title,
    contributed_by,publication_state,approved_by,approved_at,relevance)
    values(evidence_identity,span_identity,assertion_identity,'supports',left(btrim(incoming.span->>'assertion_text'),300),
      incoming.url_canonical,incoming.headline,actor_identity,'published',actor_identity,decision_time,1.0);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'moderation_decision','live_semantic_attachment_review');
  insert into public.candidate_classes(id,event_id,model_ref,model_version,created_at,state)
    values(candidate_identity,event_row.id,'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct',decision_time,'proposed');
  insert into public.candidate_class_members(candidate_class_id,assertion_id)
    values(candidate_identity,previous_assertion.id),(candidate_identity,assertion_identity);
  insert into public.moderation_tasks(id,task_type,target_type,target_id,state,priority,assigned_to,created_at,
    resolved_at,resolution_reason,projection_event_id,projection_position_a_id,projection_position_b_id,projection_hash,origin_proposal_id)
    values(task_identity,'equivalence_review','CandidateClass',candidate_identity,'pending',0,null,decision_time,
      null,null,null,null,null,null,null);
  insert into public.moderation_review_proposal_members(proposal_id,assertion_id,partition_ordinal)
    values(proposal_identity,previous_assertion.id,null),(proposal_identity,assertion_identity,null);
  select encode(extensions.digest(convert_to(jsonb_build_object('outcome','accept_subset',
    'assertionIds',jsonb_agg(member.assertion_id::text order by member.assertion_id))::text,'UTF8'),'sha256'),'hex')
    into payload_hash from public.moderation_review_proposal_members member where member.proposal_id=proposal_identity;
  insert into public.moderation_review_proposals(id,task_id,candidate_class_id,outcome,proposer_id,payload_hash,
    state,submitted_at,decided_by,decided_at,decision_reason,single_editor_authorization_id)
    values(proposal_identity,task_identity,candidate_identity,'accept_subset',actor_identity,payload_hash,
      'submitted',decision_time,null,null,null,single_editor_identity);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'confirmed','live_semantic_attachment_confirmation');
  update public.moderation_review_proposals set state='confirmed',decided_by=actor_identity,decided_at=decision_time where id=proposal_identity;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'moderation_decision','live_semantic_attachment_acceptance');
  update public.candidate_classes set state='accepted' where id=candidate_identity;
  update public.moderation_tasks set state='resolved',resolved_at=decision_time,
    resolution_reason='live_semantic_single_editor_attachment' where id=task_identity;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'confirmed','live_semantic_attachment_formation');
  insert into public.relationships(id,rel_type,event_id,scope,publication_state,declared_by,confirmed_by,confirmed_at,
    non_comparable_reason,triggering_evidence_id,rectified_by,confidence,similarity_score,moderation_proposal_id)
    values(relationship_identity,'R01a',event_row.id,'intra_event','published',actor_identity,actor_identity,decision_time,
      null,null,null,null,null,proposal_identity);
  insert into public.relationship_endpoints(relationship_id,assertion_id,role,endpoint_order)
    values(relationship_identity,least(previous_assertion.id,assertion_identity),'peer',1),
      (relationship_identity,greatest(previous_assertion.id,assertion_identity),'peer',2);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'membership_changed','live_semantic_attachment_membership');
  update public.assertions set position_id=previous_assertion.position_id where id=assertion_identity;
  insert into public.position_formed_by(position_id,relationship_id,ordinal)
    select previous_assertion.position_id,relationship_identity,coalesce(max(ordinal),0)+1
      from public.position_formed_by where position_id=previous_assertion.position_id;
  update public.events set window_from=least(window_from,incoming.published_at),
    window_to=greatest(coalesce(window_to,window_from),incoming.published_at) where id=event_row.id;
  insert into public.public_events(id,title_descriptive,category_id,window_from,window_to,detected_at,
    analysis_state,merged_into,merged_by,merged_at,origin)
    select id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,merged_into,merged_by,merged_at,origin
    from public.events where id=event_row.id
    on conflict(id) where id is not null do update set title_descriptive=excluded.title_descriptive,
      category_id=excluded.category_id,window_from=excluded.window_from,window_to=excluded.window_to,
      detected_at=excluded.detected_at,analysis_state=excluded.analysis_state,
      merged_into=excluded.merged_into,merged_by=excluded.merged_by,merged_at=excluded.merged_at,origin=excluded.origin;
  insert into public.live_semantic_editorial_attachments(group_id,event_id,article_id,position_id,assertion_id,
    evidence_id,relationship_id,proposal_id,editor_user_id,correlation_id,created_at)
    values(group_identity,event_row.id,incoming.article_id,previous_assertion.position_id,assertion_identity,
      evidence_identity,relationship_identity,proposal_identity,actor_identity,correlation_identity,decision_time);
  set constraints all immediate;
  return jsonb_build_object('status','ATTACHED','groupId',group_identity::text,'eventId',event_row.id::text,
    'articleId',incoming.article_id::text,'positionId',previous_assertion.position_id::text,'assertionId',assertion_identity::text);
end;
$$;
revoke all on function public.dialektik_attach_live_semantic_article(dialektik_ulid,dialektik_ulid,dialektik_ulid)
  from public,anon,authenticated,service_role,dialektik_core_app,dialektik_headline_ai_writer;
grant execute on function public.dialektik_attach_live_semantic_article(dialektik_ulid,dialektik_ulid,dialektik_ulid)
  to dialektik_moderation_writer;
`;

export const liveSemanticEventAttachmentMigration: Migration = {
  async up(database): Promise<void> { await sql.raw(liveSemanticEventAttachmentDdl).execute(database); },
  async down(): Promise<void> { throw new Error("Editorial attachment history is forward-only."); },
};
