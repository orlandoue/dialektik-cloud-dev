import { sql, type Migration } from 'kysely';

export const jointClaimMaterializationDdl = String.raw`
create table public.live_semantic_joint_editorial_decisions (
  attempt_id dialektik_ulid primary key references public.live_semantic_joint_scope_attempts(id),
  left_claim_id dialektik_ulid not null references public.live_semantic_joint_claims(id),
  right_claim_id dialektik_ulid not null references public.live_semantic_joint_claims(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  correlation_id dialektik_ulid not null unique,
  reason text not null check(length(btrim(reason)) between 12 and 500),
  conflict_approved boolean not null,
  decided_at timestamptz(3) not null default clock_timestamp(),
  check(left_claim_id<>right_claim_id)
);
create table public.live_semantic_joint_claim_publications (
  joint_claim_id dialektik_ulid primary key references public.live_semantic_joint_claims(id),
  claim_span_id dialektik_ulid not null unique references public.claim_spans(id),
  assertion_id dialektik_ulid not null unique references public.assertions(id),
  evidence_id dialektik_ulid not null unique references public.evidence(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  created_at timestamptz(3) not null
);
create function public.dialektik_preserve_joint_publication_history() returns trigger
language plpgsql as $$ begin raise exception using errcode='55000',message='JOINT_PUBLICATION_HISTORY_IMMUTABLE'; end $$;
create trigger joint_decision_immutable before update or delete on public.live_semantic_joint_editorial_decisions
for each row execute function public.dialektik_preserve_joint_publication_history();
create trigger joint_publication_immutable before update or delete on public.live_semantic_joint_claim_publications
for each row execute function public.dialektik_preserve_joint_publication_history();
alter table public.live_semantic_joint_editorial_decisions enable row level security;
alter table public.live_semantic_joint_claim_publications enable row level security;
revoke all on public.live_semantic_joint_editorial_decisions,public.live_semantic_joint_claim_publications
  from public,anon,authenticated,service_role,dialektik_moderation_writer;
grant select on public.live_semantic_joint_editorial_decisions,public.live_semantic_joint_claim_publications to dialektik_core_app;
create policy joint_decisions_core_read on public.live_semantic_joint_editorial_decisions for select to dialektik_core_app using(true);
create policy joint_publications_core_read on public.live_semantic_joint_claim_publications for select to dialektik_core_app using(true);

-- Internal building block: the outer promotion transaction must establish the
-- decision, event and position formation before committing the graph.
create function public.dialektik_materialize_joint_claim(
  claim_identity dialektik_ulid,event_identity dialektik_ulid,actor_identity dialektik_ulid,correlation_identity dialektik_ulid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
  joint public.live_semantic_joint_claims%rowtype;
  selected record;
  span_identity dialektik_ulid:=public.dialektik_generate_ulid();
  assertion_identity dialektik_ulid:=public.dialektik_generate_ulid();
  evidence_identity dialektik_ulid:=public.dialektik_generate_ulid();
  decision_time timestamptz(3):=clock_timestamp();
begin
  perform public.dialektik_require_context_actor(actor_identity);
  if current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or not exists(select 1 from public.users where id=actor_identity and role='editor')
    or not exists(select 1 from public.editorial_single_editor_authorizations where editor_user_id=actor_identity and revoked_at is null)
  then raise exception using errcode='42501',message='JOINT_EDITOR_REQUIRED'; end if;
  select * into joint from public.live_semantic_joint_claims where id=claim_identity;
  if not found then raise exception using errcode='23514',message='JOINT_CLAIM_NOT_FOUND'; end if;
  select input.*,event.window_from,event.window_to,grp.proposed_event_key into selected
    from public.live_semantic_joint_scope_attempts attempt
    join public.live_semantic_joint_scope_outcomes outcome on outcome.attempt_id=attempt.id and outcome.outcome='VALIDATED'
    join public.live_semantic_joint_editorial_decisions decision on decision.attempt_id=attempt.id
      and decision.editor_user_id=actor_identity and decision.correlation_id=correlation_identity
      and ((joint.side='left' and decision.left_claim_id=joint.id) or (joint.side='right' and decision.right_claim_id=joint.id))
    join public.live_semantic_event_group_candidates grp on grp.id=attempt.group_id
    join public.live_semantic_excerpt_inputs input on input.article_id=joint.article_id::text and input.input_sha256=joint.input_sha256
    join public.articles article on article.id=joint.article_id and article.event_id=event_identity and article.origin='LIVE_REAL'
    join public.events event on event.id=event_identity and event.origin='LIVE_REAL' and event.merged_into is null
    where attempt.id=joint.attempt_id and outcome.result->>'scopeAligned'='true' and outcome.result->>'status'='ALIGNED'
      and substring(input.text_original from joint.char_start+1 for joint.char_end-joint.char_start)=joint.quoted_text
      and char_length(joint.quoted_text)=joint.char_end-joint.char_start
      and public.dialektik_live_semantic_route_allowed(joint.article_id,joint.input_sha256,
        'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct');
  if not found then raise exception using errcode='23514',message='JOINT_CLAIM_NOT_APPROVED_OR_STALE'; end if;
  insert into public.claim_spans(id,article_id,text_offset_start,text_offset_end,quoted_text,location,captured_at)
    values(span_identity,joint.article_id,joint.char_start,joint.char_end,joint.quoted_text,
      case when joint.char_start<length(selected.headline) then 'headline'::public.span_location else 'lede'::public.span_location end,decision_time);
  insert into public.assertions(id,claim_span_id,ordinal,is_principal,assertion_type,subject_ref,temporal_scope,
    population_scope,comparison_base,position_id,epistemic_class,epistemic_reason,extraction_confidence,
    version,supersedes_id,lineage_root_id,lifecycle_state)
    values(assertion_identity,span_identity,1,true,'existence',left(selected.proposed_event_key,200),
      jsonb_build_object('from',to_char(selected.window_from at time zone 'UTC','YYYY-MM-DD'),
        'to',to_char(selected.window_to at time zone 'UTC','YYYY-MM-DD'),'granularity','event_window'),
      null,left(selected.proposed_event_key,200),null,null,null,0.9,1,null,assertion_identity,'active');
  perform public.dialektik_set_audit_context('editor',actor_identity,correlation_identity,'evidence_published','joint_claim_evidence');
  insert into public.evidence(id,anchor_span_id,scope_assertion_id,stance,summary,citable_source_url,citable_source_title,
    contributed_by,publication_state,approved_by,approved_at,relevance)
    values(evidence_identity,span_identity,assertion_identity,'supports',joint.assertion_text,selected.url_canonical,
      selected.headline,actor_identity,'published',actor_identity,decision_time,1.0);
  insert into public.live_semantic_joint_claim_publications(joint_claim_id,claim_span_id,assertion_id,evidence_id,editor_user_id,created_at)
    values(joint.id,span_identity,assertion_identity,evidence_identity,actor_identity,decision_time);
  return jsonb_build_object('jointClaimId',joint.id::text,'claimSpanId',span_identity::text,
    'assertionId',assertion_identity::text,'evidenceId',evidence_identity::text);
end $$;
revoke all on function public.dialektik_materialize_joint_claim(dialektik_ulid,dialektik_ulid,dialektik_ulid,dialektik_ulid)
  from public,anon,authenticated,service_role,dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer;
`;
export const jointClaimMaterializationMigration: Migration = {
  async up(database) { await sql.raw(jointClaimMaterializationDdl).execute(database); },
  async down() { throw new Error('Joint claim publication provenance is forward-only.'); },
};
