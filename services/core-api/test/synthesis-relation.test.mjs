import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicApiService } from '../dist/public-api/public-api.service.js';

const now = new Date('2026-11-01T12:00:00Z');
const row = { id:'event', title_descriptive:'Evento', category:'pais', detected_at:now,
  analysis_state:'PUBLISHED', source_count:2, position_count:1, representation_updated_at:now,
  window_from:now, window_to:null, merged_into:null };
test('feed and event preserve explicit classification and null remains unclassified', async () => {
  for (const relation of ['CONTRADICTION','DIFFERENT_FOCUS','DEVELOPING','TREND',null]) {
    const event = {...row,synthesis_relation:relation};
    const service = new PublicApiService({
      async listFeed(){return [event];}, async findEvent(){return event;},
      async findPrimaryFacts(){return [];},
    });
    const page = await service.feed({page:{cursor:null,limit:10,filterFingerprint:''},includeSynthesis:true});
    assert.equal(page.body.items[0].synthesis_relation,relation);
    const detail = await service.event('event');
    assert.equal('synthesis_relation' in detail.body,false);
    const legacy = await service.feed({page:{cursor:null,limit:10,filterFingerprint:''}});
    assert.equal('synthesis_relation' in legacy.body.items[0],false);
  }
});
