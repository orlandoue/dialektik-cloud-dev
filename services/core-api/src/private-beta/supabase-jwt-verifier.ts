import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export interface SupabaseAccessTokenClaims {
  readonly sub: string;
}

export class InvalidSupabaseAccessTokenError extends Error {
  constructor() {
    super('Invalid Supabase access token.');
    this.name = 'InvalidSupabaseAccessTokenError';
  }
}

export class SupabaseSigningKeysUnavailableError extends Error {
  constructor() {
    super('Supabase signing keys are unavailable.');
    this.name = 'SupabaseSigningKeysUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_TOKEN_LENGTH = 8_192;

/** Verifies Supabase Auth access tokens using the project's cached public JWKS. */
export class SupabaseJwtVerifier {
  readonly #issuer: string;
  readonly #jwks: JWTVerifyGetKey;
  readonly #now: () => number;

  constructor(
    issuer: string,
    jwks: JWTVerifyGetKey = createRemoteJWKSet(
      new URL(`${issuer.replace(/\/$/u, '')}/.well-known/jwks.json`),
      {
        cacheMaxAge: 5 * 60_000,
        cooldownDuration: 60_000,
        timeoutDuration: 5_000,
      },
    ),
    now: () => number = Date.now,
  ) {
    this.#issuer = issuer.replace(/\/$/u, '');
    this.#jwks = jwks;
    this.#now = now;
  }

  async verify(token: string): Promise<SupabaseAccessTokenClaims> {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw new InvalidSupabaseAccessTokenError();
    }
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.#jwks, {
        algorithms: ['ES256'],
        audience: 'authenticated',
        currentDate: new Date(this.#now()),
        issuer: this.#issuer,
        requiredClaims: ['exp', 'iat', 'sub'],
      });
      if (
        protectedHeader.alg !== 'ES256' ||
        typeof protectedHeader.kid !== 'string' ||
        typeof payload.sub !== 'string' ||
        !UUID_PATTERN.test(payload.sub) ||
        payload.role !== 'authenticated' ||
        payload.is_anonymous === true
      ) {
        throw new InvalidSupabaseAccessTokenError();
      }
      return Object.freeze({ sub: payload.sub });
    } catch (error) {
      if (error instanceof InvalidSupabaseAccessTokenError) throw error;
      if (
        error instanceof errors.JWKSTimeout ||
        error instanceof errors.JWKSInvalid ||
        (error instanceof Error &&
          'code' in error &&
          typeof error.code === 'string' &&
          error.code.startsWith('ERR_JWKS_') &&
          error.code !== 'ERR_JWKS_NO_MATCHING_KEY')
      ) {
        throw new SupabaseSigningKeysUnavailableError();
      }
      throw new InvalidSupabaseAccessTokenError();
    }
  }
}
