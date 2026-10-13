import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { parseUlid } from '@dialektik/database';
import { assertExactQueryKeys, parseUlidParameter } from '../public-api/public-api.validation.js';
import { PersonalOwnerGuard } from './personal-owner.auth.js';
import { PersonalOwnerOperationalService } from './personal-owner-operational.service.js';
import { PersonalOwnerService } from './personal-owner.service.js';

@Controller('personal/owner')
@UseGuards(PersonalOwnerGuard)
export class PersonalOwnerController {
  constructor(
    private readonly service: PersonalOwnerService,
    private readonly operational: PersonalOwnerOperationalService,
  ) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status() {
    return this.service.status();
  }

  @Get('sources')
  @Header('Cache-Control', 'no-store')
  sources() {
    return this.operational.sources();
  }

  @Post('sources')
  @Header('Cache-Control', 'no-store')
  registerSource(@Body() body: unknown) {
    return this.operational.registerSource(body);
  }

  @Post('sources/:id/rights-decisions')
  @Header('Cache-Control', 'no-store')
  rightsDecision(@Param('id') id: string, @Body() body: unknown) {
    return this.operational.recordRightsDecision(parseUlid(parseUlidParameter(id)), body);
  }

  @Put('sources/:id/connection')
  @Header('Cache-Control', 'no-store')
  sourceConnection(@Param('id') id: string, @Body() body: unknown) {
    return this.operational.recordSourceConnection(parseUlid(parseUlidParameter(id)), body);
  }

  @Post('sources/:id/acquire')
  @Header('Cache-Control', 'no-store')
  acquireSource(@Param('id') id: string) {
    return this.operational.acquireSource(parseUlid(parseUlidParameter(id)));
  }

  @Get('articles')
  @Header('Cache-Control', 'no-store')
  articles(@Query() query: Readonly<Record<string, unknown>>) {
    assertExactQueryKeys(query, ['source_id']);
    if (query.source_id !== undefined && typeof query.source_id !== 'string')
      throw new BadRequestException('INVALID_SOURCE_ID');
    return this.operational.articles(
      query.source_id === undefined ? undefined : parseUlid(parseUlidParameter(query.source_id)),
    );
  }

  @Get('official-votes')
  @Header('Cache-Control', 'no-store')
  officialVotes(@Query() query: Readonly<Record<string, unknown>>) {
    assertExactQueryKeys(query, ['source_id']);
    if (query.source_id !== undefined && typeof query.source_id !== 'string')
      throw new BadRequestException('INVALID_SOURCE_ID');
    return this.operational.officialVoteEvents(
      query.source_id === undefined ? undefined : parseUlid(parseUlidParameter(query.source_id)),
    );
  }

  @Post('sources/:id/official-votes/:voteId/acquire')
  @Header('Cache-Control', 'no-store')
  acquireOfficialVote(@Param('id') id: string, @Param('voteId') voteId: string) {
    return this.operational.acquireOfficialVoteEvent(parseUlid(parseUlidParameter(id)), voteId);
  }

  @Get('budget')
  @Header('Cache-Control', 'no-store')
  budget() {
    return this.operational.budget();
  }

  @Put('budget')
  @Header('Cache-Control', 'no-store')
  configureBudget(@Body() body: unknown) {
    return this.operational.configureBudget(body);
  }

  @Post('budget/emergency-stop')
  @Header('Cache-Control', 'no-store')
  emergencyStop() {
    return this.operational.emergencyStop();
  }

  @Post('provider/model-prices')
  @Header('Cache-Control', 'no-store')
  recordModelPrice(@Body() body: unknown) {
    return this.operational.recordModelPrice(body);
  }

  @Post('provider/authorizations')
  @Header('Cache-Control', 'no-store')
  recordProviderAuthorization(@Body() body: unknown) {
    return this.operational.recordProviderAuthorization(body);
  }

  @Post('articles/:id/jobs')
  @Header('Cache-Control', 'no-store')
  submitJob(@Param('id') id: string, @Body() body: unknown) {
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('INVALID_JOB_REQUEST');
    const request = body as Record<string, unknown>;
    const versionId = request.article_version_id;
    const idempotencyKey = request.idempotency_key;
    if (typeof versionId !== 'string' || typeof idempotencyKey !== 'string')
      throw new BadRequestException('INVALID_JOB_REQUEST');
    return this.operational.submitJob(
      parseUlid(parseUlidParameter(id)),
      parseUlid(parseUlidParameter(versionId)),
      idempotencyKey,
    );
  }

  @Get('jobs')
  @Header('Cache-Control', 'no-store')
  jobs() {
    return this.operational.jobs();
  }

  @Get('jobs/:id')
  @Header('Cache-Control', 'no-store')
  job(@Param('id') id: string) {
    return this.operational.job(parseUlid(parseUlidParameter(id)));
  }

  @Delete('jobs/:id')
  @Header('Cache-Control', 'no-store')
  cancelJob(@Param('id') id: string) {
    return this.operational.cancelJob(parseUlid(parseUlidParameter(id)));
  }

  @Post('jobs/:id/reconciliation')
  @Header('Cache-Control', 'no-store')
  reconcileJob(@Param('id') id: string, @Body() body: unknown) {
    return this.operational.reconcileJob(parseUlid(parseUlidParameter(id)), body);
  }
}
