import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { HealthService, type LivenessResult, type ReadinessResult } from './health.service.js';
import { LiveSemanticProductionService } from '../semantic/live-semantic-production.service.js';
import { PipelineStatusService, type PipelineStatus } from './pipeline-status.service.js';
import { QueryLatencyService, type QueryLatencyReport } from './query-latency.service.js';

@Controller('health')
export class HealthController {
  public constructor(@Inject(HealthService) private readonly health: HealthService,
    @Optional() @Inject(LiveSemanticProductionService) private readonly semantic?: LiveSemanticProductionService,
    @Optional() @Inject(PipelineStatusService) private readonly pipeline?: PipelineStatusService,
    @Optional() @Inject(QueryLatencyService) private readonly latency?: QueryLatencyService) {}

  /** Public timings of the reads the app makes when it opens (no content). */
  @Get('query-latency')
  public async queryLatency(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<QueryLatencyReport | { readonly status: 'unavailable' }> {
    void reply.header('cache-control', 'no-store');
    if (!this.latency) {
      void reply.code(503);
      return { status: 'unavailable' };
    }
    return this.latency.report();
  }

  @Get('live')
  public liveness(): LivenessResult {
    // A liveness ping never starts semantic work: on the free instance an
    // engine run slows every app read for minutes. The engine keeps its own
    // 5-minute scheduler.
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
