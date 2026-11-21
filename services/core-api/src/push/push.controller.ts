import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';

const OK = { status: 'ok' } as const;
import type { FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { PublicRateLimitService, rateLimitClient } from '../public-api/public-rate-limit.service.js';
import { PushService } from './push.service.js';

/** An FCM registration token: printable, no spaces, bounded. */
const TOKEN = /^[A-Za-z0-9_:\-.]{20,4096}$/u;

function input(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid push device.');
  return body as Record<string, unknown>;
}

function token(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN.test(value)) throw new BadRequestException('Invalid push token.');
  return value;
}

@Controller('v1/push')
@UseGuards(PrivateBetaAuthGuard)
export class PushController {
  constructor(@Inject(PushService) private readonly push: PushService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService) {}

  /** Registers this phone, or updates its «Duelo del día» preference. */
  @Post('devices')
  @HttpCode(200)
  async register(@Req() request: FastifyRequest, @Body() body: unknown): Promise<typeof OK> {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const value = input(body);
    const hour = value.daily_hour ?? 9;
    if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new BadRequestException('Invalid hour.');
    }
    const enabled = value.daily_enabled ?? true;
    if (typeof enabled !== 'boolean') throw new BadRequestException('Invalid preference.');
    const country = value.country ?? 'CL';
    if (typeof country !== 'string') throw new BadRequestException('Invalid country.');
    await this.push.register(betaUserId(request), { token: token(value.token), dailyEnabled: enabled, dailyHour: hour, country });
    return OK;
  }

  /** Forgets this phone (notices turned off, or sign-out). */
  @Post('devices/remove')
  @HttpCode(200)
  async unregister(@Req() request: FastifyRequest, @Body() body: unknown): Promise<typeof OK> {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    await this.push.unregister(betaUserId(request), token(input(body).token));
    return OK;
  }
}
