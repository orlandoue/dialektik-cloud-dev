import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post } from '@nestjs/common';

import { ModerationWorkflowService } from './moderation-workflow.service.js';

@Controller('v1/mod/tasks')
export class ModerationController {
  public constructor(
    @Inject(ModerationWorkflowService)
    private readonly workflow: ModerationWorkflowService,
  ) {}

  @Get()
  public list(@Headers('authorization') authorization: string | undefined) {
    return this.workflow.list(authorization);
  }

  @Get(':taskId')
  public find(
    @Headers('authorization') authorization: string | undefined,
    @Param('taskId') taskId: string,
  ) {
    return this.workflow.find(authorization, taskId);
  }

  @Post(':taskId/claim')
  @HttpCode(200)
  public claim(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.claim(authorization, taskId, commandId, body);
  }

  @Post(':taskId/release')
  @HttpCode(200)
  public release(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.release(authorization, taskId, commandId, body);
  }

  @Post(':taskId/reassign')
  @HttpCode(200)
  public reassign(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.reassign(authorization, taskId, commandId, body);
  }

  @Post(':taskId/escalate')
  @HttpCode(200)
  public escalate(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.escalate(authorization, taskId, commandId, body);
  }

  @Post(':taskId/proposals')
  public submitProposal(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.submitProposal(authorization, taskId, commandId, body);
  }

  @Post(':taskId/proposals/:proposalId/confirm')
  @HttpCode(200)
  public confirm(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('taskId') taskId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.confirm(authorization, taskId, proposalId, commandId, body);
  }

  @Post(':taskId/proposals/:proposalId/refuse')
  @HttpCode(200)
  public refuse(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') commandId: string | undefined,
    @Param('taskId') taskId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.refuse(authorization, taskId, proposalId, commandId, body);
  }
}
