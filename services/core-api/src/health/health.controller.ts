import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { HealthService, type LivenessResult, type ReadinessResult } from './health.service.js';
import { LiveSemanticProductionService } from '../semantic/live-semantic-production.service.js';
import { PipelineStatusService, type PipelineStatus } from './pipeline-status.service.js';

@Controller('health')
export class HealthController {
  public constructor(@Inject(HealthService) private readonly health: HealthService,
    @Optional() @Inject(LiveSemanticProductionService) private readonly semantic?: LiveSemanticProductionService,
    @Optional() @Inject(PipelineStatusService) private readonly pipeline?: PipelineStatusService) {}

  @Get('live')
  public liveness(): LivenessResult {
    this.semantic?.wakeFromHealthPing();
    return this.health.liveness();
  }

  /** Public read-only view of what the news pipeline last did. */
  @Get('pipeline-status')
  public async pipelineStatus(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PipelineStatus | { readonly status: 'unavailable' }> {
    void reply.header('cache-control', 'no-store');
    if (!this.pipeline) {
      void reply.code(503);
      return { status: 'unavailable' };
    }
    return this.pipeline.status();
  }

  @Get('ready')
  public async readiness(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadinessResult> {
    const result = await this.health.readiness();
    if (result.status === 'not_ready') {
      void reply.code(503);
    }
    return result;
  }
}
