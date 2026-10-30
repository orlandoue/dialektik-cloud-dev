import { sql, type Migration } from "kysely";
import { liveSemanticPromotionFinalizeDdl } from "./062_finalize_live_semantic_promotion.js";

const SCHEMA = String.raw`
create table public.live_semantic_claim_pair_assessments (
  id dialektik_ulid primary key,
  run_id dialektik_ulid not null references public.live_semantic_production_runs(id),
  group_id dialektik_ulid not null references public.live_semantic_event_group_candidates(id),
  left_article_id dialektik_ulid not null references public.articles(id),
  left_claim_ordinal smallint not null check (left_claim_ordinal between 1 and 3),
  right_article_id dialektik_ulid not null references public.articles(id),
  right_claim_ordinal smallint not null check (right_claim_ordinal between 1 and 3),
  left_extraction_generation_id dialektik_ulid not null references public.assertion_extraction_generations(id),
  right_extraction_generation_id dialektik_ulid not null references public.assertion_extraction_generations(id),
  same_event boolean not null,
  relation text not null check (relation in ('CONSISTENT','DIVERGENT','CONTRADICTORY','NOT_COMPARABLE')),
  ratio_conflicting smallint not null check (ratio_conflicting between 0 and 100),
  ratio_comparable smallint not null check (ratio_comparable between 0 and 100),
  same_event_confidence smallint not null check (same_event_confidence between 0 and 100),
  threshold_rule text not null check (length(btrim(threshold_rule)) between 1 and 200),
  provider_type text not null check (provider_type='llm_cloudflare_workers_ai'),
  model_id text not null check (model_id='@cf/meta/llama-3.1-8b-instruct'),
  config_sha256 text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz(3) not null,
  check (left_article_id<right_article_id or
    (left_article_id=right_article_id and left_claim_ordinal<right_claim_ordinal)),
  check (ratio_conflicting<=ratio_comparable or ratio_comparable=0),
  check ((same_event or (relation='NOT_COMPARABLE' and ratio_conflicting=0 and ratio_comparable=0))),
  check (relation='NOT_COMPARABLE' or ratio_comparable>0),
  check (relation not in ('CONTRADICTORY','DIVERGENT') or
    ratio_conflicting<50 or ratio_comparable<60 or same_event),
  unique(group_id,left_article_id,left_claim_ordinal,right_article_id,right_claim_ordinal,config_sha256)
);
create index live_semantic_claim_pairs_by_group
  on public.live_semantic_claim_pair_assessments(group_id,created_at,id);
alter table public.live_semantic_claim_pair_assessments enable row level security;
revoke all on public.live_semantic_claim_pair_assessments from public,anon,authenticated,service_role;
grant select on public.live_semantic_claim_pair_assessments to dialektik_core_app;
grant select,insert on public.live_semantic_claim_pair_assessments to dialektik_headline_ai_writer;
create policy live_semantic_claim_pairs_core_read on public.live_semantic_claim_pair_assessments
  for select to dialektik_core_app using(true);
create policy live_semantic_claim_pairs_ai_read on public.live_semantic_claim_pair_assessments
  for select to dialektik_headline_ai_writer using(true);
create policy live_semantic_claim_pairs_ai_insert on public.live_semantic_claim_pair_assessments
  for insert to dialektik_headline_ai_writer with check(true);

create table public.live_semantic_promotion_positions (
  group_id dialektik_ulid not null references public.live_semantic_event_group_candidates(id),
  event_id dialektik_ulid not null references public.events(id),
  position_id dialektik_ulid not null unique references public.positions(id),
  candidate_class_id dialektik_ulid not null references public.candidate_classes(id),
  task_id dialektik_ulid not null references public.moderation_tasks(id),
  proposal_id dialektik_ulid not null references public.moderation_review_proposals(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  created_at timestamptz(3) not null,
  primary key(group_id,position_id)
);
create table public.live_semantic_promotion_claims (
  group_id dialektik_ulid not null references public.live_semantic_event_group_candidates(id),
  article_id dialektik_ulid not null references public.articles(id),
  claim_ordinal smallint not null check (claim_ordinal between 1 and 3),
  claim_span_id dialektik_ulid not null unique references public.claim_spans(id),
  assertion_id dialektik_ulid not null unique references public.assertions(id),
  evidence_id dialektik_ulid not null unique references public.evidence(id),
  position_id dialektik_ulid not null references public.positions(id),
  primary key(group_id,article_id,claim_ordinal)
);
alter table public.live_semantic_promotion_positions enable row level security;
alter table public.live_semantic_promotion_claims enable row level security;
revoke all on public.live_semantic_promotion_positions,public.live_semantic_promotion_claims
  from public,anon,authenticated,service_role,dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer;
grant select on public.live_semantic_promotion_positions,public.live_semantic_promotion_claims
  to dialektik_core_app;
create policy live_semantic_promotion_positions_core_read on public.live_semantic_promotion_positions
  for select to dialektik_core_app using(true);
create policy live_semantic_promotion_claims_core_read on public.live_semantic_promotion_claims
  for select to dialektik_core_app using(true);

-- A single-source position is valid when its principal claim has a published,
-- editor-approved evidence record. Multi-assertion positions retain the strict
-- R01a formation and closure rules from migration 003.
create or replace function public.dialektik_assert_position_formation()
returns void language plpgsql set search_path=pg_catalog,public as $$
begin
  perform public.dialektik_lock_phase_1b_graph();
  if exists (
    select 1 from public.positions position_row
    where position_row.status='active'
      and not exists (
        select 1 from public.position_formed_by formation
        join public.relationships relationship_row on relationship_row.id=formation.relationship_id
        where formation.position_id=position_row.id and relationship_row.rel_type='R01a'
          and relationship_row.publication_state='published'
          and relationship_row.event_id=position_row.event_id
          and (select count(*) from public.relationship_endpoints endpoint
            join public.assertions assertion_row on assertion_row.id=endpoint.assertion_id
            where endpoint.relationship_id=relationship_row.id
              and assertion_row.position_id=position_row.id)=2
      )
      and not (
        (select count(*) from public.current_assertions assertion_row
          where assertion_row.position_id=position_row.id)=1
        and exists (
          select 1 from public.current_assertions assertion_row
          join public.claim_spans span_row on span_row.id=assertion_row.claim_span_id
          join public.articles article_row on article_row.id=span_row.article_id
          join public.evidence evidence_row on evidence_row.scope_assertion_id=assertion_row.id
            and evidence_row.publication_state='published' and evidence_row.approved_by is not null
          where assertion_row.position_id=position_row.id and assertion_row.is_principal
            and article_row.event_id=position_row.event_id
        )
      )
  ) then
    raise exception using errcode='23514',message='active Position requires confirmed formation or one supported principal Assertion';
  end if;
  if exists (
    select 1 from public.position_formed_by formation
    join public.positions position_row on position_row.id=formation.position_id
    join public.relationships relationship_row on relationship_row.id=formation.relationship_id
    where position_row.status='active' and (
      relationship_row.rel_type<>'R01a' or relationship_row.publication_state<>'published'
      or relationship_row.event_id<>position_row.event_id
      or (select count(*) from public.relationship_endpoints endpoint
        where endpoint.relationship_id=relationship_row.id)<>2
      or exists(select 1 from public.relationship_endpoints endpoint
        join public.assertions assertion_row on assertion_row.id=endpoint.assertion_id
        join public.claim_spans span_row on span_row.id=assertion_row.claim_span_id
        join public.articles article_row on article_row.id=span_row.article_id
        where endpoint.relationship_id=relationship_row.id
          and (assertion_row.position_id<>position_row.id or article_row.event_id<>position_row.event_id))
    )
  ) then
    raise exception using errcode='23514',message='Position R01a formation is invalid';
  end if;
  if exists (
    select 1 from public.current_assertions assertion_row
    join public.positions position_row on position_row.id=assertion_row.position_id
    join public.claim_spans span_row on span_row.id=assertion_row.claim_span_id
    join public.articles article_row on article_row.id=span_row.article_id
    where article_row.event_id is distinct from position_row.event_id
      or position_row.status<>'active'
  ) then
    raise exception using errcode='23514',message='Position membership must remain active and inside its Event';
  end if;
  if exists (
    select 1 from public.positions position_row
    where position_row.status='active'
      and exists(select 1 from public.current_assertions assertion_row
        where assertion_row.position_id=position_row.id)
      and not exists(select 1 from public.position_formed_by formation
        where formation.position_id=position_row.id)
      and (select count(*) from public.current_assertions assertion_row
        where assertion_row.position_id=position_row.id)<>1
  ) then
    raise exception using errcode='23514',message='Unformed active Position must contain one current Assertion';
  end if;
end;
$$;
create or replace function public.dialektik_validate_position_formation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  perform public.dialektik_assert_position_formation();
  return null;
end;
$$;

-- Candidate and moderation-task history triggers record these state transitions
-- as moderation decisions. Keep the workflow guards aligned with that audit action.
create or replace function public.dialektik_guard_phase6_candidate_state()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare
  context_actor dialektik_ulid := nullif(current_setting('dialektik.actor_id',true),'')::dialektik_ulid;
begin
  if new.state is not distinct from old.state then return new; end if;
  if new.state='rejected' then
    raise exception using errcode='42501',message='REJECTED STATE SEMANTICS NOT AUTHORITATIVELY RESOLVED';
  end if;
  perform public.dialektik_require_phase6_actor('editor',context_actor);
  if current_setting('dialektik.action_type',true)<>'moderation_decision'
    or not exists(select 1 from public.moderation_review_proposals proposal
      where proposal.candidate_class_id=old.id and proposal.state='confirmed'
        and proposal.decided_by=context_actor) then
    raise exception using errcode='42501',message='CandidateClass transition requires a confirmed moderation proposal';
  end if;
  return new;
end;
$$;

create or replace function public.dialektik_guard_phase6_task_mutation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare
  context_actor dialektik_ulid := nullif(current_setting('dialektik.actor_id',true),'')::dialektik_ulid;
  context_role text := current_setting('dialektik.actor_type',true);
  target_role user_role;
begin
  if old.task_type<>'equivalence_review' or old.target_type<>'CandidateClass' then return new; end if;
  if new.task_type<>old.task_type or new.target_type<>old.target_type
    or new.target_id is distinct from old.target_id or new.origin_proposal_id is distinct from old.origin_proposal_id then
    raise exception using errcode='55000',message='equivalence-review task identity is immutable';
  end if;
  if new.state='rejected' then
    raise exception using errcode='42501',message='REJECTED STATE SEMANTICS NOT AUTHORITATIVELY RESOLVED';
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    perform public.dialektik_require_audit_context(array['moderation_decision']::audit_action_type[]);
    if old.state not in ('pending','escalated') then
      raise exception using errcode='23514',message='terminal moderation task assignment is immutable';
    end if;
    if exists(select 1 from public.moderation_review_proposals proposal
      where proposal.task_id=old.id and proposal.state='submitted') then
      raise exception using errcode='23514',message='task assignment cannot change with a submitted proposal';
    end if;
    if new.assigned_to is not null then
      select role into target_role from public.users where id=new.assigned_to;
      if target_role is distinct from 'moderator'::user_role then
        raise exception using errcode='42501',message='equivalence-review assignment requires a moderator';
      end if;
    end if;
    if context_role='moderator' then
      perform public.dialektik_require_phase6_actor('moderator',context_actor);
      if not ((old.state='pending' and new.state=old.state and old.assigned_to is null and new.assigned_to=context_actor)
        or (new.state=old.state and old.assigned_to=context_actor and new.assigned_to is null)
        or (old.state='pending' and new.state='escalated' and old.assigned_to=context_actor and new.assigned_to is null)) then
        raise exception using errcode='42501',message='moderator cannot take or rewrite another reviewer claim';
      end if;
    elsif context_role='editor' then
      perform public.dialektik_require_phase6_actor('editor',context_actor);
      if new.state<>old.state then
        raise exception using errcode='42501',message='editor assignment action cannot change task state';
      end if;
    else
      raise exception using errcode='42501',message='OD-12 task assignment capability denied';
    end if;
  end if;
  if new.state is distinct from old.state then
    if new.state='escalated' then
      if context_role<>'moderator' or context_actor is distinct from old.assigned_to
        or old.state<>'pending' or new.assigned_to is not null then
        raise exception using errcode='42501',message='only the assigned moderator may explicitly escalate pending work';
      end if;
    elsif new.state in ('resolved','partially_accepted') then
      perform public.dialektik_require_phase6_actor('editor',context_actor);
      if current_setting('dialektik.action_type',true)<>'moderation_decision'
        or not exists(select 1 from public.moderation_review_proposals proposal
          where proposal.task_id=old.id and proposal.state='confirmed' and proposal.decided_by=context_actor) then
        raise exception using errcode='42501',message='task completion requires the confirmed proposal transaction';
      end if;
    else
      raise exception using errcode='42501',message='unsupported equivalence-review task transition';
    end if;
  end if;
  if new.state in ('pending','escalated') then
    if new.resolved_at is not null or new.resolution_reason is not null then
      raise exception using errcode='23514',message='active moderation task cannot carry resolution metadata';
    end if;
  elsif new.resolved_at is null or new.resolution_reason is null then
    raise exception using errcode='23514',message='terminal moderation task requires resolution metadata';
  end if;
  return new;
end;
$$;
`;

const MARKERS = {
  start: "create or replace function public.dialektik_promote_live_semantic_event_group(",
  end: "create or replace function public.dialektik_live_semantic_source_allowed(",
};
const PROMOTION = String.raw`create or replace function public.dialektik_promote_live_semantic_event_group(
  group_identity dialektik_ulid,
  actor_identity dialektik_ulid,
  correlation_identity dialektik_ulid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions as $$
declare
  group_row public.live_semantic_event_group_candidates%rowtype;
  existing_row public.live_semantic_editorial_promotions%rowtype;
  item record;
  pair_row record;
  claim_row record;
  event_identity dialektik_ulid;
  category_identity dialektik_ulid;
  single_editor_identity dialektik_ulid;
  first_candidate_identity dialektik_ulid;
  first_task_identity dialektik_ulid;
  first_proposal_identity dialektik_ulid;
  candidate_identity dialektik_ulid;
  task_identity dialektik_ulid;
  proposal_identity dialektik_ulid;
  position_identity dialektik_ulid;
  assertion_identity dialektik_ulid;
  claim_span_identity dialektik_ulid;
  evidence_identity dialektik_ulid;
  relationship_identity dialektik_ulid;
  member_count integer;
  source_count integer;
  expected_pair_count integer;
  checked_pair_count integer;
  expected_claim_pair_count integer;
  checked_claim_pair_count integer;
  claim_count integer;
  position_count integer := 0;
  conflict_count integer := 0;
  event_date_from timestamptz(3);
  event_date_to timestamptz(3);
  decision_time timestamptz(3) := clock_timestamp();
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
  if current_setting('dialektik.actor_type',true)<>'editor'
    or not exists(select 1 from public.users where id=actor_identity and role='editor') then
    raise exception using errcode='42501',message='LIVE_SEMANTIC_EDITOR_REQUIRED';
  end if;
  select id into single_editor_identity from public.editorial_single_editor_authorizations
    where editor_user_id=actor_identity and revoked_at is null limit 1;
  if single_editor_identity is null then
    raise exception using errcode='42501',message='LIVE_SEMANTIC_SINGLE_EDITOR_AUTHORITY_REQUIRED';
  end if;
  select * into existing_row from public.live_semantic_editorial_promotions where group_id=group_identity;
  if found then
    return jsonb_build_object('status','PROMOTED','groupId',group_identity::text,
      'eventId',existing_row.event_id::text,'alreadyPromoted',true);
  end if;
  select * into group_row from public.live_semantic_event_group_candidates
    where id=group_identity and review_state='REVIEW_REQUIRED' for update;
  if not found then raise exception using errcode='P0002',message='LIVE_SEMANTIC_GROUP_NOT_FOUND'; end if;

  select count(*)::int,count(distinct source_id)::int into member_count,source_count
    from public.live_semantic_event_group_members where group_id=group_identity;
  if member_count<2 or source_count<2 then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','MULTI_SOURCE_GROUP_REQUIRED');
  end if;
  select count(*)::int into expected_pair_count
    from public.live_semantic_event_group_members left_member
    join public.live_semantic_event_group_members right_member
      on left_member.article_id<right_member.article_id and left_member.source_id<>right_member.source_id
    where left_member.group_id=group_identity and right_member.group_id=group_identity;
  select count(*)::int into checked_pair_count
    from public.live_semantic_pair_assessments pair_row
    join public.live_semantic_event_group_members left_member
      on left_member.group_id=pair_row.group_id and left_member.article_id=pair_row.left_article_id
    join public.live_semantic_event_group_members right_member
      on right_member.group_id=pair_row.group_id and right_member.article_id=pair_row.right_article_id
    where pair_row.group_id=group_identity and left_member.source_id<>right_member.source_id
      and pair_row.same_event and pair_row.same_event_confidence>=70;
  if expected_pair_count=0 or checked_pair_count<>expected_pair_count then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','EVENT_PAIR_CONFIRMATION_INCOMPLETE');
  end if;
  select count(*)::int into claim_count
    from public.live_semantic_event_group_members member
    join public.assertion_extraction_generations generation on generation.id=member.extraction_generation_id
    cross join lateral jsonb_array_elements(generation.proposal_payload->'spans') claim;
  select count(*)::int into expected_claim_pair_count from (
    select left_member.article_id,left_claim.ordinality left_ordinal,
      right_member.article_id,right_claim.ordinality right_ordinal
    from public.live_semantic_event_group_members left_member
    join public.assertion_extraction_generations left_generation on left_generation.id=left_member.extraction_generation_id
    cross join lateral jsonb_array_elements(left_generation.proposal_payload->'spans') with ordinality left_claim(claim,ordinality)
    join public.live_semantic_event_group_members right_member on right_member.group_id=left_member.group_id
    join public.assertion_extraction_generations right_generation on right_generation.id=right_member.extraction_generation_id
    cross join lateral jsonb_array_elements(right_generation.proposal_payload->'spans') with ordinality right_claim(claim,ordinality)
    where left_member.group_id=group_identity and right_member.group_id=group_identity and (
      left_member.article_id<right_member.article_id or
      (left_member.article_id=right_member.article_id and left_claim.ordinality<right_claim.ordinality))
  ) expected;
  select count(*)::int into checked_claim_pair_count
    from public.live_semantic_claim_pair_assessments pair_row
    join public.live_semantic_event_group_members left_member
      on left_member.group_id=pair_row.group_id and left_member.article_id=pair_row.left_article_id
    join public.live_semantic_event_group_members right_member
      on right_member.group_id=pair_row.group_id and right_member.article_id=pair_row.right_article_id
    where pair_row.group_id=group_identity
      and pair_row.left_extraction_generation_id=left_member.extraction_generation_id
      and pair_row.right_extraction_generation_id=right_member.extraction_generation_id;
  if expected_claim_pair_count<>checked_claim_pair_count then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','CLAIM_PAIR_ASSESSMENT_INCOMPLETE');
  end if;
  if exists(select 1 from public.live_semantic_event_group_members member
    join public.articles article on article.id=member.article_id
    where member.group_id=group_identity and article.event_id is not null) then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','ARTICLE_ALREADY_LINKED');
  end if;
  select min(input.published_at),max(input.published_at) into event_date_from,event_date_to
    from public.live_semantic_event_group_members member
    join public.live_semantic_excerpt_inputs input on input.article_id=member.article_id::text
    where member.group_id=group_identity;
  if event_date_from is null or event_date_to-event_date_from>interval '48 hours' then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','EVENT_WINDOW_INVALID');
  end if;
  for item in
    select member.article_id::dialektik_ulid article_id,input.text_original,input.input_sha256,
      generation.proposal_payload->'spans' spans
    from public.live_semantic_event_group_members member
    join public.live_semantic_excerpt_inputs input on input.article_id=member.article_id::text
    join public.assertion_extraction_generations generation on generation.id=member.extraction_generation_id
    where member.group_id=group_identity
  loop
    if jsonb_typeof(item.spans) is distinct from 'array' then
      return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','CLAIM_COUNT_INVALID');
    end if;
    if jsonb_array_length(item.spans) not between 1 and 3 then
      return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','CLAIM_COUNT_INVALID');
    end if;
    for claim_row in select value from jsonb_array_elements(item.spans) loop
      quote_text:=claim_row.value->>'quoted_text';
      quote_start:=nullif(claim_row.value->>'start','')::integer;
      quote_end:=nullif(claim_row.value->>'end','')::integer;
      if quote_text is null or quote_start is null or quote_end is null or quote_start<0
        or quote_end<=quote_start or quote_end-quote_start>300
        or substring(item.text_original from quote_start+1 for quote_end-quote_start)<>quote_text
        or not public.dialektik_live_semantic_route_allowed(item.article_id,item.input_sha256,
          'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct') then
        return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','QUOTE_OR_RIGHTS_VALIDATION_FAILED');
      end if;
    end loop;
  end loop;
  if (select count(*) from public.live_semantic_event_group_members where group_id=group_identity)<>member_count then
    raise exception using errcode='23514',message='LIVE_SEMANTIC_GROUP_MEMBER_COUNT_CHANGED';
  end if;
  select id into category_identity from public.categories where is_active and slug=case
    when group_row.proposed_event_key ~* '(afp|ipom|presupuesto|econom)' then 'economia'
    when group_row.proposed_event_key ~* '(eleccion|servel|ministro|corte|politic|monsalve)' then 'politica'
    else 'pais' end limit 1;
  if category_identity is null then raise exception using errcode='23503',message='LIVE_SEMANTIC_CATEGORY_NOT_CONFIGURED'; end if;
  event_identity:=public.dialektik_generate_ulid();
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'created','live_semantic_event_creation');
  insert into public.events(id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,origin)
    values(event_identity,left(btrim(group_row.proposed_title),240),category_identity,event_date_from,event_date_to,
      decision_time,'ANALYSIS_PENDING','LIVE_REAL');
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'membership_changed','live_semantic_article_event_link');
  update public.articles set event_id=event_identity where id in
    (select article_id from public.live_semantic_event_group_members where group_id=group_identity);

  candidate_identity:=public.dialektik_generate_ulid();
  task_identity:=public.dialektik_generate_ulid();
  proposal_identity:=public.dialektik_generate_ulid();
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'moderation_decision','live_semantic_equivalence_review');
  insert into public.candidate_classes(id,event_id,model_ref,model_version,created_at,state)
    values(candidate_identity,event_identity,'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct',decision_time,'proposed');

  create temporary table if not exists dialektik_live_semantic_promotion_claims (
    article_id dialektik_ulid not null,claim_ordinal smallint not null,claim_span_id dialektik_ulid not null,
    assertion_id dialektik_ulid not null,evidence_id dialektik_ulid not null,position_id dialektik_ulid not null,
    candidate_class_id dialektik_ulid not null,task_id dialektik_ulid not null,proposal_id dialektik_ulid not null,
    position_title text not null,primary key(article_id,claim_ordinal)
  ) on commit delete rows;
  truncate table pg_temp.dialektik_live_semantic_promotion_claims;

  for item in
    select member.article_id::dialektik_ulid article_id,input.text_original,input.input_sha256,
      input.url_canonical,input.headline,input.published_at,input.source_name,
      generation.proposal_payload->'spans' spans
    from public.live_semantic_event_group_members member
    join public.live_semantic_excerpt_inputs input on input.article_id=member.article_id::text
    join public.assertion_extraction_generations generation on generation.id=member.extraction_generation_id
    where member.group_id=group_identity order by member.article_id
  loop
    for claim_row in select value,ordinality::smallint ordinal from jsonb_array_elements(item.spans) with ordinality loop
      claim_span_identity:=public.dialektik_generate_ulid();
      assertion_identity:=public.dialektik_generate_ulid();
      evidence_identity:=public.dialektik_generate_ulid();
      position_identity:=public.dialektik_generate_ulid();
      quote_text:=claim_row.value->>'quoted_text';
      quote_start:=(claim_row.value->>'start')::integer;
      quote_end:=(claim_row.value->>'end')::integer;
      assertion_text:=left(btrim(claim_row.value->>'assertion_text'),300);
      position_text:=left(btrim(coalesce(nullif(claim_row.value->>'position_summary',''),group_row.proposed_title)),240);
      insert into public.claim_spans(id,article_id,text_offset_start,text_offset_end,quoted_text,location,captured_at)
        values(claim_span_identity,item.article_id,quote_start,quote_end,quote_text,
          case when quote_start<length(item.headline) then 'headline'::public.span_location else 'lede'::public.span_location end,
          decision_time);
      insert into public.assertions(id,claim_span_id,ordinal,is_principal,assertion_type,subject_ref,temporal_scope,
        population_scope,comparison_base,position_id,epistemic_class,epistemic_reason,extraction_confidence,
        version,supersedes_id,lineage_root_id,lifecycle_state)
        values(assertion_identity,claim_span_identity,1,true,'existence',left(group_row.proposed_event_key,200),
          jsonb_build_object('from',to_char(event_date_from at time zone 'UTC','YYYY-MM-DD'),
            'to',to_char(event_date_to at time zone 'UTC','YYYY-MM-DD'),'granularity','event_window'),
          null,left(group_row.proposed_event_key,200),null,null,null,0.9,1,null,assertion_identity,'active');
      perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
        'evidence_published','live_semantic_evidence_approval');
      insert into public.evidence(id,anchor_span_id,scope_assertion_id,stance,summary,citable_source_url,
        citable_source_title,contributed_by,publication_state,approved_by,approved_at,relevance)
        values(evidence_identity,claim_span_identity,assertion_identity,'supports',assertion_text,item.url_canonical,
          item.headline,actor_identity,'published',actor_identity,decision_time,1.0);
      perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
        'created','live_semantic_position');
      insert into public.positions(id,event_id,neutral_rank,title_text,publication_state,published_at,published_by,status)
        values(position_identity,event_identity,null,coalesce(nullif(position_text,''),left(item.headline,240)),
          'internal',null,null,'active');
      insert into public.position_title_generated_from(position_id,assertion_id,ordinal)
        values(position_identity,assertion_identity,1);
      insert into public.candidate_class_members(candidate_class_id,assertion_id)
        values(candidate_identity,assertion_identity);
      perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
        'membership_changed','live_semantic_position_membership');
      update public.assertions set position_id=position_identity where id=assertion_identity;
      perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
        'published','live_semantic_position_publication');
      update public.positions set neutral_rank=position_count+1,publication_state='published',
        published_at=decision_time,published_by=actor_identity where id=position_identity;
      insert into pg_temp.dialektik_live_semantic_promotion_claims
        values(item.article_id,claim_row.ordinal,claim_span_identity,assertion_identity,evidence_identity,
          position_identity,candidate_identity,task_identity,proposal_identity,position_text);
      insert into public.live_semantic_promotion_claims(group_id,article_id,claim_ordinal,claim_span_id,
        assertion_id,evidence_id,position_id)
        values(group_identity,item.article_id,claim_row.ordinal,claim_span_identity,assertion_identity,
          evidence_identity,position_identity);
      if first_candidate_identity is null then
        first_candidate_identity:=candidate_identity;first_task_identity:=task_identity;first_proposal_identity:=proposal_identity;
      end if;
      position_count:=position_count+1;
    end loop;
  end loop;

  if position_count<2 then
    raise exception using errcode='23514',message='LIVE_SEMANTIC_SPLIT_REQUIRES_MULTIPLE_CLAIMS';
  end if;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'moderation_decision','live_semantic_equivalence_review');
  insert into public.moderation_tasks(id,task_type,target_type,target_id,state,priority,assigned_to,created_at,
    resolved_at,resolution_reason,projection_event_id,projection_position_a_id,projection_position_b_id,
    projection_hash,origin_proposal_id)
    values(task_identity,'equivalence_review','CandidateClass',candidate_identity,'pending',0,null,
      decision_time,null,null,null,null,null,null,null);
  insert into public.moderation_review_proposal_members(proposal_id,assertion_id,partition_ordinal)
    select proposal_identity,assertion_id,row_number() over(order by assertion_id)::integer
    from pg_temp.dialektik_live_semantic_promotion_claims;
  select encode(extensions.digest(convert_to(jsonb_build_object('outcome','split',
    'partitions',jsonb_agg(jsonb_build_array(assertion_id::text) order by assertion_id))::text,
    'UTF8'),'sha256'),'hex') into payload_hash
    from pg_temp.dialektik_live_semantic_promotion_claims;
  insert into public.moderation_review_proposals(id,task_id,candidate_class_id,outcome,proposer_id,payload_hash,
    state,submitted_at,decided_by,decided_at,decision_reason,single_editor_authorization_id)
    values(proposal_identity,task_identity,candidate_identity,'split',actor_identity,payload_hash,
      'submitted',decision_time,null,null,null,single_editor_identity);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'confirmed','live_semantic_single_editor_approval');
  update public.moderation_review_proposals set state='confirmed',decided_by=actor_identity,decided_at=decision_time
    where id=proposal_identity;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'moderation_decision','live_semantic_candidate_split');
  update public.candidate_classes set state='superseded' where id=candidate_identity;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'moderation_decision','live_semantic_task_resolution');
  update public.moderation_tasks set state='resolved',resolved_at=decision_time,
    resolution_reason='live_semantic_single_editor_split_promotion' where id=task_identity;
  insert into public.live_semantic_promotion_positions(group_id,event_id,position_id,candidate_class_id,
    task_id,proposal_id,editor_user_id,created_at)
    select group_identity,event_identity,position_id,candidate_identity,task_identity,proposal_identity,
      actor_identity,decision_time
    from pg_temp.dialektik_live_semantic_promotion_claims;

  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'confirmed','live_semantic_conflict_assessment');
  for pair_row in
    select assessment.*,left_claim.assertion_id left_assertion_id,right_claim.assertion_id right_assertion_id,
      left_claim.proposal_id left_proposal_id
    from public.live_semantic_claim_pair_assessments assessment
    join pg_temp.dialektik_live_semantic_promotion_claims left_claim
      on left_claim.article_id=assessment.left_article_id and left_claim.claim_ordinal=assessment.left_claim_ordinal
    join pg_temp.dialektik_live_semantic_promotion_claims right_claim
      on right_claim.article_id=assessment.right_article_id and right_claim.claim_ordinal=assessment.right_claim_ordinal
    join public.live_semantic_event_group_members left_member
      on left_member.group_id=assessment.group_id and left_member.article_id=assessment.left_article_id
    join public.live_semantic_event_group_members right_member
      on right_member.group_id=assessment.group_id and right_member.article_id=assessment.right_article_id
    where assessment.group_id=group_identity and assessment.same_event
      and left_member.source_id<>right_member.source_id
      and assessment.relation in ('CONTRADICTORY','DIVERGENT')
      and assessment.ratio_conflicting>=50 and assessment.ratio_comparable>=60
    order by assessment.left_article_id,assessment.left_claim_ordinal,
      assessment.right_article_id,assessment.right_claim_ordinal
  loop
    relationship_identity:=public.dialektik_generate_ulid();
    insert into public.relationships(id,rel_type,event_id,scope,publication_state,confidence,declared_by,
      confirmed_by,confirmed_at,non_comparable_reason,triggering_evidence_id,rectified_by,moderation_proposal_id)
      values(relationship_identity,'R05',event_identity,'intra_event','published','medium',actor_identity,
        actor_identity,decision_time,null,null,null,null);
    if pair_row.left_assertion_id<pair_row.right_assertion_id then
      insert into public.relationship_endpoints(relationship_id,assertion_id,role,endpoint_order)
        values(relationship_identity,pair_row.left_assertion_id,'peer',1),
          (relationship_identity,pair_row.right_assertion_id,'peer',2);
    else
      insert into public.relationship_endpoints(relationship_id,assertion_id,role,endpoint_order)
        values(relationship_identity,pair_row.right_assertion_id,'peer',1),
          (relationship_identity,pair_row.left_assertion_id,'peer',2);
    end if;
  end loop;

  update public.events set analysis_state='PUBLISHED' where id=event_identity;
  insert into public.public_events(id,title_descriptive,category_id,window_from,window_to,detected_at,
    analysis_state,merged_into,merged_by,merged_at,origin)
    select id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,merged_into,merged_by,merged_at,origin
    from public.events where id=event_identity
    on conflict(id) where id is not null do update set title_descriptive=excluded.title_descriptive,
      category_id=excluded.category_id,window_from=excluded.window_from,window_to=excluded.window_to,
      detected_at=excluded.detected_at,analysis_state=excluded.analysis_state,
      merged_into=excluded.merged_into,merged_by=excluded.merged_by,merged_at=excluded.merged_at,
      origin=excluded.origin;
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'published','live_semantic_contradiction_publication');
  insert into public.contradiction_publications(id,event_id,position_a_id,position_b_id,projection_hash,
    ratio_conflicting_at_publication,ratio_comparable_at_publication,threshold_rule_at_publication,
    confirmed_by,confirmed_at,publication_state,retracted_by,retracted_at,retraction_reason)
    select public.dialektik_generate_ulid(),projection.event_id,projection.position_a_id,projection.position_b_id,
      projection.projection_hash,projection.conflict_pairs,projection.comparable_pairs,
      'v1:any_confirmed_conflict',actor_identity,decision_time,'published',null,null,null
    from public.position_relation_projections projection
    where projection.event_id=event_identity and projection.publication_eligible
      and not projection.requires_review and projection.conflict_pairs>0 and projection.comparable_pairs>0
      and not exists(select 1 from public.contradiction_publications existing
        where existing.event_id=projection.event_id and existing.position_a_id=projection.position_a_id
          and existing.position_b_id=projection.position_b_id and existing.publication_state='published');
  get diagnostics conflict_count=row_count;

  insert into public.live_semantic_editorial_promotions(group_id,event_id,candidate_class_id,task_id,proposal_id,
    editor_user_id,correlation_id,created_at)
    values(group_identity,event_identity,first_candidate_identity,first_task_identity,first_proposal_identity,
      actor_identity,correlation_identity,decision_time);
  response_json:=jsonb_build_object('status','PROMOTED','groupId',group_identity::text,
    'eventId',event_identity::text,'candidateClassId',first_candidate_identity::text,
    'taskId',first_task_identity::text,'proposalId',first_proposal_identity::text,
    'articleCount',member_count,'sourceCount',source_count,'claimSpansCreated',claim_count,
    'assertionsCreated',claim_count,'evidenceCreated',claim_count,'positionsCreated',position_count,
    'contradictionsPublished',conflict_count,'editorUserId',actor_identity::text);
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,
    'confirmed','live_semantic_command_receipt');
  insert into public.moderation_command_receipts(actor_id,task_id,command_id,command_type,payload_hash,response_payload,created_at)
    values(actor_identity,first_task_identity,correlation_identity,'confirm_proposal',
      encode(extensions.digest(convert_to(response_json::text,'UTF8'),'sha256'),'hex'),response_json,decision_time)
    on conflict(actor_id,task_id,command_id) do nothing;
  set constraints all immediate;
  return response_json;
end;
$$;
revoke all on function public.dialektik_promote_live_semantic_event_group(dialektik_ulid,dialektik_ulid,dialektik_ulid)
  from public,anon,authenticated,dialektik_core_app,dialektik_headline_ai_writer;
grant execute on function public.dialektik_promote_live_semantic_event_group(dialektik_ulid,dialektik_ulid,dialektik_ulid)
  to dialektik_moderation_writer;
`;

function replacedPromotionDdl(): string {
  const start = liveSemanticPromotionFinalizeDdl.indexOf(MARKERS.start);
  const end = liveSemanticPromotionFinalizeDdl.indexOf(MARKERS.end, start);
  if (start < 0 || end < 0) throw new Error("MIGRATION_067_PROMOTION_MARKER_MISSING");
  return liveSemanticPromotionFinalizeDdl.slice(0, start) + PROMOTION + "\n" +
    liveSemanticPromotionFinalizeDdl.slice(end);
}

export const liveSemanticMultiClaimPositionsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
    await sql.raw(replacedPromotionDdl()).execute(database);
  },
  async down(): Promise<void> {
    throw new Error("Multi-claim editorial promotion history is forward-only.");
  },
};
