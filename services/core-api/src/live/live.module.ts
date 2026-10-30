import { Module, type DynamicModule } from '@nestjs/common';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { PrivateBetaAuthModule } from '../private-beta/private-beta-auth.module.js';
import { PrivateBetaLiveController } from './private-beta-live.controller.js';
import { LiveController } from './live.controller.js';
import { LiveRepository } from './live.repository.js';
import { LiveApplicationService } from './live.service.js';
import { assertLiveDatabase } from './live.sync.js';
import { CorporateLiveAcquisitionService } from './corporate-live-acquisition.service.js';

@Module({})
export class LiveModule {
  static register(config: Readonly<CoreApiConfig>): DynamicModule {
    const providers = [
      {
        provide: LiveRepository,
        inject: [CoreDatabaseService],
        useFactory: (database: CoreDatabaseService) => new LiveRepository(database.database),
      },
      LiveApplicationService,
    ];

    if (config.nodeEnvironment === 'production') {
      if (config.semanticMode !== 'disabled') return { module: LiveModule };
      const corporateAcquisitionProviders = config.ownershipMode === 'corporate'
        ? [{
            provide: CorporateLiveAcquisitionService,
            inject: [CoreDatabaseService],
            useFactory: (database: CoreDatabaseService) =>
              new CorporateLiveAcquisitionService(config, database),
          }]
        : [];
      return {
        module: LiveModule,
        imports: [PrivateBetaAuthModule],
        controllers: [PrivateBetaLiveController],
        providers: [...providers, ...corporateAcquisitionProviders],
      };
    }

    if (config.semanticMode !== 'unassigned') return { module: LiveModule };
    assertLiveDatabase(config);
    return {
      module: LiveModule,
      controllers: [LiveController],
      providers,
    };
  }
}
