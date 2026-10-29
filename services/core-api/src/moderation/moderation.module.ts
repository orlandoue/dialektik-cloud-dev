import { Module } from '@nestjs/common';

import { ModerationAuthService } from './moderation-auth.service.js';
import { ModerationController } from './moderation.controller.js';
import { ModerationDatabaseService } from './moderation-database.service.js';
import { ModerationSessionController } from './moderation-session.controller.js';
import { ModerationWorkflowService } from './moderation-workflow.service.js';
import { PrivateBetaAuthModule } from '../private-beta/private-beta-auth.module.js';
import { HeadlineReviewController } from './headline-review.controller.js';
import { HeadlineReviewService } from './headline-review.service.js';
import { HeadlineAnalysisService } from '../semantic/headline-analysis.service.js';
import { HeadlineSemanticDatabaseService } from '../semantic/headline-semantic-database.service.js';
import { HeadlineContextController } from './headline-context.controller.js';
import { HeadlineContextAnalysisService } from '../semantic/headline-context-analysis.service.js';

@Module({
  imports: [PrivateBetaAuthModule],
  controllers: [
    ModerationController,
    ModerationSessionController,
    HeadlineReviewController,
    HeadlineContextController,
  ],
  providers: [
    ModerationAuthService,
    ModerationDatabaseService,
    ModerationWorkflowService,
    HeadlineReviewService,
    HeadlineAnalysisService,
    HeadlineSemanticDatabaseService,
    HeadlineContextAnalysisService,
  ],
})
export class ModerationModule {}
