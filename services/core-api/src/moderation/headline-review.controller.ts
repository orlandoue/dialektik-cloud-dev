import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { HeadlineReviewService } from './headline-review.service.js';
import { HeadlineAnalysisService } from '../semantic/headline-analysis.service.js';

@Controller('v1/mod/headline-reviews')
export class HeadlineReviewController {
  constructor(
    @Inject(HeadlineReviewService)
    private readonly service: HeadlineReviewService,
    @Inject(HeadlineAnalysisService)
    private readonly analysis: HeadlineAnalysisService,
  ) {}

  @Get() list(@Headers('authorization') authorization: string | undefined) {
    return this.service.list(authorization);
  }

  @Get('sources') sources(@Headers('authorization') authorization: string | undefined) {
    return this.service.sources(authorization);
  }

  @Post('sources/:sourceId/grant') grant(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('sourceId') sourceId: string,
    @Body() body: unknown,
  ) {
    return this.service.setSourceGrant(authorization, sourceId, commandId, body);
  }

  @Post('analyze') analyze(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.analysis.analyzeNext(authorization, body);
  }

  @Post(':attemptId/decision') decide(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
  ) {
    return this.service.decide(authorization, attemptId, commandId, body);
  }
}
