import { Module } from '@nestjs/common';

import { ModerationAuthService } from './moderation-auth.service.js';
import { ModerationController } from './moderation.controller.js';
import { ModerationWorkflowService } from './moderation-workflow.service.js';

@Module({
  controllers: [ModerationController],
  providers: [ModerationAuthService, ModerationWorkflowService],
})
export class ModerationModule {}
