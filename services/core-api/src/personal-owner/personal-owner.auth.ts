import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  Inject,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isPersonalOwnerAuthorizationValid(
  authorization: string | undefined,
  config: Readonly<CoreApiConfig>,
): boolean {
  if (
    config.ownershipMode !== 'personal' ||
    !config.personalOwnerAuthTokenSha256 ||
    typeof authorization !== 'string' ||
    authorization.length > 4096
  )
    return false;
  const match = /^Bearer ([A-Za-z0-9._~-]{32,2048})$/.exec(authorization);
  if (!match?.[1]) return false;
  const expected = Buffer.from(config.personalOwnerAuthTokenSha256, 'hex');
  return expected.length === 32 && timingSafeEqual(digest(match[1]), expected);
}

@Injectable()
export class PersonalOwnerGuard implements CanActivate {
  constructor(@Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    if (!isPersonalOwnerAuthorizationValid(request.headers.authorization, this.config))
      throw new UnauthorizedException('PERSONAL_OWNER_AUTH_REQUIRED');
    return true;
  }
}
