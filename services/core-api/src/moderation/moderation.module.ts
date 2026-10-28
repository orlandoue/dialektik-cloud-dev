import { Module } from '@nestjs/common';

import { ModerationAuthService } from './moderation-auth.service.js';
import { ModerationController } from './moderation.controller.js';
import { ModerationDatabaseService } from './moderation-database.service.js';
import { ModerationWorkflowService } from './moderation-workflow.service.js';
import { PrivateBetaAuthModule } from '../private-beta/private-beta-auth.module.js';

@Module({
  imports: [PrivateBetaAuthModule],
  controllers: [ModerationController],
  providers: [ModerationAuthService, ModerationDatabaseService, ModerationWorkflowService],
})
export class ModerationModule {}
