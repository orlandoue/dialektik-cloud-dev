import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {editorialFocusContrastsDdl} from '../../../packages/database/dist/migration/078_editorial_focus_contrasts.js';
test('an editorial contrast needs two source-backed current claims; conflict rules remain strict',async()=>{
 const db=new PGlite();try{
 await db.exec(`create domain dialektik_ulid as text;
 create table users(id text,role text);create table editorial_single_editor_authorizations(editor_user_id text,revoked_at timestamptz);
 create table position_relation_projections(event_id text,position_a_id text,position_b_id text,requires_review boolean,projection_hash text,conflict_pairs int,comparable_pairs int,publication_eligible boolean);
 create table articles(id text,event_id text,origin text,source_id text,live_exposure_id text,text_original text);
 create table claim_spans(id text,article_id text,quoted_text text,tombstone_id text,text_offset_start int,text_offset_end int);
 create table assertions(id text,position_id text,claim_span_id text,lifecycle_state text,supersedes_id text);
 create table evidence(scope_assertion_id text,anchor_span_id text,publication_state text,approved_by text);
 create table live_acquisition_receipts(source_id text,exclusion_id text,disposition text);
 create function dialektik_live_semantic_source_allowed(text) returns boolean language sql as $$select true$$;
 create table contradiction_publications(event_id text,position_a_id text,position_b_id text,projection_hash text,ratio_conflicting_at_publication int,ratio_comparable_at_publication int,threshold_rule_at_publication text,confirmed_by text,confirmed_at timestamptz);
 insert into users values('editor','editor'); insert into editorial_single_editor_authorizations values('editor',null);
 insert into position_relation_projections values('event','p1','p2',false,'hash',0,1,false);
 insert into articles values('a','event','LIVE_REAL','s1','x1','Primera cita'),('b','event','LIVE_REAL','s2','x2','Segunda cita');
 insert into claim_spans values('c1','a','Primera cita',null,0,12),('c2','b','Segunda cita',null,0,12);
 insert into assertions values('a1','p1','c1','active',null),('a2','p2','c2','active',null);
 insert into evidence values('a1','c1','published','editor'),('a2','c2','published','editor');
 insert into live_acquisition_receipts values('s1','x1','PERSISTED'),('s2','x2','PERSISTED');
 select set_config('dialektik.actor_type','editor',false),set_config('dialektik.actor_id','editor',false);`);
 await db.exec(editorialFocusContrastsDdl);
 await db.exec('create trigger gate before insert on contradiction_publications for each row execute function dialektik_validate_contradiction_publication_projection()');
 const insert=rule=>db.query("insert into contradiction_publications values('event','p1','p2','hash',0,1,$1,'editor',now())",[rule]);
 await assert.rejects(insert('v1:any_confirmed_conflict'),/eligible conflict/);
 await insert('v1:editorial_focus_contrast');
 await db.exec("update articles set source_id='s1' where id='b'");
 await assert.rejects(insert('v1:editorial_focus_contrast'),/different source-backed/);
 await db.exec("update articles set source_id='s2' where id='b'; update claim_spans set quoted_text='Alterada' where id='c2'");
 await assert.rejects(insert('v1:editorial_focus_contrast'),/different source-backed/);
 }finally{await db.close()}
});
