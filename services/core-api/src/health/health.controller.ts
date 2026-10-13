import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { HealthService, type LivenessResult, type ReadinessResult } from './health.service.js';

@Controller('health')
export class HealthController {
  public constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  public liveness(): LivenessResult {
    return this.health.liveness();
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
