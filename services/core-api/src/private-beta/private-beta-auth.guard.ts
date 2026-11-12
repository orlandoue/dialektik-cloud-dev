import {
  CanActivate,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import {
  InvalidSupabaseAccessTokenError,
  SupabaseSigningKeysUnavailableError,
  SupabaseJwtVerifier,
} from './supabase-jwt-verifier.js';
import { PrivateBetaTesterRepository } from './private-beta-tester.repository.js';

/** Open enrollment is on unless DIALEKTIK_PRIVATE_BETA_OPEN_ENROLLMENT=false. */
export function privateBetaOpenEnrollment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DIALEKTIK_PRIVATE_BETA_OPEN_ENROLLMENT?.trim().toLowerCase() !== 'false';
}

export class PrivateBetaAuthorizationService {
  /**
   * With open enrollment, any verified, non-anonymous Supabase account is
   * allowed unless the owner blocked it in private_beta_testers (disabled or
   * revoked). Without it, only listed and enabled accounts are allowed.
   */
  constructor(
    private readonly verifier: SupabaseJwtVerifier,
    private readonly testers: Pick<PrivateBetaTesterRepository, 'isEnabledTester'> &
      Partial<Pick<PrivateBetaTesterRepository, 'testerStatus'>>,
    private readonly openEnrollment = false,
  ) {}

  async authorize(token: string): Promise<string> {
    const identity = await this.verifier.verify(token);
    let allowed: boolean;
    try {
      allowed = this.openEnrollment && this.testers.testerStatus
        ? (await this.testers.testerStatus(identity.sub)) !== 'blocked'
        : await this.testers.isEnabledTester(identity.sub);
    } catch {
      throw new ServiceUnavailableException('Private beta authorization is unavailable.');
    }
    if (!allowed) throw new InvalidSupabaseAccessTokenError();
    return identity.sub;
  }
}

@Injectable()
export class PrivateBetaAuthGuard implements CanActivate {
  constructor(
    @Inject(PrivateBetaAuthorizationService)
    private readonly authorization: PrivateBetaAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? /^Bearer ([A-Za-z0-9._~-]{1,8192})$/iu.exec(authorization)
        : null;
    if (match?.[1] === undefined) throw new UnauthorizedException('Authentication required.');
    try {
      const userId = await this.authorization.authorize(match[1]);
      (request as FastifyRequest & { betaUserId: string }).betaUserId = userId;
      return true;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof SupabaseSigningKeysUnavailableError) {
        throw new ServiceUnavailableException('Authentication service is unavailable.');
      }
      if (error instanceof InvalidSupabaseAccessTokenError) {
        throw new UnauthorizedException('Authentication or beta access is invalid.');
      }
      throw new ServiceUnavailableException('Private beta authorization is unavailable.');
    }
  }
}

export function betaUserId(request: FastifyRequest): string {
  const id = (request as FastifyRequest & { betaUserId?: string }).betaUserId;
  if (!id) throw new UnauthorizedException('Authentication required.');
  return id;
}
