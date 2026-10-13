import { Module, type DynamicModule } from '@nestjs/common';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { LiveController } from './live.controller.js';
import { LiveRepository } from './live.repository.js';
import { LiveApplicationService } from './live.service.js';
import { assertLiveDatabase } from './live.sync.js';

@Module({})
export class LiveModule {
  static register(config: Readonly<CoreApiConfig>): DynamicModule {
    if (config.nodeEnvironment === 'production' || config.semanticMode !== 'unassigned')
      return { module: LiveModule };
    assertLiveDatabase(config);
    return {
      module: LiveModule,
      controllers: [LiveController],
      providers: [
        {
          provide: LiveRepository,
          inject: [CoreDatabaseService],
          useFactory: (database: CoreDatabaseService) => new LiveRepository(database.database),
        },
        LiveApplicationService,
      ],
    };
  }
}
