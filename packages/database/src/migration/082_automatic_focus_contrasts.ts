import { sql, type Migration } from 'kysely';
import { liveStanceReassessmentDdl } from './076_live_stance_reassessment.js';
import { skipUnconfirmedStalePublicationsDdl } from './063_skip_unconfirmed_stale_publications.js';

function promotionDdl(): string {
  let ddl = liveStanceReassessmentDdl.promotion;
  const oldFilter = "and ((assessment.relation='CONTRADICTORY' and assessment.ratio_conflicting>=55)\n        or (assessment.relation='DIVERGENT' and assessment.ratio_conflicting between 35 and 54))\n      and assessment.ratio_comparable>=60";
  if (ddl.split(oldFilter).length !== 2) throw new Error('AUTO_FOCUS_CONFLICT_FILTER_MISMATCH');
  ddl = ddl.replace(oldFilter, "and assessment.relation='CONTRADICTORY' and assessment.ratio_conflicting>=55\n      and assessment.ratio_comparable>=60");
  if (ddl.split('  conflict_count integer := 0;').length !== 2) throw new Error('AUTO_FOCUS_COUNT_MARKER_MISMATCH');
  ddl = ddl.replace('  conflict_count integer := 0;', '  conflict_count integer := 0;\n  focus_count integer := 0;');
  const marker = '  get diagnostics conflict_count=row_count;';
  if (ddl.split(marker).length !== 2) throw new Error('AUTO_FOCUS_INSERT_MARKER_MISMATCH');
  return ddl.replace(marker, `${marker}
  insert into public.contradiction_publications(id,event_id,position_a_id,position_b_id,projection_hash,
    ratio_conflicting_at_publication,ratio_comparable_at_publication,threshold_rule_at_publication,
    confirmed_by,confirmed_at,publication_state,retracted_by,retracted_at,retraction_reason)
    select distinct public.dialektik_generate_ulid(),projection.event_id,projection.position_a_id,projection.position_b_id,
      projection.projection_hash,projection.conflict_pairs,projection.comparable_pairs,
      'v1:editorial_focus_contrast',actor_identity,decision_time,'published'::public.contradiction_publication_state,
      null::dialektik_ulid,null::timestamptz,null::text
    from public.live_semantic_claim_pair_assessments assessment
    join pg_temp.dialektik_live_semantic_promotion_claims left_claim
      on left_claim.article_id=assessment.left_article_id and left_claim.claim_ordinal=assessment.left_claim_ordinal
    join pg_temp.dialektik_live_semantic_promotion_claims right_claim
      on right_claim.article_id=assessment.right_article_id and right_claim.claim_ordinal=assessment.right_claim_ordinal
    join public.position_relation_projections projection on projection.event_id=event_identity
      and projection.position_a_id=least(left_claim.position_id,right_claim.position_id)
      and projection.position_b_id=greatest(left_claim.position_id,right_claim.position_id)
    where assessment.group_id=group_identity and decision_row.approved_conflict_pair_ids ? assessment.id::text
      and assessment.relation='DIVERGENT' and assessment.ratio_conflicting between 35 and 54
      and assessment.ratio_comparable>=60 and projection.comparable_pairs>0 and projection.conflict_pairs=0
      and not projection.requires_review
      and not exists(select 1 from public.contradiction_publications existing
        where existing.event_id=projection.event_id and existing.position_a_id=projection.position_a_id
          and existing.position_b_id=projection.position_b_id and existing.publication_state='published');
  get diagnostics focus_count=row_count;
  if focus_count>0 and conflict_count=0 then
    update public.events set synthesis_relation='DIFFERENT_FOCUS' where id=event_identity;
  end if;
  conflict_count:=conflict_count+focus_count;`);
}

const staleMarker = 'or not coalesce(current_projection.publication_eligible,false)';
if (skipUnconfirmedStalePublicationsDdl.split(staleMarker).length !== 2)
  throw new Error('AUTO_FOCUS_STALENESS_MARKER_MISMATCH');
const focusAwareStalenessDdl = skipUnconfirmedStalePublicationsDdl.replace(staleMarker, `or not (case
          when publication.threshold_rule_at_publication='v1:editorial_focus_contrast' then
            coalesce(current_projection.comparable_pairs>0 and current_projection.conflict_pairs=0,false)
          else coalesce(current_projection.publication_eligible,false) end)`);
export const automaticFocusContrastsDdl = `${focusAwareStalenessDdl}\n${promotionDdl()}`;
export const automaticFocusContrastsMigration: Migration = {
  async up(database) { await sql.raw(automaticFocusContrastsDdl).execute(database); },
  async down() { throw new Error('Editorial publication history is forward-only.'); },
};
