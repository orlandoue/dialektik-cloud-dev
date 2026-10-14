import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCoreApplication } from '../dist/bootstrap.js';
import { loadCoreApiConfig } from '../dist/config/core-api-config.js';

const environment = {
  NODE_ENV: 'test',
  SEMANTIC_MODE: 'disabled',
  CORE_API_HOST: '127.0.0.1',
  CORE_API_PORT: '3199',
  DATABASE_POOL_MAX: '1',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/test',
  SUPABASE_AUTH_ISSUER: 'https://example-project.supabase.co/auth/v1',
};

test('Core resolves the beta guard and protects content routes while health stays public', async () => {
  const previous = new Map(
    Object.keys(environment).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, environment);

  let application;
  try {
    const config = loadCoreApiConfig();
    application = await createCoreApplication(config, { abortOnError: false });
    await application.init();

    const fastify = application.getHttpAdapter().getInstance();
    assert.equal((await fastify.inject({ method: 'GET', url: '/health/live' })).statusCode, 200);
    assert.equal((await fastify.inject({ method: 'GET', url: '/v1/feed' })).statusCode, 401);
    assert.equal(
      (await fastify.inject({ method: 'GET', url: '/v1/contradictions' })).statusCode,
      401,
    );
    assert.equal(
      (
        await fastify.inject({
          method: 'GET',
          url: '/v1/feed',
          headers: { authorization: 'Bearer not-a-jwt' },
        })
      ).statusCode,
      401,
    );
  } finally {
    await application?.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
