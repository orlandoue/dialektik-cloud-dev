import { sql, type Migration } from "kysely";
import { liveSemanticEditorialDecisionsDdl } from "./075_live_semantic_editorial_decisions.js";

const SCHEMA = String.raw`
create table public.live_semantic_case_pair_attempts (
  id dialektik_ulid primary key,
  group_id dialektik_ulid not null references public.live_semantic_event_group_candidates(id),
  left_article_id dialektik_ulid not null references public.articles(id),
  right_article_id dialektik_ulid not null references public.articles(id),
  run_id dialektik_ulid not null references public.live_semantic_production_runs(id),
  config_sha256 text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by dialektik_ulid not null references public.users(id),
  requested_at timestamptz(3) not null,
  check(left_article_id<right_article_id),
  unique(left_article_id,right_article_id,config_sha256)
);
create table public.live_semantic_case_pair_outcomes (
  attempt_id dialektik_ulid primary key references public.live_semantic_case_pair_attempts(id),
  outcome text not null check(outcome in ('VALIDATED','INVALID_MODEL_RESPONSE','PROVIDER_UNAVAILABLE','PERSISTENCE_FAILED')),
  assessment_id dialektik_ulid references public.live_semantic_pair_assessments(id),
  recorded_at timestamptz(3) not null,
  check ((outcome='VALIDATED')=(assessment_id is not null))
);
create table public.live_semantic_stance_pair_attempts (
  id dialektik_ulid primary key,
  original_pair_id dialektik_ulid not null references public.live_semantic_claim_pair_assessments(id),
  run_id dialektik_ulid not null references public.live_semantic_production_runs(id),
  config_sha256 text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by dialektik_ulid not null references public.users(id),
  requested_at timestamptz(3) not null,
  unique(original_pair_id,config_sha256)
);
create table public.live_semantic_stance_pair_outcomes (
  attempt_id dialektik_ulid primary key references public.live_semantic_stance_pair_attempts(id),
  outcome text not null check(outcome in ('VALIDATED','INVALID_MODEL_RESPONSE','INPUT_UNAVAILABLE','PROVIDER_UNAVAILABLE','PERSISTENCE_FAILED')),
  assessment_id dialektik_ulid references public.live_semantic_claim_pair_assessments(id),
  recorded_at timestamptz(3) not null,
  check ((outcome='VALIDATED')=(assessment_id is not null))
);
do $$ declare tab text; begin
  foreach tab in array array['live_semantic_case_pair_attempts','live_semantic_case_pair_outcomes',
    'live_semantic_stance_pair_attempts','live_semantic_stance_pair_outcomes'] loop
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

const hashFor = (expression: string) =>
  `encode(extensions.digest(convert_to(${expression}||E'\\n'||'stance-pair-v1','UTF8'),'sha256'),'hex')`;

function replaceExact(source: string, before: string, after: string, expected = 1): string {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error("MIGRATION_076_MARKER_INVALID");
  return source.split(before).join(after);
}

function decisionDdl(): string {
  const source = liveSemanticEditorialDecisionsDdl.schema;
  const start = source.indexOf("create function public.dialektik_record_live_semantic_editorial_decision(");
  if (start < 0) throw new Error("MIGRATION_076_DECISION_MISSING");
  let ddl = source.slice(start).replace("create function public.dialektik_record_live_semantic_editorial_decision(",
    "create or replace function public.dialektik_record_live_semantic_editorial_decision(");
  ddl = replaceExact(ddl, "pair.config_sha256=candidate.config_sha256", `pair.config_sha256=${hashFor("candidate.config_sha256")}`);
  ddl = replaceExact(ddl, "and pair.relation in ('CONTRADICTORY','DIVERGENT')\n            and pair.ratio_conflicting>=50 and pair.ratio_comparable>=60",
    "and ((pair.relation='CONTRADICTORY' and pair.ratio_conflicting>=55)\n              or (pair.relation='DIVERGENT' and pair.ratio_conflicting between 35 and 54))\n            and pair.ratio_comparable>=60");
  return ddl;
}

function promotionDdl(): string {
  let ddl = liveSemanticEditorialDecisionsDdl.promotion;
  ddl = replaceExact(ddl, "pair_row.config_sha256=group_row.config_sha256",
    `pair_row.config_sha256=${hashFor("group_row.config_sha256")}`, 2);
  ddl = replaceExact(ddl, "and assessment.relation in ('CONTRADICTORY','DIVERGENT')\n      and assessment.ratio_conflicting>=50 and assessment.ratio_comparable>=60",
    "and ((assessment.relation='CONTRADICTORY' and assessment.ratio_conflicting>=55)\n        or (assessment.relation='DIVERGENT' and assessment.ratio_conflicting between 35 and 54))\n      and assessment.ratio_comparable>=60");
  return ddl;
}

export const liveStanceReassessmentDdl = { schema: SCHEMA, decision: decisionDdl(), promotion: promotionDdl() } as const;

export const liveStanceReassessmentMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(liveStanceReassessmentDdl.schema).execute(database);
    await sql.raw(liveStanceReassessmentDdl.decision).execute(database);
    await sql.raw(liveStanceReassessmentDdl.promotion).execute(database);
  },
  async down(): Promise<void> { throw new Error("Stance reassessment history is forward-only."); },
};
