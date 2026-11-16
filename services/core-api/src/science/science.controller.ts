import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { parseUlidParameter } from '../public-api/public-api.validation.js';
import { PublicRateLimitService, rateLimitClient } from '../public-api/public-rate-limit.service.js';
import { ScienceService, type StudyFilter, type StudyModeration, type StudyRelation } from './science.service.js';
import { normalizeDoi } from './study-resolver.js';

const FILTERS = new Set<StudyFilter>(['conectados', 'chile', 'temas', 'recientes']);
const RELATIONS = new Set<StudyRelation>(['respalda', 'contradice', 'matiza', 'contexto']);
const ALIAS = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,29}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(body: unknown, message: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException(message);
  return body as Record<string, unknown>;
}

function doiParameter(value: string): string {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { throw new BadRequestException('Invalid DOI.'); }
  const doi = normalizeDoi(decoded);
  if (doi === null) throw new BadRequestException('Invalid DOI.');
  return doi;
}

function uuidParameter(value: unknown, message: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException(message);
  return value.toLowerCase();
}

function text(value: unknown, max: number, message: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) throw new BadRequestException(message);
  return value.trim();
}

function alias(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !ALIAS.test(value.trim())) throw new BadRequestException('Invalid alias.');
  return value.trim();
}

@Controller('v1')
@UseGuards(PrivateBetaAuthGuard)
export class ScienceController {
  constructor(@Inject(ScienceService) private readonly science: ScienceService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService) {}

  @Get('science/studies')
  async studies(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query('filter') filter?: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    betaUserId(request);
    const chosen = (filter ?? 'conectados') as StudyFilter;
    if (!FILTERS.has(chosen)) throw new BadRequestException('Unknown filter.');
    void reply.header('cache-control', 'private, no-store');
    return this.science.listStudies(chosen);
  }

  /** DOIs contain slashes; the app sends them URL-encoded as one segment. */
  @Get('science/studies/:doi')
  async study(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('doi') doi: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    betaUserId(request);
    void reply.header('cache-control', 'private, no-store');
    return this.science.study(doiParameter(doi));
  }

  @Get('science/studies/:doi/comments')
  async citing(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('doi') doi: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.commentsCitingStudy(betaUserId(request), doiParameter(doi));
  }

  @Get('stories/:id/comments')
  async comments(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('id') id: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.storyComments(betaUserId(request), parseUlidParameter(id));
  }

  @Post('stories/:id/comments')
  async addComment(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid comment.');
    const parentId = input.parent_id === undefined || input.parent_id === null ? null : uuidParameter(input.parent_id, 'Invalid reply.');
    return this.science.addComment(betaUserId(request), parseUlidParameter(id), {
      body: text(input.body, 600, 'A comment needs 1 to 600 characters.'),
      parentId,
      alias: alias(input.alias),
    });
  }

  @Post('stories/:id/study-comments')
  async addStudyComment(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const message = 'A DOI, a claim, a relation, a literal fragment and a comment are required.';
    const input = record(body, message);
    const doi = typeof input.doi === 'string' ? normalizeDoi(input.doi) : null;
    const relation = typeof input.relation === 'string' ? input.relation as StudyRelation : undefined;
    if (doi === null || typeof input.claim_quote_id !== 'string' || relation === undefined || !RELATIONS.has(relation)) {
      throw new BadRequestException(message);
    }
    return this.science.addStudyComment(betaUserId(request), parseUlidParameter(id), {
      doi,
      claimQuoteId: parseUlidParameter(input.claim_quote_id),
      relation,
      abstractFragment: text(input.abstract_fragment, 1200, message),
      body: text(input.body, 280, 'A comment with a study needs 1 to 280 characters.'),
      alias: alias(input.alias),
    });
  }

  @Post('comments/:id/reactions')
  async react(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid reaction.');
    if (typeof input.reacted !== 'boolean') throw new BadRequestException('Invalid reaction.');
    return this.science.react(betaUserId(request), uuidParameter(id, 'Invalid comment.'), input.reacted);
  }

  // ---- Moderation (DIALEKTIK_SCIENCE_MODERATORS) ---------------------------

  @Get('science/moderation/queue')
  async queue(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.moderationQueue(betaUserId(request));
  }

  @Post('science/moderation/comments/:id')
  async decide(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid decision.');
    if (input.decision !== 'approve' && input.decision !== 'reject') throw new BadRequestException('Invalid decision.');
    return this.science.decide(betaUserId(request), uuidParameter(id, 'Invalid comment.'), input.decision === 'approve');
  }

  @Put('science/moderation/studies/:doi')
  async moderateStudy(@Req() request: FastifyRequest, @Param('doi') doi: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid study fields.');
    const fields: StudyModeration = {};
    for (const key of ['design', 'population', 'follow_up', 'funding', 'conflicts', 'access', 'corrections'] as const) {
      if (!Object.hasOwn(input, key)) continue;
      const value = input[key];
      if (value !== null && (typeof value !== 'string' || value.trim() === '' || value.length > 300)) {
        throw new BadRequestException(`Invalid ${key}.`);
      }
      fields[key] = value === null ? null : value.trim();
    }
    if (Object.hasOwn(input, 'sample_size')) {
      const value = input.sample_size;
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)) {
        throw new BadRequestException('Invalid sample_size.');
      }
      fields.sample_size = value;
    }
    if (Object.hasOwn(input, 'made_in_chile')) {
      if (typeof input.made_in_chile !== 'boolean') throw new BadRequestException('Invalid made_in_chile.');
      fields.made_in_chile = input.made_in_chile;
    }
    return this.science.moderateStudy(betaUserId(request), doiParameter(doi), fields);
  }
}
