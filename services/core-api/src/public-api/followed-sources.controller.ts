import { Controller, Delete, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { parseUlidParameter } from './public-api.validation.js';
import { FollowedSourcesService } from './followed-sources.service.js';

@Controller('v1/sources')
@UseGuards(PrivateBetaAuthGuard)
export class FollowedSourcesController {
  constructor(@Inject(FollowedSourcesService) private readonly follows: FollowedSourcesService) {}
  @Get('following') async list(@Req() request: FastifyRequest, @Res({passthrough:true}) reply: FastifyReply) {
    void reply.header('cache-control','private, no-store');
    return {source_ids: await this.follows.list(betaUserId(request))};
  }
  @Post(':sourceId/follow') async follow(@Req() request:FastifyRequest,@Param('sourceId') sourceId:string) {
    await this.follows.change(betaUserId(request),parseUlidParameter(sourceId),true);
    return {source_id:sourceId,following:true};
  }
  @Delete(':sourceId/follow') async unfollow(@Req() request:FastifyRequest,@Param('sourceId') sourceId:string) {
    await this.follows.change(betaUserId(request),parseUlidParameter(sourceId),false);
    return {source_id:sourceId,following:false};
  }
}
