import { BadRequestException, Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { sendPublicRead } from './public-api.cache.js';
import { PUBLIC_OPENAPI_DOCUMENT } from './public-api.openapi.js';
import { PublicApiService } from './public-api.service.js';
import { PublicRateLimitService, rateLimitClient } from './public-rate-limit.service.js';
import { FollowedSourcesService } from './followed-sources.service.js';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import {
  assertExactQueryKeys,
  parseOptionalFilter,
  parsePageRequest,
  parseUlidParameter,
} from './public-api.validation.js';

type PublicQuery = Readonly<Record<string, unknown>>;

@Controller('v1')
@UseGuards(PrivateBetaAuthGuard)
export class PublicApiController {
  public constructor(
    @Inject(PublicApiService) private readonly publicApi: PublicApiService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService,
    @Inject(FollowedSourcesService) private readonly follows: FollowedSourcesService,
  ) {}

  @Get('openapi.json')
  public openApi(
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, []);
    return sendPublicRead(request, reply, {
      body: PUBLIC_OPENAPI_DOCUMENT,
      lastModified: new Date('2026-09-15T00:00:00.000Z'),
    });
  }

  @Get('feed')
  public async feed(
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, ['category', 'topic', 'cursor', 'limit', 'personalized', 'synthesis']);
    if (query.synthesis !== undefined && query.synthesis !== '1') throw new BadRequestException('Invalid synthesis projection.');
    if (query.personalized !== undefined && query.personalized !== '1') throw new BadRequestException('Invalid personalization.');
    const category = parseOptionalFilter(query.category);
    const topic = parseOptionalFilter(query.topic);
    const userId = query.personalized === '1' ? betaUserId(request) : undefined;
    const followedSourceIds = userId === undefined ? undefined : await this.follows.list(userId);
    const page = parsePageRequest(query, 'feed', { category, topic, synthesis: query.synthesis, ...(userId === undefined ? {} : {user: userId, follows: followedSourceIds!.join(',')}) });
    if (followedSourceIds !== undefined) {
      void reply.header('cache-control','private, no-store');
      return (await this.publicApi.feed({ ...(category === undefined ? {} : {category}), ...(topic === undefined ? {} : {topic}), page, followedSourceIds, includeSynthesis: query.synthesis === '1' })).body;
    }
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.feed({
        ...(category === undefined ? {} : { category }),
        ...(topic === undefined ? {} : { topic }),
        page,
        includeSynthesis: query.synthesis === '1',
      }),
    );
  }

  @Get('contradictions')
  public async contradictions(
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, ['cursor', 'limit', 'personalized']);
    if (query.personalized !== undefined && query.personalized !== '1') throw new BadRequestException('Invalid personalization.');
    const userId = query.personalized === '1' ? betaUserId(request) : undefined;
    const followed = userId === undefined ? undefined : await this.follows.list(userId);
    const page = parsePageRequest(query, 'contradictions', userId === undefined ? {} : {user:userId,follows:followed!.join(',')});
    if (followed !== undefined) {
      void reply.header('cache-control','private, no-store');
      return (await this.publicApi.contradictions(page, followed)).body;
    }
    return sendPublicRead(request, reply, await this.publicApi.contradictions(page));
  }

  @Get('feed/blindspots')
  public async blindspots(@Query() query: PublicQuery, @Req() request: FastifyRequest, @Res({passthrough:true}) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, ['cursor','limit']);
    const userId=betaUserId(request);
    const followedSourceIds=await this.follows.list(userId);
    const page=parsePageRequest(query,'feed',{user:userId,follows:followedSourceIds.join(','),blindspots:'1'});
    void reply.header('cache-control','private, no-store');
    if (followedSourceIds.length === 0) return {items:[],next_cursor:null,followed_source_count:0,total:0};
    const result=await this.publicApi.feed({page,followedSourceIds,blindspots:true});
    return {...result.body,followed_source_count:followedSourceIds.length,total:await this.publicApi.countBlindspots(followedSourceIds)};
  }

  @Get('events/:eventId')
  public async event(
    @Param('eventId') eventId: string,
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, ['include','personalized']);
    if (query.personalized !== undefined && query.personalized !== '1') throw new BadRequestException('Invalid personalization.');
    if (query.include !== undefined && query.include !== 'coverage') {
      throw new BadRequestException('Unsupported event include');
    }
    if (query.personalized === '1') {
      const followed = await this.follows.list(betaUserId(request));
      void reply.header('cache-control','private, no-store');
      return (await this.publicApi.event(parseUlidParameter(eventId), query.include === 'coverage',followed)).body;
    }
    return sendPublicRead(request, reply, await this.publicApi.event(parseUlidParameter(eventId), query.include === 'coverage'));
  }

  @Get('events/:eventId/positions')
  public async positions(
    @Param('eventId') eventId: string,
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, []);
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.positions(parseUlidParameter(eventId)),
    );
  }

  @Get('events/:eventId/unclustered-assertions')
  public async unclusteredAssertions(
    @Param('eventId') eventId: string,
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, []);
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.unclusteredAssertions(parseUlidParameter(eventId)),
    );
  }

  @Get('events/:eventId/relationships')
  public async relationships(
    @Param('eventId') eventId: string,
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, []);
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.relationships(parseUlidParameter(eventId)),
    );
  }

  @Get('positions/:positionId')
  public async position(
    @Param('positionId') positionId: string,
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, []);
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.position(parseUlidParameter(positionId)),
    );
  }

  @Get('sources/:sourceId')
  public async source(
    @Param('sourceId') sourceId: string,
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    assertExactQueryKeys(query, []);
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.source(parseUlidParameter(sourceId)),
    );
  }
}
