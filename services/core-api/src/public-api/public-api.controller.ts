import { BadRequestException, Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { sendPublicRead } from './public-api.cache.js';
import { PUBLIC_OPENAPI_DOCUMENT } from './public-api.openapi.js';
import { PublicApiService } from './public-api.service.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';
import { PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
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
  ) {}

  @Get('openapi.json')
  public openApi(
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(request.ip);
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
    this.rateLimit.assertAllowed(request.ip);
    assertExactQueryKeys(query, ['category', 'topic', 'cursor', 'limit']);
    const category = parseOptionalFilter(query.category);
    const topic = parseOptionalFilter(query.topic);
    const page = parsePageRequest(query, 'feed', { category, topic });
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.feed({
        ...(category === undefined ? {} : { category }),
        ...(topic === undefined ? {} : { topic }),
        page,
      }),
    );
  }

  @Get('contradictions')
  public async contradictions(
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(request.ip);
    assertExactQueryKeys(query, ['cursor', 'limit']);
    const page = parsePageRequest(query, 'contradictions', {});
    return sendPublicRead(request, reply, await this.publicApi.contradictions(page));
  }

  @Get('events/:eventId')
  public async event(
    @Param('eventId') eventId: string,
    @Query() query: PublicQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimit.assertAllowed(request.ip);
    assertExactQueryKeys(query, ['include']);
    if (query.include !== undefined && query.include !== 'coverage') {
      throw new BadRequestException('Unsupported event include');
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
    this.rateLimit.assertAllowed(request.ip);
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
    this.rateLimit.assertAllowed(request.ip);
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
    this.rateLimit.assertAllowed(request.ip);
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
    this.rateLimit.assertAllowed(request.ip);
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
    this.rateLimit.assertAllowed(request.ip);
    assertExactQueryKeys(query, []);
    return sendPublicRead(
      request,
      reply,
      await this.publicApi.source(parseUlidParameter(sourceId)),
    );
  }
}
