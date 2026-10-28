import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveApplicationService } from '../dist/live/live.service.js';

function row(id, eventId) {
  return {
    id,
    event_id: eventId,
    headline: 'Synthetic headline',
    excerpt: null,
    author: null,
    published_at: new Date('2026-10-27T12:00:00.000Z'),
    modified_at: null,
    first_seen_at: new Date('2026-10-27T12:01:00.000Z'),
    last_seen_at: new Date('2026-10-27T12:01:00.000Z'),
    canonical_url: 'https://example.invalid/news',
    declared_upstream: null,
    version_count: 1,
    source_id: '01M4YDQK00CH100000000G0BC1',
    source_name: 'Synthetic source',
    source_type: 'other',
    canonical_domain: 'example.invalid',
    policy: { storagePolicy: 'METADATA_ONLY' },
    original_published_at: null,
    original_modified_at: null,
    source_item_id: null,
    discovery_channel: 'rss_atom',
    discovery_url: 'https://example.invalid/feed',
    adapter_version: 'fixture',
    receipt_count: 1,
  };
}

test('live feed includes linked articles and reports the actual link state without exposing event IDs', async () => {
  const unassigned = row('01M4YDQK00EVART00000000001', null);
  const linked = row('01M4YDQK00EVART00000000002', '01M4YDQK00AM9JB7KHN6HEA504');
  const service = new LiveApplicationService({
    list: async () => [unassigned, linked],
    article: async () => linked,
  });
  const page = await service.list({ limit: 2 });
  assert.equal(page.semantic_mode, 'mixed');
  assert.deepEqual(page.items.map((item) => item.semantic_assignment), ['UNASSIGNED', 'EVENT_LINKED']);
  assert.ok(page.items.every((item) => !('event_id' in item)));
  const detail = await service.article(linked.id);
  assert.equal(detail.semantic_assignment, 'EVENT_LINKED');
  assert.ok(!('event_id' in detail));
  assert.equal(detail.content.body, null);
  const firstPage = await service.list({ limit: 1 });
  assert.equal(firstPage.semantic_mode, 'unassigned');
  assert.equal(firstPage.items[0].semantic_assignment, 'UNASSIGNED');
});
