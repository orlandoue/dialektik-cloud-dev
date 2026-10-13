import { Module, type DynamicModule } from '@nestjs/common';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { SemanticController } from './semantic.controller.js';
import { SemanticRepository } from './semantic.repository.js';
import { SemanticApplicationService } from './semantic.service.js';

@Module({})
export class SemanticModule {
  static register(config: Readonly<CoreApiConfig>): DynamicModule {
    if (config.nodeEnvironment === 'production' || config.semanticMode !== 'fixture') {
      return { module: SemanticModule };
    }
    return {
      module: SemanticModule,
      controllers: [SemanticController],
      providers: [
        {
          provide: SemanticRepository,
          inject: [CoreDatabaseService],
          useFactory: (database: CoreDatabaseService) => new SemanticRepository(database.database),
        },
        SemanticApplicationService,
      ],
    };
  }
}
