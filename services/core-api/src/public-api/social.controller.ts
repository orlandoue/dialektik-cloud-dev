import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { parseUlidParameter } from './public-api.validation.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';
import { SocialService, type SocialReaction } from './social.service.js';

@Controller('v1/social')
@UseGuards(PrivateBetaAuthGuard)
export class SocialController {
  constructor(@Inject(SocialService) private readonly social: SocialService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService) {}

  @Post('reactions')
  async react(@Req() request:FastifyRequest, @Body() body:unknown) {
    this.rateLimit.assertAllowed(request.ip);
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid reaction.');
    const input=body as Record<string,unknown>;
    if (typeof input.event_id !== 'string' || ![null,'SOLID','BIASED'].includes(input.reaction as string | null)) throw new BadRequestException('Invalid reaction.');
    const id=parseUlidParameter(input.event_id);
    await this.social.react(betaUserId(request),id,input.reaction as SocialReaction | null);
    return this.social.summary(betaUserId(request),id);
  }

  @Get('summary')
  async summary(@Req() request:FastifyRequest, @Res({passthrough:true}) reply:FastifyReply,
    @Query('event_id') eventId?:string, @Query('source_id') sourceId?:string) {
    this.rateLimit.assertAllowed(request.ip);
    if ((eventId === undefined) === (sourceId === undefined)) throw new BadRequestException('Specify one event or source.');
    void reply.header('cache-control','private, no-store');
    return this.social.summary(betaUserId(request),eventId === undefined ? undefined : parseUlidParameter(eventId),sourceId === undefined ? undefined : parseUlidParameter(sourceId));
  }

  @Post('comments')
  async comment(@Req() request:FastifyRequest, @Body() body:unknown) {
    this.rateLimit.assertAllowed(request.ip);
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid comment.');
    const input=body as Record<string,unknown>;
    if (typeof input.event_id !== 'string' || typeof input.article_id !== 'string' || typeof input.body !== 'string' || input.body.trim().length < 1 || input.body.trim().length > 600) throw new BadRequestException('A brief comment and event article are required.');
    const id=parseUlidParameter(input.event_id);
    await this.social.comment(betaUserId(request),id,parseUlidParameter(input.article_id),input.body.trim());
    return this.social.summary(betaUserId(request),id);
  }
}
