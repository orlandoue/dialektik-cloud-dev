import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { liveSemanticEditorialDecisionsDdl } from '../../../packages/database/dist/migration/075_live_semantic_editorial_decisions.js';
import { liveStanceReassessmentDdl } from '../../../packages/database/dist/migration/076_live_stance_reassessment.js';
import { liveSemanticEventAttachmentDdl } from '../../../packages/database/dist/migration/077_live_semantic_event_attachment.js';
import { automaticFocusContrastsDdl } from '../../../packages/database/dist/migration/082_automatic_focus_contrasts.js';

const id = (n) => `01M4YDQK00EVART${String(n).padStart(11, '0')}`;
const editor = id(1), group = id(2), rejectedGroup = id(3), noDecisionGroup = id(4);
const articleA = id(5), articleB = id(6), sourceA = id(7), sourceB = id(8);
const generationA = id(9), generationB = id(10), correlation = id(11), pairId = id(12);

test('editorial decisions require an editor and an explicit current claim selection', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create domain dialektik_ulid as text check(value ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$');
      create function dialektik_generate_ulid() returns dialektik_ulid language sql as $$ select '01M4YDQK00EVART00000000099'::dialektik_ulid $$;
      create role anon; create role authenticated; create role service_role;
      create role dialektik_core_app; create role dialektik_headline_ai_writer; create role dialektik_moderation_writer; create role dialektik_semantic_writer;
      create schema extensions;
      create function extensions.digest(bytea,text) returns bytea language sql as $$ select decode(repeat('aa',32),'hex') $$;
      create table users(id dialektik_ulid primary key,role text);
      create table editorial_single_editor_authorizations(id dialektik_ulid,editor_user_id dialektik_ulid,revoked_at timestamptz);
      create table events(id dialektik_ulid primary key,origin text,analysis_state text,merged_into dialektik_ulid,window_from timestamptz,window_to timestamptz);
      create table positions(id dialektik_ulid primary key,event_id dialektik_ulid,status text);
      create table assertions(id dialektik_ulid primary key,position_id dialektik_ulid,claim_span_id dialektik_ulid,is_principal boolean);
      create view current_assertions as select * from assertions;
      create table claim_spans(id dialektik_ulid,article_id dialektik_ulid);
      create table articles(id dialektik_ulid primary key,event_id dialektik_ulid);
      create table evidence(id dialektik_ulid primary key,scope_assertion_id dialektik_ulid,publication_state text,approved_by dialektik_ulid);
      create table relationships(id dialektik_ulid primary key,rel_type text,publication_state text,event_id dialektik_ulid);
      create table moderation_review_proposals(id dialektik_ulid primary key);
      create table relationship_endpoints(relationship_id dialektik_ulid,assertion_id dialektik_ulid);
      create table position_formed_by(position_id dialektik_ulid,relationship_id dialektik_ulid);
      create table contradiction_publications(id dialektik_ulid primary key,position_a_id dialektik_ulid,
        position_b_id dialektik_ulid,confirmed_by dialektik_ulid,publication_state text);
      create function dialektik_lock_phase_1b_graph() returns void language plpgsql as $$ begin return; end $$;
      create table live_semantic_event_group_candidates(id dialektik_ulid primary key,review_state text,config_sha256 text);
      create table live_semantic_editorial_promotions(group_id dialektik_ulid primary key,event_id dialektik_ulid);
      create table assertion_extraction_generations(id dialektik_ulid primary key,state text,outcome text,proposal_payload jsonb);
      create table live_semantic_event_group_members(group_id dialektik_ulid,article_id dialektik_ulid,
        source_id dialektik_ulid,extraction_generation_id dialektik_ulid);
      create table live_semantic_production_runs(id dialektik_ulid primary key);
      create table live_semantic_pair_assessments(id dialektik_ulid primary key);
      create table live_semantic_claim_pair_assessments(id dialektik_ulid primary key,group_id dialektik_ulid,
        left_article_id dialektik_ulid,left_claim_ordinal int,right_article_id dialektik_ulid,right_claim_ordinal int,
        left_extraction_generation_id dialektik_ulid,right_extraction_generation_id dialektik_ulid,
        same_event boolean,same_event_confidence int,relation text,ratio_conflicting int,ratio_comparable int,config_sha256 text);
      create function dialektik_require_context_actor(actor dialektik_ulid) returns void language plpgsql as $$
      begin
        if current_setting('dialektik.actor_id',true) is distinct from actor::text then
          raise exception using errcode='42501',message='invalid actor';
        end if;
      end $$;
    `);
    await db.exec(liveSemanticEditorialDecisionsDdl.schema);
    await db.exec(liveSemanticEditorialDecisionsDdl.formation);
    await db.exec(liveSemanticEditorialDecisionsDdl.promotion);
    await db.query(`insert into users values($1,'editor')`, [editor]);
    await db.query(`insert into editorial_single_editor_authorizations values($2,$1,null)`, [editor, id(15)]);
    for (const groupId of [group, rejectedGroup, noDecisionGroup]) {
      await db.query(`insert into live_semantic_event_group_candidates values($1,'REVIEW_REQUIRED','config')`, [groupId]);
    }
    const payload = JSON.stringify({ spans: [{ quoted_text: 'one' }, { quoted_text: 'two' }] });
    await db.query(`insert into assertion_extraction_generations values($1,'active','proposed',$3),($2,'active','proposed',$3)`, [generationA, generationB, payload]);
    await db.query(`insert into live_semantic_event_group_members values($1,$2,$4,$6),($1,$3,$5,$7)`,
      [group, articleA, articleB, sourceA, sourceB, generationA, generationB]);
    await db.query(`insert into live_semantic_claim_pair_assessments values
      ($1,$2,$3,2,$4,1,$5,$6,true,90,'CONTRADICTORY',70,80,'config')`,
      [pairId, group, articleA, articleB, generationA, generationB]);
    await db.query(`select set_config('dialektik.actor_id',$1,false),set_config('dialektik.actor_type','editor',false),
      set_config('dialektik.action_type','moderation_decision',false)`, [editor]);
    await db.query(`insert into positions values($1,$3,'active'),($2,$3,'active')`, [id(20),id(21),id(22)]);
    await db.query(`insert into contradiction_publications values($1,$2,$3,null,'published')`, [id(23),id(20),id(21)]);
    await assert.rejects(db.query('select public.dialektik_assert_position_formation()'), /active Position requires/);
    await db.exec('set role dialektik_moderation_writer');
    const decide = (groupId, kind, claims, pairs = [], corr = correlation) => db.query(`
      select public.dialektik_record_live_semantic_editorial_decision(
        $1::dialektik_ulid,$2::dialektik_ulid,$3::dialektik_ulid,$4,$5,$6,$7::jsonb,$8::jsonb) as result`,
      [groupId, editor, corr, kind, 'Revisión editorial del acontecimiento',
        kind === 'APPROVED' ? 'Título revisado' : null, JSON.stringify(claims), JSON.stringify(pairs)]);
    await assert.rejects(db.query(`insert into public.live_semantic_editorial_decisions
      (group_id,editor_user_id,correlation_id,decision,reason,selected_claims,approved_conflict_pair_ids)
      values($1,$2,$3,'REJECTED','Motivo de revisión','[]','[]')`, [group, editor, correlation]), /permission denied/i);
    const noDecision = await db.query(`select public.dialektik_promote_live_semantic_event_group(
      $1::dialektik_ulid,$2::dialektik_ulid,$3::dialektik_ulid) as result`, [noDecisionGroup, editor, correlation]);
    assert.equal(noDecision.rows[0].result.reason, 'EDITORIAL_CLAIM_SELECTION_REQUIRED');
    const quarantine = await db.query(`select public.dialektik_quarantine_legacy_contradiction(
      $1::dialektik_ulid,$2::dialektik_ulid,$3::dialektik_ulid,$4) as result`,
      [id(23),editor,id(24),'Ninguna postura tiene evidencia vinculada.']);
    assert.equal(quarantine.rows[0].result.status, 'REVIEW_REQUIRED');
    await db.exec('reset role');
    await db.query('select public.dialektik_assert_position_formation()');
    await db.query(`insert into positions values($1,$2,'active')`, [id(25),id(22)]);
    await assert.rejects(db.query('select public.dialektik_assert_position_formation()'), /active Position requires/);
    await db.query('delete from positions where id=$1', [id(25)]);
    await db.exec('set role dialektik_moderation_writer');
    await assert.rejects(decide(group, 'APPROVED', [{ articleId: articleA, ordinal: 3 }, { articleId: articleB, ordinal: 1 }]), /STALE_OR_UNKNOWN/);
    await assert.rejects(decide(group, 'APPROVED', [{ articleId: articleA, ordinal: 2 }, { articleId: articleB, ordinal: 1 }], [id(99)]), /CONFLICT_SELECTION_INVALID/);
    const result = await decide(group, 'APPROVED', [{ articleId: articleA, ordinal: 2 }, { articleId: articleB, ordinal: 1 }], [pairId]);
    assert.equal(result.rows[0].result.status, 'APPROVED');
    await assert.rejects(decide(group, 'REJECTED', [], [], id(13)), /GROUP_ALREADY_DECIDED/);
    assert.equal((await decide(rejectedGroup, 'REJECTED', [], [], id(14))).rows[0].result.status, 'REJECTED');
    await db.exec('reset role');
    const stored = await db.query('select selected_claims,approved_conflict_pair_ids from public.live_semantic_editorial_decisions where group_id=$1', [group]);
    assert.deepEqual(stored.rows[0].selected_claims, [{ articleId: articleA, ordinal: 2 }, { articleId: articleB, ordinal: 1 }]);
    assert.deepEqual(stored.rows[0].approved_conflict_pair_ids, [pairId]);
    await db.exec(liveStanceReassessmentDdl.schema);
    await db.exec(liveStanceReassessmentDdl.decision);
    await db.exec(liveStanceReassessmentDdl.promotion);
    await db.exec(automaticFocusContrastsDdl);
    await db.exec(liveSemanticEventAttachmentDdl);
    await db.query(`insert into live_semantic_event_group_members values($1,$2,$4,$6),($1,$3,$5,$7)`,
      [noDecisionGroup, articleA, articleB, sourceA, sourceB, generationA, generationB]);
    await db.query(`insert into live_semantic_claim_pair_assessments values
      ($1,$2,$3,2,$4,1,$5,$6,true,90,'DIVERGENT',40,80,$7)`,
      [id(30), noDecisionGroup, articleA, articleB, generationA, generationB, 'aa'.repeat(32)]);
    await db.exec('set role dialektik_moderation_writer');
    const reviewedDivergence = await decide(noDecisionGroup, 'APPROVED',
      [{ articleId: articleA, ordinal: 2 }, { articleId: articleB, ordinal: 1 }], [id(30)], id(31));
    assert.equal(reviewedDivergence.rows[0].result.status, 'APPROVED');
    const rejectedAttachment = await db.query(`select public.dialektik_attach_live_semantic_article(
      $1::dialektik_ulid,$2::dialektik_ulid,$3::dialektik_ulid) as result`, [rejectedGroup,editor,id(32)]);
    assert.equal(rejectedAttachment.rows[0].result.reason, 'TWO_CLAIMS_AND_EDITORIAL_DECISION_REQUIRED');
  } finally {
    await db.close();
  }
});
