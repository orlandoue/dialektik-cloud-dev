import { createHash } from 'node:crypto';

import type { Ulid, UserRole } from '@dialektik/database';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import {
  InvalidSupabaseAccessTokenError,
  SupabaseJwtVerifier,
  SupabaseSigningKeysUnavailableError,
} from '../private-beta/supabase-jwt-verifier.js';
import { ModerationHttpError } from './moderation-http.error.js';

interface ModerationActor {
  readonly userId: Ulid;
  readonly role: UserRole;
}

export interface ModerationSessionIdentity extends ModerationActor {
  readonly kind: 'session';
  readonly sessionId: Ulid;
  readonly tokenHash: string;
}

export interface ModerationBetaIdentity extends ModerationActor {
  readonly kind: 'beta';
  readonly authUserId: string;
  readonly tokenExpiresAt: number;
}

export type ModerationIdentity = ModerationSessionIdentity | ModerationBetaIdentity;

const BEARER = /^Bearer ([\x21-\x7e]{32,8192})$/u;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

@Injectable()
export class ModerationAuthService {
  public constructor(
    @Inject(CoreDatabaseService)
    private readonly databaseService: CoreDatabaseService,
    @Inject(SupabaseJwtVerifier)
    private readonly supabaseVerifier: SupabaseJwtVerifier,
  ) {}

  public async authenticate(authorization: string | undefined): Promise<ModerationIdentity> {
    if (authorization === undefined) {
      throw new ModerationHttpError(401, 'MOD_AUTH_REQUIRED');
    }
    const match = BEARER.exec(authorization);
    const token = match?.[1];
    if (token === undefined) {
      throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
    }
    // Existing opaque moderation sessions remain valid without any beta binding.
    if (token.length <= 512) {
      const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
      const row = await this.databaseService.database
        .selectFrom('moderation_auth_sessions as session')
        .innerJoin('users as user', 'user.id', 'session.user_id')
        .select(['session.id as sessionId', 'user.id as userId', 'user.role'])
        .where('session.token_hash', '=', tokenHash)
        .where('session.revoked_at', 'is', null)
        .where('session.expires_at', '>', sql<Date>`clock_timestamp()`)
        .executeTakeFirst();
      if (row !== undefined) return Object.freeze({ kind: 'session', ...row, tokenHash });
    }

    if (!JWT_SHAPE.test(token)) {
      throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
    }

    let authUserId: string;
    let tokenExpiresAt: number;
    try {
      // Decode only after signature, issuer, audience, role and expiry verification.
      const verified = await this.supabaseVerifier.verify(token);
      const expiration = decodeJwt(token).exp;
      if (typeof expiration !== 'number' || !Number.isSafeInteger(expiration)) {
        throw new InvalidSupabaseAccessTokenError();
      }
      authUserId = verified.sub;
      tokenExpiresAt = expiration;
    } catch (error) {
      if (error instanceof SupabaseSigningKeysUnavailableError) {
        throw new ServiceUnavailableException('Authentication service is unavailable.');
      }
      throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
    }

    // A beta login alone does not confer editorial authority. Both the explicit
    // binding and beta allowlisting must remain active for the same Auth subject.
    const result = await sql<{ readonly userId: Ulid; readonly role: UserRole }>`
      select u.id as "userId", u.role
      from public.editorial_beta_identities binding
      join public.users u on u.id = binding.editorial_user_id
      join public.private_beta_testers beta on beta.user_id = binding.auth_user_id
      where binding.auth_user_id = ${authUserId}::uuid
        and binding.enabled is true and binding.revoked_at is null
        and beta.enabled is true and beta.revoked_at is null
        and u.role in ('editor', 'moderator')
        and to_timestamp(${tokenExpiresAt}) > clock_timestamp()
    `.execute(this.databaseService.database);
    const actor = result.rows[0];
    if (actor === undefined) throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
    return Object.freeze({ kind: 'beta', ...actor, authUserId, tokenExpiresAt });
  }
}
