import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicApiService } from '../dist/public-api/public-api.service.js';

test('event coverage returns the approved citation and original article while preserving the legacy contract', async () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const event = {id:'event',title_descriptive:'Evento',category:'pais',detected_at:now,analysis_state:'PUBLISHED',source_count:2,position_count:1,window_from:now,window_to:null,merged_into:null,representation_updated_at:now};
  let calls = 0;
  const service = new PublicApiService({
    async findEvent() { return event; }, async findPrimaryFacts() { return []; },
    async listEventCoverage() { calls++; return [{position_id:'position',position_title:'Postura',assertion_id:'assertion',assertion_text:'Resumen',quoted_text:'Cita literal',article_id:'article',article_title:'Titular',source_name:'Medio',published_at:now,url:'https://example.org/article'}]; },
    async listEventArticles() { return []; },
    async listContradictions() { return [{id:'contrast',position_a_id:'position',position_b_id:'other',threshold_rule:'v1:editorial_focus_contrast'}]; },
  });
  const legacy = await service.event('event');
  assert.equal(calls, 0);
  assert.equal('articles' in legacy.body, false);
  const result = await service.event('event', true);
  assert.equal(result.body.positions[0].assertions[0].quoted_text, 'Cita literal');
  assert.equal(result.body.articles[0].title, 'Titular');
  assert.equal(result.body.articles[0].url, 'https://example.org/article');
  assert.equal(result.body.contrasts[0].kind, 'contrast');
});
