import { Module, type DynamicModule } from '@nestjs/common';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { assertLiveDatabase } from '../live/live.sync.js';
import { ShadowPreflightController } from './shadow.controller.js';
import { ShadowPreflightRepository } from './shadow.repository.js';
import { ShadowPreflightService } from './shadow.service.js';

@Module({})
export class ShadowPreflightModule {
  static register(config: Readonly<CoreApiConfig>): DynamicModule {
    if (config.nodeEnvironment === 'production' || config.semanticMode !== 'unassigned')
      return { module: ShadowPreflightModule };
    assertLiveDatabase(config);
    return {
      module: ShadowPreflightModule,
      controllers: [ShadowPreflightController],
      providers: [
        {
          provide: ShadowPreflightRepository,
          inject: [CoreDatabaseService],
          useFactory: (database: CoreDatabaseService) =>
            new ShadowPreflightRepository(database.database),
        },
        ShadowPreflightService,
      ],
    };
  }
}
