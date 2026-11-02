import { sql, type Migration } from 'kysely';

export const jointEditorialDecisionDdl = String.raw`
create function public.dialektik_record_joint_editorial_decision(
  attempt_identity dialektik_ulid,left_identity dialektik_ulid,right_identity dialektik_ulid,
  actor_identity dialektik_ulid,correlation_identity dialektik_ulid,decision_reason text,approve_conflict boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare pair_row record;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:joint-decision:'||attempt_identity::text,0));
  perform public.dialektik_require_context_actor(actor_identity);
  if current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or current_setting('dialektik.action_type',true) is distinct from 'moderation_decision'
    or not exists(select 1 from public.users where id=actor_identity and role='editor')
    or not exists(select 1 from public.editorial_single_editor_authorizations where editor_user_id=actor_identity and revoked_at is null)
  then raise exception using errcode='42501',message='JOINT_EDITOR_REQUIRED'; end if;
  if decision_reason is null or length(btrim(decision_reason)) not between 12 and 500 or approve_conflict is null
    or left_identity=right_identity then raise exception using errcode='23514',message='JOINT_DECISION_INVALID'; end if;
  select attempt.group_id,outcome.result into pair_row
  from public.live_semantic_joint_scope_attempts attempt
  join public.live_semantic_joint_scope_outcomes outcome on outcome.attempt_id=attempt.id and outcome.outcome='VALIDATED'
  join public.live_semantic_joint_claims l on l.id=left_identity and l.attempt_id=attempt.id and l.side='left'
    and l.article_id=attempt.left_article_id and l.input_sha256=attempt.left_input_sha256
  join public.live_semantic_joint_claims r on r.id=right_identity and r.attempt_id=attempt.id and r.side='right'
    and r.article_id=attempt.right_article_id and r.input_sha256=attempt.right_input_sha256
  join public.live_semantic_event_group_members lm on lm.group_id=attempt.group_id and lm.article_id=l.article_id
  join public.live_semantic_event_group_members rm on rm.group_id=attempt.group_id and rm.article_id=r.article_id and rm.source_id<>lm.source_id
  join public.live_semantic_excerpt_inputs li on li.article_id=l.article_id::text and li.input_sha256=l.input_sha256
  join public.live_semantic_excerpt_inputs ri on ri.article_id=r.article_id::text and ri.input_sha256=r.input_sha256
  where attempt.id=attempt_identity and outcome.result->>'status'='ALIGNED' and outcome.result->>'scopeAligned'='true'
    and substring(li.text_original from l.char_start+1 for l.char_end-l.char_start)=l.quoted_text
    and substring(ri.text_original from r.char_start+1 for r.char_end-r.char_start)=r.quoted_text
    and outcome.result#>>'{left,quotedText}'=l.quoted_text and outcome.result#>>'{right,quotedText}'=r.quoted_text
    and outcome.result#>>'{left,assertionText}'=l.assertion_text and outcome.result#>>'{right,assertionText}'=r.assertion_text
    and public.dialektik_live_semantic_route_allowed(l.article_id,l.input_sha256,'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct')
    and public.dialektik_live_semantic_route_allowed(r.article_id,r.input_sha256,'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct');
  if not found then raise exception using errcode='23514',message='JOINT_SCOPE_OR_CLAIMS_INVALID'; end if;
  if approve_conflict and not (pair_row.result->>'relation'='CONTRADICTORY'
      and (pair_row.result->>'ratioConflicting')::integer>=55 and (pair_row.result->>'ratioComparable')::integer>=70)
    then raise exception using errcode='23514',message='JOINT_CONFLICT_NOT_ELIGIBLE'; end if;
  insert into public.live_semantic_joint_editorial_decisions
    (attempt_id,left_claim_id,right_claim_id,editor_user_id,correlation_id,reason,conflict_approved)
    values(attempt_identity,left_identity,right_identity,actor_identity,correlation_identity,btrim(decision_reason),approve_conflict);
  return jsonb_build_object('status','APPROVED','attemptId',attempt_identity::text,'groupId',pair_row.group_id::text,
    'leftClaimId',left_identity::text,'rightClaimId',right_identity::text,'conflictApproved',approve_conflict);
end $$;
revoke all on function public.dialektik_record_joint_editorial_decision(dialektik_ulid,dialektik_ulid,dialektik_ulid,dialektik_ulid,dialektik_ulid,text,boolean)
  from public,anon,authenticated,service_role,dialektik_core_app,dialektik_headline_ai_writer;
grant execute on function public.dialektik_record_joint_editorial_decision(dialektik_ulid,dialektik_ulid,dialektik_ulid,dialektik_ulid,dialektik_ulid,text,boolean)
  to dialektik_moderation_writer;
`;
export const jointEditorialDecisionMigration: Migration = {
  async up(database) { await sql.raw(jointEditorialDecisionDdl).execute(database); },
  async down() { throw new Error('Joint editorial decisions are forward-only.'); },
};
