import { Inject, Injectable } from '@nestjs/common';

import { CoreDatabaseService } from '../database/core-database.service.js';

export interface LivenessResult {
  readonly status: 'live';
}

export interface ReadinessResult {
  readonly status: 'not_ready' | 'ready';
}

@Injectable()
export class HealthService {
  public constructor(
    @Inject(CoreDatabaseService)
    private readonly database: CoreDatabaseService,
  ) {}

  public liveness(): LivenessResult {
    return { status: 'live' };
  }

  public async readiness(): Promise<ReadinessResult> {
    return (await this.database.isReady()) ? { status: 'ready' } : { status: 'not_ready' };
  }
}
