import { sql, type Migration } from 'kysely';
import { liveStanceReassessmentDdl } from './076_live_stance_reassessment';

const DDL = String.raw`
create table public.live_semantic_joint_scope_attempts (
 id dialektik_ulid primary key,
 group_id dialektik_ulid not null references public.live_semantic_event_group_candidates(id),
 run_id dialektik_ulid not null references public.live_semantic_production_runs(id),
 requested_by dialektik_ulid not null references public.users(id),
 left_article_id dialektik_ulid not null references public.articles(id),
 right_article_id dialektik_ulid not null references public.articles(id),
 left_input_sha256 text not null check(left_input_sha256 ~ '^[0-9a-f]{64}$'),
 right_input_sha256 text not null check(right_input_sha256 ~ '^[0-9a-f]{64}$'),
 config_sha256 text not null check(config_sha256 ~ '^[0-9a-f]{64}$'),
 requested_at timestamptz(3) not null,
 check(left_article_id<right_article_id),
 unique(group_id,left_article_id,right_article_id,left_input_sha256,right_input_sha256,config_sha256)
);
create table public.live_semantic_joint_scope_outcomes (
 attempt_id dialektik_ulid primary key references public.live_semantic_joint_scope_attempts(id),
 outcome text not null check(outcome in ('VALIDATED','INVALID_SCHEMA','INVALID_SCOPE','INPUT_UNAVAILABLE','PROVIDER_UNAVAILABLE')),
 result jsonb,
 recorded_at timestamptz(3) not null,
 check ((outcome='VALIDATED')=(result is not null)),
 check (result is null or jsonb_typeof(result)='object')
);
do $$ declare tab text; begin
 foreach tab in array array['live_semantic_joint_scope_attempts','live_semantic_joint_scope_outcomes'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
  execute format('grant select on public.%I to dialektik_core_app',tab);
  execute format('grant select,insert on public.%I to dialektik_headline_ai_writer',tab);
  execute format('create policy %I on public.%I for select to dialektik_core_app using(true)',tab||'_core_read',tab);
  execute format('create policy %I on public.%I for select to dialektik_headline_ai_writer using(true)',tab||'_ai_read',tab);
  execute format('create policy %I on public.%I for insert to dialektik_headline_ai_writer with check(true)',tab||'_ai_insert',tab);
 end loop;
end $$;
`;
// A score from the earlier classifier is never sufficient on its own. The
// selected claims must also match a current, grounded joint-scope assessment.
const marker = "            and claims @> jsonb_build_array(jsonb_build_object('articleId',pair.left_article_id::text,'ordinal',pair.left_claim_ordinal))";
const scopeGate = String.raw`            and exists (
              select 1 from public.live_semantic_joint_scope_attempts joint
              join public.live_semantic_joint_scope_outcomes outcome on outcome.attempt_id=joint.id and outcome.outcome='VALIDATED'
              join public.articles la on la.id=joint.left_article_id
              join public.articles ra on ra.id=joint.right_article_id
              join public.assertion_extraction_generations lg on lg.id=pair.left_extraction_generation_id
              join public.assertion_extraction_generations rg on rg.id=pair.right_extraction_generation_id
              where joint.group_id=pair.group_id and joint.left_article_id=pair.left_article_id and joint.right_article_id=pair.right_article_id
                and joint.left_input_sha256=encode(extensions.digest(convert_to(la.text_original,'UTF8'),'sha256'),'hex')
                and joint.right_input_sha256=encode(extensions.digest(convert_to(ra.text_original,'UTF8'),'sha256'),'hex')
                and outcome.result->>'status'='ALIGNED' and outcome.result->>'scopeAligned'='true'
                and outcome.result->>'relation'=pair.relation
                and (outcome.result->>'ratioComparable')::int>=70
                and ((pair.relation='CONTRADICTORY' and (outcome.result->>'ratioConflicting')::int>=55)
                  or (pair.relation='DIVERGENT' and (outcome.result->>'ratioConflicting')::int between 35 and 54))
                and outcome.result#>>'{left,quotedText}'=lg.proposal_payload->'spans'->(pair.left_claim_ordinal-1)->>'quoted_text'
                and outcome.result#>>'{right,quotedText}'=rg.proposal_payload->'spans'->(pair.right_claim_ordinal-1)->>'quoted_text'
            )
`;
if (liveStanceReassessmentDdl.decision.split(marker).length !== 2) throw new Error('MIGRATION_078_MARKER_INVALID');
export const liveJointScopeReviewDecisionDdl = liveStanceReassessmentDdl.decision.replace(marker, scopeGate + marker);
export const liveJointScopeReviewDdl = DDL;
export const liveJointScopeReviewMigration: Migration = {
  async up(database) { await sql.raw(DDL).execute(database); await sql.raw(liveJointScopeReviewDecisionDdl).execute(database); },
  async down() { throw new Error('Joint scope review history is forward-only.'); },
};
