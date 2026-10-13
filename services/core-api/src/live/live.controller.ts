import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { parseUlid } from '@dialektik/database';
import { assertExactQueryKeys, parseUlidParameter } from '../public-api/public-api.validation.js';
import { LiveApplicationService } from './live.service.js';
import { parseLiveTimestamp } from './live.adapter.js';

function queryDate(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new BadRequestException('Invalid UTC timestamp.');
  const parsed = parseLiveTimestamp(value);
  if (parsed === null) throw new BadRequestException('Invalid UTC timestamp.');
  return parsed;
}

@Controller('live')
export class LiveController {
  constructor(@Inject(LiveApplicationService) private readonly service: LiveApplicationService) {}
  @Get('news')
  news(@Query() query: Readonly<Record<string, unknown>>) {
    assertExactQueryKeys(query, [
      'cursor',
      'limit',
      'q',
      'source_id',
      'published_from',
      'published_to',
    ]);
    if (
      query.limit !== undefined &&
      (typeof query.limit !== 'string' ||
        !/^[1-9]\d?$/.test(query.limit) ||
        Number(query.limit) > 50)
    ) {
      throw new BadRequestException('Invalid page limit.');
    }
    if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 200))
      throw new BadRequestException('Invalid metadata search.');
    if (
      (query.cursor !== undefined && typeof query.cursor !== 'string') ||
      (query.source_id !== undefined && typeof query.source_id !== 'string')
    )
      throw new BadRequestException('Invalid identity filter.');
    const publishedFrom = queryDate(query.published_from);
    const publishedTo = queryDate(query.published_to);
    if (publishedFrom !== undefined && publishedTo !== undefined && publishedFrom >= publishedTo)
      throw new BadRequestException('Invalid date interval.');
    return this.service.list({
      limit: query.limit === undefined ? 25 : Number(query.limit),
      ...(query.cursor === undefined
        ? {}
        : { cursor: parseUlid(parseUlidParameter(query.cursor)) }),
      ...(query.source_id === undefined
        ? {}
        : { sourceId: parseUlid(parseUlidParameter(query.source_id)) }),
      ...(query.q === undefined ? {} : { q: query.q.trim() }),
      ...(publishedFrom === undefined ? {} : { publishedFrom }),
      ...(publishedTo === undefined ? {} : { publishedTo }),
    });
  }
  @Get('news/:id') article(@Param('id') id: string) {
    return this.service.article(parseUlid(parseUlidParameter(id)));
  }
  @Get('news/:id/provenance') provenance(@Param('id') id: string) {
    return this.service.provenance(parseUlid(parseUlidParameter(id)));
  }
  @Get('sources') sources() {
    return this.service.sources();
  }
  @Get('sources/:id') source(@Param('id') id: string) {
    return this.service.source(parseUlid(parseUlidParameter(id)));
  }
}
