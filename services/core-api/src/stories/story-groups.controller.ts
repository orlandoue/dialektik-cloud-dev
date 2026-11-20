import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { PublicRateLimitService, rateLimitClient } from '../public-api/public-rate-limit.service.js';
import { StoryGroupsService } from './story-groups.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('v1')
@UseGuards(PrivateBetaAuthGuard)
export class StoryGroupsController {
  constructor(
    @Inject(StoryGroupsService) private readonly stories: StoryGroupsService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService,
  ) {}

  /** Approved stories: several events of one developing topic. */
  @Get('story-groups')
  async list(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    betaUserId(request);
    void reply.header('cache-control', 'private, max-age=60');
    return { stories: await this.stories.stories() };
  }

  /** Proposals waiting for a moderator («Fusiones»). */
  @Get('moderation/story-groups')
  async proposals(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.stories.proposals(betaUserId(request));
  }

  /** `approve` (optionally with the story's title) or `reject`. */
  @Post('moderation/story-groups/:id')
  async decide(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    if (!UUID.test(id)) throw new BadRequestException('Invalid proposal.');
    const input = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (input.decision !== 'approve' && input.decision !== 'reject') throw new BadRequestException('Invalid decision.');
    const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : null;
    return this.stories.decide(betaUserId(request), id, input.decision === 'approve', title);
  }
}
