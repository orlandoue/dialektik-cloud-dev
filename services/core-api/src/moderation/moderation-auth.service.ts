import { createHash } from 'node:crypto';

import type { Ulid, UserRole } from '@dialektik/database';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import { ModerationHttpError } from './moderation-http.error.js';

export interface ModerationIdentity {
  readonly sessionId: Ulid;
  readonly userId: Ulid;
  readonly role: UserRole;
  readonly tokenHash: string;
}

const OPAQUE_BEARER = /^Bearer ([\x21-\x7e]{32,512})$/u;

@Injectable()
export class ModerationAuthService {
  public constructor(
    @Inject(CoreDatabaseService)
    private readonly databaseService: CoreDatabaseService,
  ) {}

  public async authenticate(authorization: string | undefined): Promise<ModerationIdentity> {
    if (authorization === undefined) {
      throw new ModerationHttpError(401, 'MOD_AUTH_REQUIRED');
    }
    const match = OPAQUE_BEARER.exec(authorization);
    const token = match?.[1];
    if (token === undefined) {
      throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
    }
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const row = await this.databaseService.database
      .selectFrom('moderation_auth_sessions as session')
      .innerJoin('users as user', 'user.id', 'session.user_id')
      .select(['session.id as sessionId', 'user.id as userId', 'user.role'])
      .where('session.token_hash', '=', tokenHash)
      .where('session.revoked_at', 'is', null)
      .where('session.expires_at', '>', sql<Date>`clock_timestamp()`)
      .executeTakeFirst();
    if (row === undefined) {
      throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
    }
    return Object.freeze({ ...row, tokenHash });
  }
}
