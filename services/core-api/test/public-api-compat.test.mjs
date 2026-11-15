import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicApiService } from '../dist/public-api/public-api.service.js';

// Installed apps validate exact field sets: a field they do not know makes
// the private-access check fail («No se pudo comprobar el acceso privado»).
// New fields therefore appear only when the client asks for them.
const now = new Date('2026-11-15T12:00:00Z');
const card = { id: '01M5MC0000000000000000EVNT', title_descriptive: 'Evento', category: 'pais', detected_at: now,
  analysis_state: 'PUBLISHED', source_count: 2, position_count: 1, representation_updated_at: now, country_code: 'CL' };
const legacyCardKeys = ['analysis_state', 'category', 'detected_at', 'id', 'position_count', 'source_count', 'title_descriptive'];
const page = { cursor: null, limit: 5, filterFingerprint: 'f' };

test('feed cards keep the legacy field set unless ?country is sent', async () => {
  const service = new PublicApiService({ async listFeed() { return [card]; } });
  const legacy = await service.feed({ page });
  assert.deepEqual(Object.keys(legacy.body.items[0]).sort(), legacyCardKeys);
  const withCountry = await service.feed({ page, country: 'CL', includeCountry: true });
  assert.equal(withCountry.body.items[0].country_code, 'CL');
});

test('contrasts keep the legacy field set unless ?country is sent', async () => {
  const row = { id: '01M5MC0000000000000000CNTR', event_id: card.id, event_title: 'Evento', position_a_id: 'a', position_a_ordinal: 1,
    position_a_title: 'A', position_b_id: 'b', position_b_ordinal: 2, position_b_title: 'B', ratio_conflicting: 60, ratio_comparable: 70,
    threshold_rule: 'v1', confirmed_at: now, needs_review: false, country_code: 'AR' };
  const service = new PublicApiService({ async listContradictions() { return [row]; } });
  assert.equal((await service.contradictions(page)).body.items[0].country_code, undefined);
  assert.equal((await service.contradictions(page, undefined, 'AR', true)).body.items[0].country_code, 'AR');
});

test('event detail articles carry outlet fields only with ?outlets=1', async () => {
  const event = { ...card, window_from: now, window_to: null, merged_into: null };
  let profileLookups = 0;
  const service = new PublicApiService({
    async findEvent() { return event; }, async findPrimaryFacts() { return []; },
    async listEventCoverage() { return []; },
    async listEventArticles() { return [{ article_id: 'art', article_title: 'T', source_name: 'Medio', published_at: now, url: 'https://e.example/a', source_id: 's' }]; },
    async listContradictions() { return []; },
    async sourceProfiles() { profileLookups += 1; return new Map([['s', { country_code: 'ES', media_group_slug: 'es-x', editorial_lean: 'centro' }]]); },
  });
  const legacy = await service.event(card.id, true);
  assert.deepEqual(Object.keys(legacy.body.articles[0]).sort(), ['id', 'published_at', 'source_name', 'title', 'url']);
  assert.equal(profileLookups, 0);
  const rich = await service.event(card.id, true, undefined, true);
  assert.equal(rich.body.articles[0].media_group_slug, 'es-x');
});
