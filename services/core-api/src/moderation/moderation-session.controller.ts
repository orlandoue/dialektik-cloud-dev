import { Controller, Get, Headers, Inject } from '@nestjs/common';

import { ModerationWorkflowService } from './moderation-workflow.service.js';

@Controller('v1/mod/session')
export class ModerationSessionController {
  public constructor(
    @Inject(ModerationWorkflowService) private readonly workflow: ModerationWorkflowService,
  ) {}

  @Get()
  public current(@Headers('authorization') authorization: string | undefined) {
    return this.workflow.session(authorization);
  }
}
