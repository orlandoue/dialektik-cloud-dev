import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { PublicRateLimitService, rateLimitClient } from '../public-api/public-rate-limit.service.js';
import { PUBLIC_COUNTRIES, type PublicCountry } from '../public-api/source-profiles.js';
import { EditionService } from './edition.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET = /^[0-9A-Za-z-]{1,64}$/u;

function country(value: unknown): PublicCountry {
  const code = value === undefined ? 'CL' : value;
  if (typeof code !== 'string' || !(PUBLIC_COUNTRIES as readonly string[]).includes(code)) {
    throw new BadRequestException('Invalid country.');
  }
  return code as PublicCountry;
}

@Controller('v1')
@UseGuards(PrivateBetaAuthGuard)
export class EditionController {
  constructor(
    @Inject(EditionService) private readonly editions: EditionService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService,
  ) {}

  /** The current edition of Inicio, the same for every reader of a country. */
  @Get('home-edition')
  async latest(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query('country') code: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    betaUserId(request);
    void reply.header('cache-control', 'private, max-age=60');
    return { edition: await this.editions.latest(country(code)) };
  }

  @Get('moderation/home-edition')
  async moderation(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query('country') code: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.editions.moderation(betaUserId(request), country(code));
  }

  /** Pin a case or story to the top, hide it, or choose the «Duelo del día». */
  @Post('moderation/home-edition/pins')
  async pin(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const kind = input.target_kind;
    const action = input.action;
    const hours = input.hours ?? 12;
    if (kind !== 'event' && kind !== 'story') throw new BadRequestException('Invalid target.');
    if (action !== 'pin' && action !== 'hide' && action !== 'duel') throw new BadRequestException('Invalid action.');
    if (typeof input.target_id !== 'string' || !TARGET.test(input.target_id)) throw new BadRequestException('Invalid target.');
    if (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.trim().length > 200) {
      throw new BadRequestException('A reason is required.');
    }
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 168) throw new BadRequestException('Invalid duration.');
    const edition = await this.editions.pin(betaUserId(request), {
      country: country(input.country), targetKind: kind, targetId: input.target_id, action, reason: input.reason, hours,
    });
    return { edition };
  }

  @Post('moderation/home-edition/pins/:id/remove')
  async unpin(@Req() request: FastifyRequest, @Param('id') id: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    if (!UUID.test(id)) throw new BadRequestException('Invalid pin.');
    return { edition: await this.editions.unpin(betaUserId(request), id) };
  }
}
