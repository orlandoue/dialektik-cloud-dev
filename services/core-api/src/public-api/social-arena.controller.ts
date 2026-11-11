import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { parseUlidParameter } from './public-api.validation.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';
import { SocialArenaService, type CommunityChannel } from './social-arena.service.js';

const CHANNELS: Record<string, CommunityChannel> = { debate: 'DEBATE', aporte: 'APORTE', nota: 'NOTA' };
const ALIAS = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,29}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(body: unknown, message: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException(message);
  return body as Record<string, unknown>;
}

/** Accepts only an absolute http(s) link without credentials. */
function parseLink(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 2000) throw new BadRequestException('Invalid link.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new BadRequestException('Invalid link.'); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '' || url.hostname === '') {
    throw new BadRequestException('Invalid link.');
  }
  return url.toString();
}

@Controller('v1/social')
@UseGuards(PrivateBetaAuthGuard)
export class SocialArenaController {
  constructor(@Inject(SocialArenaService) private readonly arena: SocialArenaService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService) {}

  /** Lets an authenticated reader see whether the Arena storage exists. */
  @Get('arena-status')
  status(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(request.ip);
    betaUserId(request);
    void reply.header('cache-control', 'private, no-store');
    return { storage: this.arena.storage };
  }

  @Get('position-votes')
  async positionVotes(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply,
    @Query('event_id') eventId?: string) {
    this.rateLimit.assertAllowed(request.ip);
    if (eventId === undefined) throw new BadRequestException('Specify one event.');
    void reply.header('cache-control', 'private, no-store');
    return this.arena.positionVotes(betaUserId(request), parseUlidParameter(eventId));
  }

  @Post('position-votes')
  async votePosition(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.rateLimit.assertAllowed(request.ip);
    const input = record(body, 'Invalid position vote.');
    if (typeof input.event_id !== 'string' || (input.position_id !== null && typeof input.position_id !== 'string')) {
      throw new BadRequestException('Invalid position vote.');
    }
    const eventId = parseUlidParameter(input.event_id);
    const positionId = input.position_id === null ? null : parseUlidParameter(input.position_id);
    await this.arena.votePosition(betaUserId(request), eventId, positionId);
    return this.arena.positionVotes(betaUserId(request), eventId);
  }

  @Get('community')
  async community(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply,
    @Query('event_id') eventId?: string) {
    this.rateLimit.assertAllowed(request.ip);
    if (eventId === undefined) throw new BadRequestException('Specify one event.');
    void reply.header('cache-control', 'private, no-store');
    return this.arena.community(betaUserId(request), parseUlidParameter(eventId));
  }

  @Post('community')
  async addEntry(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.rateLimit.assertAllowed(request.ip);
    const message = 'A channel, a brief text and, for contributions and notes, a source are required.';
    const input = record(body, message);
    const channel = typeof input.channel === 'string' ? CHANNELS[input.channel] : undefined;
    const text = typeof input.body === 'string' ? input.body.trim() : '';
    if (typeof input.event_id !== 'string' || channel === undefined || text.length < 1 || text.length > 600) {
      throw new BadRequestException(message);
    }
    if (input.article_id !== undefined && input.article_id !== null && typeof input.article_id !== 'string') {
      throw new BadRequestException(message);
    }
    let alias: string | null = null;
    if (input.alias !== undefined && input.alias !== null) {
      if (typeof input.alias !== 'string' || !ALIAS.test(input.alias.trim())) throw new BadRequestException('Invalid alias.');
      alias = input.alias.trim();
    }
    const eventId = parseUlidParameter(input.event_id);
    const articleId = typeof input.article_id === 'string' ? parseUlidParameter(input.article_id) : null;
    const linkUrl = parseLink(input.link_url);
    if (channel !== 'DEBATE' && articleId === null && linkUrl === null) throw new BadRequestException(message);
    await this.arena.addEntry(betaUserId(request), eventId, { channel, body: text, alias, articleId, linkUrl });
    return this.arena.community(betaUserId(request), eventId);
  }

  @Post('community/votes')
  async voteEntry(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.rateLimit.assertAllowed(request.ip);
    const input = record(body, 'Invalid vote.');
    if (typeof input.entry_id !== 'string' || !UUID.test(input.entry_id) || ![1, -1, null].includes(input.vote as number | null)) {
      throw new BadRequestException('Invalid vote.');
    }
    const eventId = await this.arena.voteEntry(betaUserId(request), input.entry_id, input.vote as 1 | -1 | null);
    return this.arena.community(betaUserId(request), eventId);
  }
}
