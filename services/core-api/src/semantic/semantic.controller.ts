import { Controller, Get, Inject, Param, Query, BadRequestException } from '@nestjs/common';
import { parseUlid } from '@dialektik/database';
import { assertExactQueryKeys, parseUlidParameter } from '../public-api/public-api.validation.js';
import { SemanticApplicationService } from './semantic.service.js';

@Controller()
export class SemanticController {
  constructor(
    @Inject(SemanticApplicationService) private readonly service: SemanticApplicationService,
  ) {}
  @Get('semantic/threads')
  threads(@Query() query: Readonly<Record<string, unknown>>) {
    assertExactQueryKeys(query, ['cursor', 'limit']);
    if (query.cursor !== undefined && typeof query.cursor !== 'string')
      throw new BadRequestException('Invalid cursor.');
    const after = query.cursor === undefined ? undefined : parseUlidParameter(query.cursor);
    if (
      query.limit !== undefined &&
      (typeof query.limit !== 'string' ||
        !/^[1-9]\d?$/.test(query.limit) ||
        Number(query.limit) > 50)
    ) {
      throw new BadRequestException('Invalid page limit.');
    }
    return this.service.listThreads(after, query.limit === undefined ? 50 : Number(query.limit));
  }
  @Get('semantic/threads/:id')
  thread(@Param('id') id: string) {
    return this.service.getThread(parseUlid(parseUlidParameter(id)));
  }
  @Get('semantic/threads/:id/timeline')
  timeline(@Param('id') id: string) {
    return this.service.getTimeline(parseUlid(parseUlidParameter(id)));
  }
  @Get('semantic/threads/:id/sources')
  threadSources(@Param('id') id: string) {
    return this.service.getThreadSources(parseUlid(parseUlidParameter(id)));
  }
  @Get('semantic/occurrences/:id')
  occurrence(@Param('id') id: string) {
    return this.service.getOccurrence(parseUlid(parseUlidParameter(id)));
  }
  @Get('semantic/occurrences/:id/sources')
  occurrenceSources(@Param('id') id: string) {
    return this.service.getOccurrenceSources(parseUlid(parseUlidParameter(id)));
  }
  @Get('articles/:id/semantic-context')
  context(@Param('id') id: string) {
    return this.service.getArticleContext(parseUlid(parseUlidParameter(id)));
  }
  @Get('semantic/articles/:id')
  article(@Param('id') id: string) {
    return this.service.getArticle(parseUlid(parseUlidParameter(id)));
  }
  @Get('semantic/provenance/:id')
  provenance(@Param('id') id: string) {
    return this.service.getProvenance(parseUlid(parseUlidParameter(id)));
  }
}
