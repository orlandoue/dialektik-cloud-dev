import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { createFastifyOptions } from '../dist/http/request-correlation.js';
import { PublicRateLimitService, rateLimitClient } from '../dist/public-api/public-rate-limit.service.js';

test('signed-in readers get their own quota even behind one shared address', () => {
  const limiter = new PublicRateLimitService();
  const shared = '10.0.0.1';
  const reader = (id) => rateLimitClient({ ip: shared, betaUserId: id });
  for (let i = 0; i < 300; i++) limiter.assertAllowed(reader('ana'), 1_000);
  assert.throws(() => limiter.assertAllowed(reader('ana'), 1_000), (error) => error.getStatus() === 429);
  // Another reader on the same proxy address is unaffected.
  assert.doesNotThrow(() => limiter.assertAllowed(reader('bruno'), 1_000));
  assert.equal(rateLimitClient({ ip: shared }), 'ip:10.0.0.1');
  assert.equal(reader('ana'), 'user:ana');
});

test('the address comes from the single trusted proxy hop, not from client-injected entries', async () => {
  const app = Fastify(createFastifyOptions({ logLevel: 'silent' }));
  app.get('/ip', async (request) => ({ ip: request.ip }));
  const forwarded = await app.inject({ url: '/ip', remoteAddress: '10.1.2.3', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } });
  assert.equal(forwarded.json().ip, '203.0.113.9');
  await app.close();

  const direct = Fastify(createFastifyOptions({ logLevel: 'silent', trustedProxyHops: 0 }));
  direct.get('/ip', async (request) => ({ ip: request.ip }));
  const ignored = await direct.inject({ url: '/ip', remoteAddress: '10.1.2.3', headers: { 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(ignored.json().ip, '10.1.2.3');
  await direct.close();
});
