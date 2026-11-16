import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeCatalogMarkets } from '../dist/live/live.publisher-market.js';

test('only Chile is polled and analysed unless more countries are listed', () => {
  assert.deepEqual(activeCatalogMarkets({}), ['CL']);
  assert.deepEqual(activeCatalogMarkets({ DIALEKTIK_ACTIVE_MARKETS: 'CL,ES,AR,US' }), ['CL', 'ES', 'AR', 'US']);
  assert.deepEqual(activeCatalogMarkets({ DIALEKTIK_ACTIVE_MARKETS: ' es , cl,ES' }), ['ES', 'CL']);
  // Unknown or empty values never pause everything.
  assert.deepEqual(activeCatalogMarkets({ DIALEKTIK_ACTIVE_MARKETS: 'UK,XX' }), ['CL']);
  assert.deepEqual(activeCatalogMarkets({ DIALEKTIK_ACTIVE_MARKETS: '' }), ['CL']);
});
