import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, SignJWT } from 'jose';

import {
  InvalidSupabaseAccessTokenError,
  SupabaseJwtVerifier,
} from '../dist/private-beta/supabase-jwt-verifier.js';
import { PrivateBetaAuthorizationService, privateBetaOpenEnrollment } from '../dist/private-beta/private-beta-auth.guard.js';

const issuer = 'https://example-project.supabase.co/auth/v1';
const subject = '2f0db489-178a-4fe0-9e6a-0e69f1d8be5c';
const nowMs = Date.parse('2026-10-13T12:00:00.000Z');
const nowSeconds = Math.floor(nowMs / 1000);
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = {
  ...await exportJWK(publicKey),
  kid: 'v7q-test-key',
  alg: 'ES256',
  use: 'sig',
};
const localJwks = createLocalJWKSet({ keys: [jwk] });

async function token(claimOverrides = {}, headerOverrides = {}) {
  const issuerValue = claimOverrides.iss ?? issuer;
  const audienceValue = claimOverrides.aud ?? 'authenticated';
  const subjectValue = claimOverrides.sub ?? subject;
  const builder = new SignJWT({
    role: 'authenticated',
    is_anonymous: false,
    ...claimOverrides,
  })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid, typ: 'JWT', ...headerOverrides })
    .setIssuer(issuerValue)
    .setAudience(audienceValue)
    .setSubject(subjectValue)
    .setIssuedAt(claimOverrides.iat ?? nowSeconds)
    .setExpirationTime(claimOverrides.exp ?? nowSeconds + 3600);
  if (claimOverrides.nbf !== undefined) builder.setNotBefore(claimOverrides.nbf);
  return builder.sign(privateKey);
}

function verifier() {
  return new SupabaseJwtVerifier(issuer, localJwks, () => nowMs);
}

test('valid Supabase Auth ES256 token verifies issuer, audience, and subject', async () => {
  assert.deepEqual(await verifier().verify(await token()), { sub: subject });
});

test('invalid, expired, anonymous, wrong-role, wrong-issuer, and wrong-audience tokens fail closed', async () => {
  const signed = (await token()).split('.');
  const unsupportedHeader = Buffer.from(
    JSON.stringify({ alg: 'none', kid: jwk.kid, typ: 'JWT' }),
  ).toString('base64url');
  const invalidTokens = [
    'not-a-jwt',
    await token({ exp: nowSeconds - 1 }),
    await token({ role: 'anon' }),
    await token({ aud: 'anon' }),
    await token({ iss: 'https://attacker.example/auth/v1' }),
    await token({ is_anonymous: true }),
    await token({ sub: 'not-a-uuid' }),
    `${unsupportedHeader}.${signed[1]}.${signed[2]}`,
  ];
  for (const candidate of invalidTokens) {
    await assert.rejects(verifier().verify(candidate), InvalidSupabaseAccessTokenError);
  }
});

test('tampered signature is rejected', async () => {
  const parts = (await token()).split('.');
  const tampered = `${parts[0]}.${parts[1]}.${Buffer.alloc(64, 7).toString('base64url')}`;
  await assert.rejects(verifier().verify(tampered), InvalidSupabaseAccessTokenError);
});

test('valid identity is denied until enabled and is denied immediately after revocation', async () => {
  let enabled = false;
  const authorization = new PrivateBetaAuthorizationService(verifier(), {
    isEnabledTester: async (userId) => userId === subject && enabled,
  });
  await assert.rejects(authorization.authorize(await token()), InvalidSupabaseAccessTokenError);
  enabled = true;
  await assert.doesNotReject(authorization.authorize(await token()));
  enabled = false;
  await assert.rejects(authorization.authorize(await token()), InvalidSupabaseAccessTokenError);
});

test('open enrollment admits any verified account except those the owner blocked', async () => {
  const statuses = new Map();
  const testers = {
    isEnabledTester: async () => { throw new Error('closed-mode lookup must not run'); },
    testerStatus: async (id) => statuses.get(id) ?? 'absent',
  };
  const authorization = new PrivateBetaAuthorizationService(verifier(), testers, true);
  // A brand-new Google or email account is admitted without being listed.
  assert.equal(await authorization.authorize(await token()), subject);
  statuses.set(subject, 'enabled');
  assert.equal(await authorization.authorize(await token()), subject);
  // Disabling or revoking the row still blocks the account.
  statuses.set(subject, 'blocked');
  await assert.rejects(authorization.authorize(await token()), InvalidSupabaseAccessTokenError);
  // Anonymous and forged tokens never pass, open enrollment or not.
  await assert.rejects(authorization.authorize(await token({ is_anonymous: true })), InvalidSupabaseAccessTokenError);
  await assert.rejects(authorization.authorize('not-a-jwt'), InvalidSupabaseAccessTokenError);
});

test('open enrollment is on by default and turned off by an explicit false', () => {
  assert.equal(privateBetaOpenEnrollment({}), true);
  assert.equal(privateBetaOpenEnrollment({ DIALEKTIK_PRIVATE_BETA_OPEN_ENROLLMENT: 'true' }), true);
  assert.equal(privateBetaOpenEnrollment({ DIALEKTIK_PRIVATE_BETA_OPEN_ENROLLMENT: 'false' }), false);
  assert.equal(privateBetaOpenEnrollment({ DIALEKTIK_PRIVATE_BETA_OPEN_ENROLLMENT: ' FALSE ' }), false);
});
