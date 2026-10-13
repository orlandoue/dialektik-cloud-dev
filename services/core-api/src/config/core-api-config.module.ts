import { Global, Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';

import { CORE_API_CONFIG, type CoreApiConfig } from './core-api-config.js';

@Global()
@Module({})
export class CoreApiConfigModule {
  public static register(config: Readonly<CoreApiConfig>): DynamicModule {
    const provider: Provider = {
      provide: CORE_API_CONFIG,
      useValue: config,
    };

    return {
      exports: [CORE_API_CONFIG],
      module: CoreApiConfigModule,
      providers: [provider],
    };
  }
}
