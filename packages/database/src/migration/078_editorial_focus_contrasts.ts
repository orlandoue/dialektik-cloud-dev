import { sql, type Migration } from 'kysely';

export const editorialFocusContrastsDdl = String.raw`
create or replace function public.dialektik_validate_contradiction_publication_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare projection public.position_relation_projections%rowtype;
begin
  select * into projection from public.position_relation_projections p
    where p.event_id=new.event_id and p.position_a_id=new.position_a_id and p.position_b_id=new.position_b_id;
  if projection.event_id is null or projection.requires_review
    or new.projection_hash is distinct from projection.projection_hash
    or new.ratio_conflicting_at_publication is distinct from projection.conflict_pairs
    or new.ratio_comparable_at_publication is distinct from projection.comparable_pairs then
    raise exception using errcode='23514',message='Publication requires an exact current projection';
  end if;
  if new.threshold_rule_at_publication='v1:editorial_focus_contrast' then
    if projection.comparable_pairs<1 or projection.conflict_pairs<>0
      or new.confirmed_by is null or new.confirmed_at is null
      or current_setting('dialektik.actor_type',true) is distinct from 'editor'
      or current_setting('dialektik.actor_id',true) is distinct from new.confirmed_by::text
      or not exists(select 1 from public.users u where u.id=new.confirmed_by and u.role='editor')
      or not exists(select 1 from public.editorial_single_editor_authorizations auth
        where auth.editor_user_id=new.confirmed_by and auth.revoked_at is null)
      or not exists(
        select 1 from public.assertions aa
        join public.claim_spans sa on sa.id=aa.claim_span_id and sa.tombstone_id is null
        join public.articles arta on arta.id=sa.article_id and arta.event_id=new.event_id and arta.origin='LIVE_REAL'
        join public.evidence ea on ea.scope_assertion_id=aa.id and ea.anchor_span_id=sa.id and ea.publication_state='published' and ea.approved_by is not null
        join public.assertions ab on ab.position_id=new.position_b_id and ab.lifecycle_state='active'
        join public.claim_spans sb on sb.id=ab.claim_span_id and sb.tombstone_id is null
        join public.articles artb on artb.id=sb.article_id and artb.event_id=new.event_id and artb.origin='LIVE_REAL' and artb.source_id<>arta.source_id
        join public.evidence eb on eb.scope_assertion_id=ab.id and eb.anchor_span_id=sb.id and eb.publication_state='published' and eb.approved_by is not null
        where aa.position_id=new.position_a_id and aa.lifecycle_state='active'
          and not exists(select 1 from public.assertions newer where newer.supersedes_id=aa.id)
          and not exists(select 1 from public.assertions newer where newer.supersedes_id=ab.id)
          and substring(arta.text_original from sa.text_offset_start+1 for sa.text_offset_end-sa.text_offset_start)=sa.quoted_text
          and substring(artb.text_original from sb.text_offset_start+1 for sb.text_offset_end-sb.text_offset_start)=sb.quoted_text
          and public.dialektik_live_semantic_source_allowed(arta.source_id)
          and public.dialektik_live_semantic_source_allowed(artb.source_id)
          and sa.quoted_text<>sb.quoted_text
          and exists(select 1 from public.live_acquisition_receipts r where r.source_id=arta.source_id and r.exclusion_id=arta.live_exposure_id and r.disposition='PERSISTED')
          and exists(select 1 from public.live_acquisition_receipts r where r.source_id=artb.source_id and r.exclusion_id=artb.live_exposure_id and r.disposition='PERSISTED')
      ) then raise exception using errcode='23514',message='Editorial contrast requires two different source-backed perspectives'; end if;
  elsif new.threshold_rule_at_publication='v1:any_confirmed_conflict' then
    if not projection.publication_eligible then
      raise exception using errcode='23514',message='Contradiction requires an eligible conflict projection';
    end if;
  else raise exception using errcode='23514',message='Unsupported publication threshold'; end if;
  return new;
end $$;
`;
export const editorialFocusContrastsMigration: Migration = {
  async up(database) { await sql.raw(editorialFocusContrastsDdl).execute(database); },
  async down() { throw new Error('Editorial publication history is forward-only.'); },
};
