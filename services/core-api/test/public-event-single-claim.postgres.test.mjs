import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { PublicApiRepository } from '../dist/public-api/public-api.repository.js';
import { PublicApiService } from '../dist/public-api/public-api.service.js';

test('feed admits a reviewed single-claim position only while its evidence and source remain valid', async () => {
  const db = new PGlite();
  let database;
  try {
    await db.exec(`
      create domain dialektik_ulid as text;
      create table categories(id text,slug text,is_active boolean);
      create table events(id text,title_descriptive text,category_id text,detected_at timestamptz,analysis_state text,merged_into text);
      create table articles(id text,event_id text,source_id text,origin text,live_exposure_id text,url_canonical text,captured_at timestamptz);
      create table positions(id text,event_id text,publication_state text,status text,neutral_rank int,published_at timestamptz,published_by text,title_text text);
      create table assertions(id text,position_id text,claim_span_id text,lifecycle_state text,is_principal boolean,supersedes_id text);
      create table claim_spans(id text,article_id text,tombstone_id text);
      create table evidence(id text,scope_assertion_id text,anchor_span_id text,publication_state text,approved_by text,approved_at timestamptz,citable_source_url text);
      create table position_formed_by(position_id text,relationship_id text);
      create table position_evidence_absence(position_id text,evidence_absence text);
      create table evidence_assessments(assertion_id text,confirmed_at timestamptz);
      create table relationships(id text,rel_type text,publication_state text,declared_by text,confirmed_by text,confirmed_at timestamptz);
      create table editorial_event_splits(original_event_id text);
      create table live_semantic_promotion_claims(group_id text,article_id text,claim_ordinal int,claim_span_id text,assertion_id text,evidence_id text,position_id text);
      create table live_semantic_promotion_positions(group_id text,event_id text,position_id text,editor_user_id text);
      create table live_semantic_editorial_decisions(group_id text,decision text,editor_user_id text,selected_claims jsonb);
      create table live_source_policies(id text,source_id text,active boolean,rights_class text,policy jsonb,recorded_at timestamptz);
      create table live_acquisition_receipts(exclusion_id text,source_id text,disposition text);
      insert into categories values('category','pais',true);
      insert into events values('event','Headline','category',now(),'PUBLISHED',null);
      insert into articles values('article','event','source','LIVE_REAL','exposure','https://example.test/story',now());
      insert into positions values('position','event','published','active',1,now(),'editor','Claim');
      insert into assertions values('assertion','position','span','active',true,null);
      insert into claim_spans values('span','article',null);
      insert into evidence values('evidence','assertion','span','published','editor',now(),'https://example.test/story');
      insert into live_semantic_promotion_claims values('group','article',1,'span','assertion','evidence','position');
      insert into live_semantic_promotion_positions values('group','event','position','editor');
      insert into live_semantic_editorial_decisions values('group','APPROVED','editor','[{"articleId":"article","ordinal":1}]');
      insert into live_source_policies values('policy','source',true,'LIVE_READY',
        '{"rightsReviewStatus":"APPROVED","authorizationReference":"review","rightsEvidenceUrl":"https://example.test/terms","endpoint":"https://example.test/feed"}',now());
      insert into live_acquisition_receipts values('exposure','source','PERSISTED');
    `);
    const pool = { async connect() { return { query: (query, values) =>
      db.query(typeof query === 'string' ? query : query.text, values ?? query.values ?? []), release() {} }; }, async end() {} };
    database = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const repository = new PublicApiRepository({ database });
    const feed = () => repository.listFeed({ cursor: null, limit: 10 });
    assert.equal((await feed()).length, 1);
    const positions = await repository.listPositions('event');
    assert.equal(positions.length, 1);
    assert.equal(positions[0].has_reviewed_single_claim, true);
    assert.equal(positions[0].formed_by_count, 0);
    await db.exec(`update live_semantic_editorial_decisions set selected_claims='[]'`);
    assert.equal((await feed()).length, 0);
    await db.exec(`update live_semantic_editorial_decisions set selected_claims='[{"articleId":"article","ordinal":1}]'`);
    await db.exec(`update evidence set approved_by='different-editor'`);
    assert.equal((await feed()).length, 0);
    await db.exec(`update evidence set approved_by='editor'`);
    await db.exec(`update live_acquisition_receipts set disposition='QUARANTINED'`);
    assert.equal((await feed()).length, 0);
    await db.exec(`update live_acquisition_receipts set disposition='PERSISTED'`);
    await db.exec(`update live_source_policies set policy=jsonb_set(policy,'{rightsReviewStatus}','"REVOKED"')`);
    assert.equal((await feed()).length, 0);
    await db.exec(`update live_source_policies set policy=jsonb_set(policy,'{rightsReviewStatus}','"APPROVED"')`);
    await db.exec(`update live_source_policies set policy=jsonb_set(policy,'{quarantinedArticleIds}','["article"]')`);
    assert.equal((await feed()).length, 0);
    await db.exec(`update live_source_policies set policy=policy-'quarantinedArticleIds'`);
    assert.equal((await feed()).length, 1);
  } finally {
    if (database) await database.destroy();
    await db.close();
  }
});

test('reviewed single-claim position details have no invented formation relationship', async () => {
  const timestamp = new Date('2026-10-31T12:00:00Z');
  const row = { id: 'position', ordinal: 1, total: 1, neutral_rank: 1, title_text: 'Claim',
    published_at: timestamp, assertion_count: 1, formed_by_count: 0, has_reviewed_single_claim: true,
    evidence_absence: null, representation_updated_at: timestamp };
  const assertion = { assertion_id: 'assertion', assertion_ordinal: 1, is_principal: true,
    epistemic_class: null, epistemic_reason: null, span_id: 'span', quoted_text: 'Claim', location: 'headline',
    captured_at: timestamp, text_offset_start: 0, text_offset_end: 5, article_id: 'article',
    url_canonical: 'https://example.test/story', article_published_at: timestamp, source_id: 'source',
    source_name: 'Source', source_type: 'media' };
  const repository = {
    async findPositionState() { return { id: 'position', event_id: 'event', publication_state: 'published', status: 'active', tombstone_id: null }; },
    async findEvent() { return { id: 'event', merged_into: null, analysis_state: 'PUBLISHED' }; },
    async listPositions() { return [row]; },
    async listPositionAssertions() { return [assertion]; },
    async listAttributions() { return []; },
    async listFormedBy() { return []; },
  };
  const service = new PublicApiService(repository);
  const result = await service.position('position');
  assert.deepEqual(result.body.formed_by, []);
  assert.equal(result.body.assertions.length, 1);
  row.has_reviewed_single_claim = false;
  await assert.rejects(service.position('position'), /formation is incomplete/);
});
