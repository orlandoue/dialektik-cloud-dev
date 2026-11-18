import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { parseUlidParameter } from '../public-api/public-api.validation.js';
import { PublicRateLimitService, rateLimitClient } from '../public-api/public-rate-limit.service.js';
import {
  ScienceService, STUDY_DESIGNS, type ReportReason, type StudyFilter, type StudyScope, type StudyModeration, type StudyRelation,
} from './science.service.js';
import { normalizeDoi } from './study-resolver.js';
import { isStudyTopic } from './study-topics.js';

const FILTERS = new Set<StudyFilter>(['conectados', 'chile', 'temas', 'recientes']);
const RELATIONS = new Set<StudyRelation>(['respalda', 'contradice', 'matiza', 'contexto']);
const REPORT_REASONS = new Set<ReportReason>(['spam', 'ofensivo', 'desinformacion', 'datos_personales', 'otro']);

/** A moderator's reason: required to reject or hide, 2 to 300 characters. */
function reason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 300) {
    throw new BadRequestException('A reason needs 2 to 300 characters.');
  }
  return value.trim();
}
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

@Controller('v1')
@UseGuards(PrivateBetaAuthGuard)
export class ScienceController {
  constructor(@Inject(ScienceService) private readonly science: ScienceService,
    @Inject(PublicRateLimitService) private readonly rateLimit: PublicRateLimitService) {}

  /** The verified reader, once the Science flag is on for them. */
  #reader(request: FastifyRequest): string {
    const userId = betaUserId(request);
    this.science.requireAccess(userId);
    return userId;
  }

  /** Whether the app shows Science and story comments to this reader. */
  @Get('science/access')
  async access(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.access(betaUserId(request));
  }

  @Get('science/studies')
  async studies(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query('filter') filter?: string,
    @Query('topic') topic?: string, @Query('sort') sort?: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    this.#reader(request);
    void reply.header('cache-control', 'private, no-store');
    // Topics (0.1.38+): ?topic=todos|chile|<topic>&sort=recientes|conectados.
    if (topic !== undefined || sort !== undefined) {
      const scope = topic ?? 'todos';
      if (scope !== 'todos' && scope !== 'chile' && !isStudyTopic(scope)) throw new BadRequestException('Unknown topic.');
      const order = sort ?? 'recientes';
      if (order !== 'recientes' && order !== 'conectados') throw new BadRequestException('Unknown sort.');
      return this.science.browseStudies(scope as StudyScope, order);
    }
    const chosen = (filter ?? 'conectados') as StudyFilter;
    if (!FILTERS.has(chosen)) throw new BadRequestException('Unknown filter.');
    return this.science.listStudies(chosen);
  }

  /** C2: a DOI, a link or a title; up to three candidates. */
  @Get('science/lookup')
  async lookup(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query('q') q?: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    if (typeof q !== 'string' || q.trim().length < 3 || q.length > 500) throw new BadRequestException('Write a DOI, a link or a title.');
    void reply.header('cache-control', 'private, no-store');
    return this.science.lookup(this.#reader(request), q);
  }

  /** DOIs contain slashes; the app sends them URL-encoded as one segment. */
  @Get('science/studies/:doi')
  async study(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('doi') doi: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    this.#reader(request);
    void reply.header('cache-control', 'private, no-store');
    return this.science.study(doiParameter(doi));
  }

  @Get('science/studies/:doi/comments')
  async citing(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('doi') doi: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.commentsCitingStudy(this.#reader(request), doiParameter(doi));
  }

  /** «Tus comentarios» in Perfil: the reader's comments and their state. */
  @Get('science/my-comments')
  async myComments(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.myComments(this.#reader(request));
  }

  @Get('stories/:id/comments')
  async comments(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('id') id: string) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.storyComments(this.#reader(request), parseUlidParameter(id));
  }

  @Post('stories/:id/comments')
  async addComment(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid comment.');
    const parentId = input.parent_id === undefined || input.parent_id === null ? null : uuidParameter(input.parent_id, 'Invalid reply.');
    return this.science.addComment(this.#reader(request), parseUlidParameter(id), {
      body: text(input.body, 600, 'A comment needs 1 to 600 characters.'),
      parentId,
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
    return this.science.addStudyComment(this.#reader(request), parseUlidParameter(id), {
      doi,
      claimQuoteId: parseUlidParameter(input.claim_quote_id),
      relation,
      abstractFragment: text(input.abstract_fragment, 1200, message),
      body: text(input.body, 280, 'A comment with a study needs 1 to 280 characters.'),
    });
  }

  @Post('comments/:id/reactions')
  async react(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid reaction.');
    if (typeof input.reacted !== 'boolean') throw new BadRequestException('Invalid reaction.');
    return this.science.react(this.#reader(request), uuidParameter(id, 'Invalid comment.'), input.reacted);
  }

  @Post('comments/:id/reports')
  async report(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid report.');
    const chosen = typeof input.reason === 'string' ? input.reason as ReportReason : undefined;
    if (chosen === undefined || !REPORT_REASONS.has(chosen)) throw new BadRequestException('Invalid report.');
    const note = input.note === undefined || input.note === null ? null : text(input.note, 280, 'A note needs 1 to 280 characters.');
    return this.science.report(this.#reader(request), uuidParameter(id, 'Invalid comment.'), chosen, note);
  }

  // ---- Moderation (DIALEKTIK_SCIENCE_MODERATORS) ---------------------------

  @Get('science/moderation/queue')
  async queue(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.moderationQueue(this.#reader(request));
  }

  /** Calls per metadata API and day, last 30 days. */
  @Get('science/moderation/usage')
  async usage(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.usage(this.#reader(request));
  }

  /** Duels the poll rule separated, last 14 days. */
  @Get('science/moderation/poll-decisions')
  async pollDecisions(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    void reply.header('cache-control', 'private, no-store');
    return this.science.pollDecisions(this.#reader(request));
  }

  @Post('science/moderation/comments/:id')
  async decide(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid decision.');
    if (input.decision !== 'approve' && input.decision !== 'reject') throw new BadRequestException('Invalid decision.');
    return this.science.decide(this.#reader(request), uuidParameter(id, 'Invalid comment.'), input.decision === 'approve',
      reason(input.reason));
  }

  /** Reports of a comment: `dismiss` them, or `hide` the comment with a reason. */
  @Post('science/moderation/reports/:id')
  async resolveReports(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid decision.');
    if (input.decision !== 'dismiss' && input.decision !== 'hide') throw new BadRequestException('Invalid decision.');
    return this.science.resolveReports(this.#reader(request), uuidParameter(id, 'Invalid comment.'), input.decision === 'hide',
      reason(input.reason));
  }

  @Put('science/moderation/studies/:doi')
  async moderateStudy(@Req() request: FastifyRequest, @Param('doi') doi: string, @Body() body: unknown) {
    this.rateLimit.assertAllowed(rateLimitClient(request));
    const input = record(body, 'Invalid study fields.');
    const fields: StudyModeration = {};
    // «Tipo de estudio» is one of a fixed list; «Revisión» one of three.
    if (Object.hasOwn(input, 'design') && input.design !== null
      && !(STUDY_DESIGNS as readonly unknown[]).includes(input.design)) {
      throw new BadRequestException('Invalid design.');
    }
    if (Object.hasOwn(input, 'review')) {
      if (input.review !== 'peer_reviewed' && input.review !== 'preprint' && input.review !== 'not_reported') {
        throw new BadRequestException('Invalid review.');
      }
      fields.review = input.review;
    }
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
    if (Object.hasOwn(input, 'abstract')) {
      // Copied from the published article with its source; never generated.
      const value = input.abstract;
      if (value === null) {
        fields.abstract = null;
      } else {
        const given = record(value, 'Invalid abstract.');
        const language = given.language === undefined || given.language === null ? null : given.language;
        if (language !== null && (typeof language !== 'string' || !/^[a-z]{2,3}$/u.test(language))) {
          throw new BadRequestException('Invalid abstract language.');
        }
        fields.abstract = {
          text: text(given.text, 12000, 'An abstract needs 1 to 12000 characters.'),
          source: text(given.source, 120, 'Name where the abstract was copied from.'),
          language,
        };
      }
    }
    if (Object.hasOwn(input, 'made_in_chile')) {
      if (typeof input.made_in_chile !== 'boolean') throw new BadRequestException('Invalid made_in_chile.');
      fields.made_in_chile = input.made_in_chile;
    }
    return this.science.moderateStudy(this.#reader(request), doiParameter(doi), fields);
  }
}
