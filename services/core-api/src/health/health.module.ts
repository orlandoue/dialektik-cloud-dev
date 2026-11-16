import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { PipelineStatusService } from './pipeline-status.service.js';
import { QueryLatencyService } from './query-latency.service.js';
import { ModerationModule } from '../moderation/moderation.module.js';

@Module({
  imports: [ModerationModule],
  controllers: [HealthController],
  providers: [HealthService, PipelineStatusService, QueryLatencyService],
})
export class HealthModule {}
