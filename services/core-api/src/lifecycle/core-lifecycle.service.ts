import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';

@Injectable()
export class CoreLifecycleService implements OnApplicationShutdown {
  public constructor(
    @Inject(CORE_API_CONFIG)
    private readonly config: Readonly<CoreApiConfig>,
  ) {}

  public onApplicationShutdown(signal?: string): void {
    if (this.config.logLevel === 'silent') {
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        event: 'core_api_stopping',
        level: 'info',
        signal: signal ?? 'application_close',
      })}\n`,
    );
  }
}
