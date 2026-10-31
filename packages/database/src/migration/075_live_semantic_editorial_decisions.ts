import { sql, type Migration } from "kysely";
import { liveSemanticMultiClaimPositionsDdl } from "./067_live_semantic_multi_claim_positions.js";

const SCHEMA = String.raw`
create table public.live_semantic_editorial_decisions (
  group_id dialektik_ulid primary key references public.live_semantic_event_group_candidates(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  correlation_id dialektik_ulid not null unique,
  decision text not null check (decision in ('APPROVED','REJECTED')),
  reason text not null check (length(btrim(reason)) between 12 and 500),
  approved_title text,
  selected_claims jsonb not null,
  approved_conflict_pair_ids jsonb not null,
  decided_at timestamptz(3) not null default clock_timestamp(),
  check (jsonb_typeof(selected_claims)='array' and jsonb_typeof(approved_conflict_pair_ids)='array'),
  check ((decision='APPROVED' and approved_title is not null and length(btrim(approved_title)) between 1 and 240
      and jsonb_array_length(selected_claims) between 2 and 150)
    or (decision='REJECTED' and approved_title is null and selected_claims='[]'::jsonb
      and approved_conflict_pair_ids='[]'::jsonb))
);
alter table public.live_semantic_editorial_decisions enable row level security;
revoke all on public.live_semantic_editorial_decisions from public,anon,authenticated,service_role,
  dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer;
grant select on public.live_semantic_editorial_decisions to dialektik_core_app,dialektik_headline_ai_writer;
create policy live_semantic_decisions_core_read on public.live_semantic_editorial_decisions
  for select to dialektik_core_app using(true);
create policy live_semantic_decisions_ai_read on public.live_semantic_editorial_decisions
  for select to dialektik_headline_ai_writer using(true);

-- Some legacy snapshots were inserted without an editor or any assertions.
-- Record their quarantine without changing their immutable publication snapshots.
create table public.live_semantic_legacy_contradiction_reviews (
  publication_id dialektik_ulid primary key references public.contradiction_publications(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  correlation_id dialektik_ulid not null unique,
  reason text not null check (length(btrim(reason)) between 12 and 500),
  decided_at timestamptz(3) not null default clock_timestamp()
);
alter table public.live_semantic_legacy_contradiction_reviews enable row level security;
revoke all on public.live_semantic_legacy_contradiction_reviews from public,anon,authenticated,service_role,
  dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer,dialektik_semantic_writer;
grant select on public.live_semantic_legacy_contradiction_reviews
  to dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer,dialektik_semantic_writer;
create policy live_semantic_legacy_reviews_core_read on public.live_semantic_legacy_contradiction_reviews
  for select to dialektik_core_app using(true);
create policy live_semantic_legacy_reviews_ai_read on public.live_semantic_legacy_contradiction_reviews
  for select to dialektik_headline_ai_writer using(true);
create policy live_semantic_legacy_reviews_moderation_read on public.live_semantic_legacy_contradiction_reviews
  for select to dialektik_moderation_writer using(true);
create policy live_semantic_legacy_reviews_semantic_read on public.live_semantic_legacy_contradiction_reviews
  for select to dialektik_semantic_writer using(true);

create function public.dialektik_quarantine_legacy_contradiction(
  publication_identity dialektik_ulid,actor_identity dialektik_ulid,correlation_identity dialektik_ulid,decision_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  publication public.contradiction_publications%rowtype;
begin
  perform public.dialektik_require_context_actor(actor_identity);
  if current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or current_setting('dialektik.action_type',true) is distinct from 'moderation_decision'
    or not exists(select 1 from public.users where id=actor_identity and role='editor')
    or not exists(select 1 from public.editorial_single_editor_authorizations
      where editor_user_id=actor_identity and revoked_at is null) then
    raise exception using errcode='42501',message='LIVE_SEMANTIC_EDITOR_REQUIRED';
  end if;
  if decision_reason is null or length(btrim(decision_reason)) not between 12 and 500 then
    raise exception using errcode='23514',message='LIVE_SEMANTIC_DECISION_INVALID';
  end if;
  select * into publication from public.contradiction_publications where id=publication_identity for update;
  if not found or publication.confirmed_by is not null or publication.publication_state<>'published'
    or exists(select 1 from public.assertions where position_id in (publication.position_a_id,publication.position_b_id))
    or exists(select 1 from public.contradiction_publications other
      where other.id<>publication_identity and other.confirmed_by is not null
        and (other.position_a_id in (publication.position_a_id,publication.position_b_id)
          or other.position_b_id in (publication.position_a_id,publication.position_b_id))) then
    raise exception using errcode='23514',message='LIVE_SEMANTIC_LEGACY_QUARANTINE_NOT_ELIGIBLE';
  end if;
  insert into public.live_semantic_legacy_contradiction_reviews(publication_id,editor_user_id,correlation_id,reason)
    values(publication_identity,actor_identity,correlation_identity,btrim(decision_reason));
  return jsonb_build_object('status','REVIEW_REQUIRED','publicationId',publication_identity::text,'editorUserId',actor_identity::text);
end;
$$;
revoke all on function public.dialektik_quarantine_legacy_contradiction(dialektik_ulid,dialektik_ulid,dialektik_ulid,text)
  from public,anon,authenticated,service_role,dialektik_core_app,dialektik_headline_ai_writer;
grant execute on function public.dialektik_quarantine_legacy_contradiction(dialektik_ulid,dialektik_ulid,dialektik_ulid,text)
  to dialektik_moderation_writer;

create function public.dialektik_record_live_semantic_editorial_decision(
  group_identity dialektik_ulid,actor_identity dialektik_ulid,correlation_identity dialektik_ulid,
  decision_kind text,decision_reason text,event_title text,claims jsonb,conflict_pair_ids jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  selected jsonb;
  pair_id jsonb;
  article_identity text;
  claim_ordinal integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('dialektik:live-semantic-promote:'||group_identity::text,0));
  perform public.dialektik_require_context_actor(actor_identity);
  if current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or current_setting('dialektik.action_type',true) is distinct from 'moderation_decision'
    or not exists(select 1 from public.users where id=actor_identity and role='editor')
    or not exists(select 1 from public.editorial_single_editor_authorizations
      where editor_user_id=actor_identity and revoked_at is null) then
    raise exception using errcode='42501',message='LIVE_SEMANTIC_EDITOR_REQUIRED';
  end if;
  if not exists(select 1 from public.live_semantic_event_group_candidates
      where id=group_identity and review_state='REVIEW_REQUIRED') then
    raise exception using errcode='P0002',message='LIVE_SEMANTIC_GROUP_NOT_FOUND';
  end if;
  if exists(select 1 from public.live_semantic_editorial_decisions where group_id=group_identity)
    or exists(select 1 from public.live_semantic_editorial_promotions where group_id=group_identity) then
    raise exception using errcode='23505',message='LIVE_SEMANTIC_GROUP_ALREADY_DECIDED';
  end if;
  if decision_kind not in ('APPROVED','REJECTED') or decision_reason is null
    or length(btrim(decision_reason)) not between 12 and 500
    or jsonb_typeof(claims) is distinct from 'array'
    or jsonb_typeof(conflict_pair_ids) is distinct from 'array'
    or jsonb_array_length(conflict_pair_ids)>150 then
    raise exception using errcode='23514',message='LIVE_SEMANTIC_DECISION_INVALID';
  end if;
  if decision_kind='REJECTED' then
    if event_title is not null or claims<>'[]'::jsonb or conflict_pair_ids<>'[]'::jsonb then
      raise exception using errcode='23514',message='LIVE_SEMANTIC_DECISION_INVALID';
    end if;
  else
    if event_title is null or length(btrim(event_title)) not between 1 and 240
      or jsonb_array_length(claims) not between 2 and 150 then
      raise exception using errcode='23514',message='LIVE_SEMANTIC_SELECTION_REQUIRED';
    end if;
    for selected in select value from jsonb_array_elements(claims) loop
      if jsonb_typeof(selected)<>'object' or not (selected ?& array['articleId','ordinal']) then
        raise exception using errcode='23514',message='LIVE_SEMANTIC_SELECTION_INVALID';
      end if;
      if (select count(*) from jsonb_object_keys(selected))<>2
        or jsonb_typeof(selected->'articleId')<>'string'
        or (selected->>'articleId') !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
        or jsonb_typeof(selected->'ordinal')<>'number' or (selected->>'ordinal') !~ '^[123]$' then
        raise exception using errcode='23514',message='LIVE_SEMANTIC_SELECTION_INVALID';
      end if;
      article_identity:=selected->>'articleId';
      claim_ordinal:=(selected->>'ordinal')::integer;
      if not exists(select 1 from public.live_semantic_event_group_members member
          join public.assertion_extraction_generations generation on generation.id=member.extraction_generation_id
          where member.group_id=group_identity and member.article_id::text=article_identity
            and generation.state='active' and generation.outcome='proposed'
            and jsonb_typeof(generation.proposal_payload->'spans')='array'
            and jsonb_array_length(generation.proposal_payload->'spans')>=claim_ordinal) then
        raise exception using errcode='23514',message='LIVE_SEMANTIC_SELECTION_STALE_OR_UNKNOWN';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(claims)) <>
       (select count(distinct (value->>'articleId')||':'||(value->>'ordinal')) from jsonb_array_elements(claims))
      or exists(select 1 from public.live_semantic_event_group_members member
        where member.group_id=group_identity and not exists(
          select 1 from jsonb_array_elements(claims) claim
          where claim->>'articleId'=member.article_id::text)) then
      raise exception using errcode='23514',message='LIVE_SEMANTIC_SELECTION_INCOMPLETE';
    end if;
    for pair_id in select value from jsonb_array_elements(conflict_pair_ids) loop
      if jsonb_typeof(pair_id)<>'string' or (pair_id #>> '{}') !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
        or not exists(select 1 from public.live_semantic_claim_pair_assessments pair
          join public.live_semantic_event_group_members left_member
            on left_member.group_id=pair.group_id and left_member.article_id=pair.left_article_id
          join public.live_semantic_event_group_members right_member
            on right_member.group_id=pair.group_id and right_member.article_id=pair.right_article_id
          join public.live_semantic_event_group_candidates candidate on candidate.id=pair.group_id
          where pair.id::text=(pair_id #>> '{}') and pair.group_id=group_identity
            and pair.config_sha256=candidate.config_sha256
            and pair.left_extraction_generation_id=left_member.extraction_generation_id
            and pair.right_extraction_generation_id=right_member.extraction_generation_id
            and pair.same_event and pair.same_event_confidence>=70
            and pair.relation in ('CONTRADICTORY','DIVERGENT')
            and pair.ratio_conflicting>=50 and pair.ratio_comparable>=60
            and claims @> jsonb_build_array(jsonb_build_object('articleId',pair.left_article_id::text,'ordinal',pair.left_claim_ordinal))
            and claims @> jsonb_build_array(jsonb_build_object('articleId',pair.right_article_id::text,'ordinal',pair.right_claim_ordinal))) then
        raise exception using errcode='23514',message='LIVE_SEMANTIC_CONFLICT_SELECTION_INVALID';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(conflict_pair_ids)) <>
      (select count(distinct value) from jsonb_array_elements(conflict_pair_ids)) then
      raise exception using errcode='23514',message='LIVE_SEMANTIC_CONFLICT_SELECTION_INVALID';
    end if;
  end if;
  insert into public.live_semantic_editorial_decisions(group_id,editor_user_id,correlation_id,decision,reason,
    approved_title,selected_claims,approved_conflict_pair_ids)
    values(group_identity,actor_identity,correlation_identity,decision_kind,btrim(decision_reason),
      case when event_title is null then null else btrim(event_title) end,claims,conflict_pair_ids);
  return jsonb_build_object('status',decision_kind,'groupId',group_identity::text,'editorUserId',actor_identity::text);
end;
$$;
revoke all on function public.dialektik_record_live_semantic_editorial_decision(
  dialektik_ulid,dialektik_ulid,dialektik_ulid,text,text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role,dialektik_core_app,dialektik_headline_ai_writer;
grant execute on function public.dialektik_record_live_semantic_editorial_decision(
  dialektik_ulid,dialektik_ulid,dialektik_ulid,text,text,text,jsonb,jsonb) to dialektik_moderation_writer;
`;

function replaceOnce(source: string, before: string, after: string): string {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0)
    throw new Error("MIGRATION_075_PROMOTION_MARKER_INVALID");
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function promotionDdl(): string {
  const original = liveSemanticMultiClaimPositionsDdl.promotion;
  const start = original.indexOf("create or replace function public.dialektik_promote_live_semantic_event_group(");
  const end = original.indexOf("create or replace function public.dialektik_live_semantic_source_allowed(", start);
  if (start < 0 || end < 0) throw new Error("MIGRATION_075_PROMOTION_FUNCTION_MISSING");
  let ddl = original.slice(start, end);
  ddl = replaceOnce(ddl, "  pair_row record;", "  conflict_pair record;");
  const conflictLoopStart = ddl.indexOf("  for pair_row in\n");
  const conflictLoopEnd = ddl.indexOf("  end loop;", conflictLoopStart);
  if (conflictLoopStart < 0 || conflictLoopEnd < 0)
    throw new Error("MIGRATION_075_CONFLICT_LOOP_MISSING");
  ddl = ddl.slice(0, conflictLoopStart) +
    ddl.slice(conflictLoopStart, conflictLoopEnd).replace(/\bpair_row\b/gu, "conflict_pair") +
    ddl.slice(conflictLoopEnd);
  ddl = replaceOnce(ddl, "  group_row public.live_semantic_event_group_candidates%rowtype;",
    "  group_row public.live_semantic_event_group_candidates%rowtype;\n  decision_row public.live_semantic_editorial_decisions%rowtype;");
  ddl = replaceOnce(ddl, "  select * into group_row from public.live_semantic_event_group_candidates",
    String.raw`  select * into decision_row from public.live_semantic_editorial_decisions
    where group_id=group_identity and decision='APPROVED' and editor_user_id=actor_identity
      and correlation_id=correlation_identity;
  if not found then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','EDITORIAL_CLAIM_SELECTION_REQUIRED');
  end if;
  select * into group_row from public.live_semantic_event_group_candidates`);
  ddl = replaceOnce(ddl, "    cross join lateral jsonb_array_elements(generation.proposal_payload->'spans') claim;",
    String.raw`    cross join lateral jsonb_array_elements(generation.proposal_payload->'spans') with ordinality claim(value,ordinal)
    where member.group_id=group_identity and decision_row.selected_claims @>
      jsonb_build_array(jsonb_build_object('articleId',member.article_id::text,'ordinal',claim.ordinal));`);
  ddl = replaceOnce(ddl, "    where left_member.group_id=group_identity and right_member.group_id=group_identity and (",
    String.raw`    where left_member.group_id=group_identity and right_member.group_id=group_identity
      and decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',left_member.article_id::text,'ordinal',left_claim.ordinality))
      and decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',right_member.article_id::text,'ordinal',right_claim.ordinality)) and (`);
  ddl = replaceOnce(ddl, "      and pair_row.right_extraction_generation_id=right_member.extraction_generation_id;",
    String.raw`      and pair_row.right_extraction_generation_id=right_member.extraction_generation_id
      and pair_row.config_sha256=group_row.config_sha256
      and decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',pair_row.left_article_id::text,'ordinal',pair_row.left_claim_ordinal))
      and decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',pair_row.right_article_id::text,'ordinal',pair_row.right_claim_ordinal));`);
  ddl = replaceOnce(ddl, "  if exists(select 1 from public.live_semantic_event_group_members member\n    join public.articles article on article.id=member.article_id",
    String.raw`  if not exists(select 1 from public.live_semantic_claim_pair_assessments pair_row
    join public.live_semantic_event_group_members left_member
      on left_member.group_id=pair_row.group_id and left_member.article_id=pair_row.left_article_id
    join public.live_semantic_event_group_members right_member
      on right_member.group_id=pair_row.group_id and right_member.article_id=pair_row.right_article_id
    where pair_row.group_id=group_identity and left_member.source_id<>right_member.source_id
      and pair_row.left_extraction_generation_id=left_member.extraction_generation_id
      and pair_row.right_extraction_generation_id=right_member.extraction_generation_id
      and pair_row.config_sha256=group_row.config_sha256 and pair_row.same_event
      and pair_row.same_event_confidence>=70 and pair_row.ratio_comparable>=60
      and pair_row.relation in ('CONSISTENT','DIVERGENT','CONTRADICTORY')
      and decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',pair_row.left_article_id::text,'ordinal',pair_row.left_claim_ordinal))
      and decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',pair_row.right_article_id::text,'ordinal',pair_row.right_claim_ordinal))) then
    return jsonb_build_object('status','NEEDS_EDITORIAL_REVIEW','reason','COMPARABLE_CROSS_SOURCE_CLAIMS_REQUIRED');
  end if;
  if exists(select 1 from public.live_semantic_event_group_members member
    join public.articles article on article.id=member.article_id`);
  ddl = replaceOnce(ddl, "    for claim_row in select value from jsonb_array_elements(item.spans) loop",
    String.raw`    for claim_row in select value from jsonb_array_elements(item.spans) with ordinality as claim(value,ordinal)
      where decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',item.article_id::text,'ordinal',claim.ordinal)) loop`);
  ddl = replaceOnce(ddl, "    for claim_row in select value,ordinality::smallint ordinal from jsonb_array_elements(item.spans) with ordinality loop",
    String.raw`    for claim_row in select value,ordinality::smallint ordinal from jsonb_array_elements(item.spans) with ordinality
      where decision_row.selected_claims @> jsonb_build_array(jsonb_build_object('articleId',item.article_id::text,'ordinal',ordinality)) loop`);
  ddl = replaceOnce(ddl, "values(event_identity,left(btrim(group_row.proposed_title),240),category_identity",
    "values(event_identity,decision_row.approved_title,category_identity");
  ddl = replaceOnce(ddl,
    "position_text:=left(btrim(coalesce(nullif(claim_row.value->>'position_summary',''),group_row.proposed_title)),240);",
    "position_text:=left(assertion_text,240);");
  ddl = replaceOnce(ddl, "      and left_member.source_id<>right_member.source_id\n      and assessment.relation in ('CONTRADICTORY','DIVERGENT')",
    "      and decision_row.approved_conflict_pair_ids ? assessment.id::text\n      and assessment.relation in ('CONTRADICTORY','DIVERGENT')");
  return ddl;
}

function formationDdl(): string {
  const original = liveSemanticMultiClaimPositionsDdl.schema;
  const start = original.indexOf("create or replace function public.dialektik_assert_position_formation()");
  const end = original.indexOf("create or replace function public.dialektik_validate_position_formation()", start);
  if (start < 0 || end < 0) throw new Error("MIGRATION_075_FORMATION_FUNCTION_MISSING");
  return replaceOnce(original.slice(start, end),
    "where position_row.status='active'\n      and not exists (",
    String.raw`where position_row.status='active'
      and not (
        not exists(select 1 from public.assertions assertion_row where assertion_row.position_id=position_row.id)
        and exists(select 1 from public.contradiction_publications publication
          join public.live_semantic_legacy_contradiction_reviews review on review.publication_id=publication.id
          where publication.confirmed_by is null and publication.publication_state='published'
            and position_row.id in (publication.position_a_id,publication.position_b_id))
        and not exists(select 1 from public.contradiction_publications publication
          where position_row.id in (publication.position_a_id,publication.position_b_id)
            and (publication.confirmed_by is not null or not exists(
              select 1 from public.live_semantic_legacy_contradiction_reviews review where review.publication_id=publication.id)))
      )
      and not exists (`);
}

export const liveSemanticEditorialDecisionsDdl = {
  schema: SCHEMA, formation: formationDdl(), promotion: promotionDdl(),
} as const;

export const liveSemanticEditorialDecisionsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(liveSemanticEditorialDecisionsDdl.schema).execute(database);
    await sql.raw(liveSemanticEditorialDecisionsDdl.formation).execute(database);
    await sql.raw(liveSemanticEditorialDecisionsDdl.promotion).execute(database);
  },
  async down(): Promise<void> {
    throw new Error("Editorial decisions are forward-only audit records.");
  },
};
