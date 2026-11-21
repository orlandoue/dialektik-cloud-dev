// Phase 6: push notices. Migration 104 keeps the phones behind functions;
// Core sends the «Duelo del día» once a day, at each reader's hour, never the
// same duel twice, and forgets tokens FCM no longer knows.
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pushDevicesSql } from '../../../packages/database/dist/migration/104_push_devices.js';

const ana = '11111111-1111-4111-8111-111111111111';
const beto = '22222222-2222-4222-8222-222222222222';
const tokenA = 'tokenA_' + 'x'.repeat(40);
const tokenB = 'tokenB_' + 'y'.repeat(40);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  project_id: 'dialektik-test',
  client_email: 'push@dialektik-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
    insert into auth.users values ('${ana}'), ('${beto}');`);
  await pg.exec(pushDevicesSql);
  await pg.exec(pushDevicesSql); // idempotent
  const run = async (query, values) => {
    const text = typeof query === 'string' ? query : query.text;
    const params = values ?? query.values ?? [];
    await pg.exec('set role dialektik_core_app');
    try {
      if (params.length) return await pg.query(text, params);
      return (await pg.exec(text)).at(-1) ?? { rows: [] };
    } finally {
      await pg.exec('reset role');
    }
  };
  const pool = { async connect() { return { query: run, release() {} }; }, async end() {} };
  const { Kysely, PostgresDialect } = await import('kysely');
  return { pg, database: new Kysely({ dialect: new PostgresDialect({ pool }) }) };
}

test('Core reaches the devices only through the functions, as the reader', async () => {
  const { pg, database } = await setup();
  const { PushService } = await import('../dist/push/push.service.js');
  const service = new PushService({ database }, { listContradictions: async () => [] });
  await service.register(ana, { token: tokenA, dailyEnabled: true, dailyHour: 9, country: 'CL' });
  await pg.exec('set role dialektik_core_app');
  await assert.rejects(pg.query('select * from public.push_devices'));
  await assert.rejects(pg.query(`select public.dialektik_register_push_device('${beto}', '${tokenB}', true, 9, 'CL')`),
    /PUSH_DEVICE_USER_MISMATCH/u);
  await assert.rejects(pg.query(`select * from public.dialektik_push_daily_due(9, current_date)`), /PUSH_SENDER_REQUIRED/u);
  await pg.exec('reset role');
  // A phone that changes hands changes owner.
  await service.register(beto, { token: tokenA, dailyEnabled: false, dailyHour: 21, country: 'CL' });
  const row = (await pg.query('select user_id, daily_enabled, daily_hour from public.push_devices')).rows;
  assert.deepEqual(row, [{ user_id: beto, daily_enabled: false, daily_hour: 21 }]);
  // Only its owner removes it.
  await service.unregister(ana, tokenA);
  assert.equal((await pg.query('select count(*)::int as n from public.push_devices')).rows[0].n, 1);
  await service.unregister(beto, tokenA);
  assert.equal((await pg.query('select count(*)::int as n from public.push_devices')).rows[0].n, 0);
});

test('the daily duel goes once, at the reader\'s hour, never twice, and dead tokens are forgotten', async () => {
  const { pg, database } = await setup();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) {
      const assertion = new URLSearchParams(init.body).get('assertion');
      const [h, c, s] = assertion.split('.');
      const verify = createVerify('RSA-SHA256');
      verify.update(`${h}.${c}`);
      assert.ok(verify.verify(publicKey, Buffer.from(s, 'base64url')), 'JWT signed with the service account key');
      return { status: 200, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }), text: async () => '' };
    }
    const token = JSON.parse(init.body).message.token;
    if (token === tokenB) return { status: 404, json: async () => ({}), text: async () => 'UNREGISTERED' };
    return { status: 200, json: async () => ({}), text: async () => '' };
  };
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(account);
  try {
    const { PushService } = await import('../dist/push/push.service.js');
    const now = new Date('2026-11-22T12:05:00Z'); // 09:05 in Santiago (UTC-3)
    const duel = { event_id: 'EVT1', event_title: 'Contraste de enfoques: Gira de Kast por Asia',
      confirmed_at: new Date('2026-11-22T10:00:00Z') };
    const service = new PushService({ database }, { listContradictions: async () => [duel] });
    await service.register(ana, { token: tokenA, dailyEnabled: true, dailyHour: 9, country: 'CL' });
    await service.register(beto, { token: tokenB, dailyEnabled: true, dailyHour: 9, country: 'CL' });

    assert.deepEqual(await service.sendDaily(new Date('2026-11-22T11:05:00Z')), { sent: 0, forgotten: 0, skipped: 0 }, '08:05: not yet');
    assert.deepEqual(await service.sendDaily(now), { sent: 1, forgotten: 1, skipped: 0 });
    const sent = calls.filter((c) => c.url.includes('fcm.googleapis.com'));
    const message = JSON.parse(sent[0].init.body).message;
    assert.equal(sent[0].init.headers.authorization, 'Bearer ya29.test');
    assert.deepEqual(message.notification, { title: 'Duelo del día', body: 'Gira de Kast por Asia' });
    assert.deepEqual(message.data, { kind: 'daily_duel', event_id: 'EVT1' });
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, 'the access token is reused');
    // The dead token is gone; the same day nothing more is sent.
    assert.deepEqual((await pg.query('select token from public.push_devices')).rows, [{ token: tokenA }]);
    assert.deepEqual(await service.sendDaily(new Date('2026-11-22T12:15:00Z')), { sent: 0, forgotten: 0, skipped: 0 });
    // Next day, same duel: skipped, not repeated.
    assert.deepEqual(await service.sendDaily(new Date('2026-11-23T12:05:00Z')), { sent: 0, forgotten: 0, skipped: 1 });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }
});

test('an old duel is not «del día»', async () => {
  const { PushService } = await import('../dist/push/push.service.js');
  const old = { event_id: 'E', event_title: 'Viejo', confirmed_at: new Date('2026-11-19T10:00:00Z') };
  const service = new PushService({ database: null }, { listContradictions: async () => [old] });
  assert.equal(await service.dailyDuel('CL', new Date('2026-11-22T12:00:00Z')), null);
});
