import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { HeadlineReviewService } from './headline-review.service.js';
import { HeadlineContextAnalysisService } from '../semantic/headline-context-analysis.service.js';

@Controller('v1/mod/headline-context-pairs')
export class HeadlineContextController {
  constructor(
    @Inject(HeadlineReviewService) private readonly reviews: HeadlineReviewService,
    @Inject(HeadlineContextAnalysisService)
    private readonly analysis: HeadlineContextAnalysisService,
  ) {}

  @Get() list(@Headers('authorization') authorization: string | undefined) {
    return this.reviews.listContextPairs(authorization);
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
    return this.reviews.decideContextPair(authorization, attemptId, commandId, body);
  }
}
