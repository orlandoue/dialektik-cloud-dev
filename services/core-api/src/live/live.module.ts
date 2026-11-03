import { Module, type DynamicModule } from '@nestjs/common';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CORE_API_CONFIG } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { PrivateBetaAuthModule } from '../private-beta/private-beta-auth.module.js';
import { PrivateBetaLiveController } from './private-beta-live.controller.js';
import { LiveController } from './live.controller.js';
import { LiveRepository } from './live.repository.js';
import { LiveApplicationService } from './live.service.js';
import { assertLiveDatabase } from './live.sync.js';
import { CorporateLiveAcquisitionService } from './corporate-live-acquisition.service.js';
import { CorporateLiveAcquisitionController } from './corporate-live-acquisition.controller.js';
import { CorporateLiveAcquisitionDatabaseService } from './corporate-live-acquisition-database.service.js';
import { FollowedSourcesService } from '../public-api/followed-sources.service.js';

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
            provide: CorporateLiveAcquisitionDatabaseService,
            inject: [CORE_API_CONFIG],
            useFactory: (apiConfig: Readonly<CoreApiConfig>) =>
              new CorporateLiveAcquisitionDatabaseService(apiConfig),
          }, {
            provide: CorporateLiveAcquisitionService,
            inject: [CorporateLiveAcquisitionDatabaseService],
            useFactory: (database: CorporateLiveAcquisitionDatabaseService) =>
              new CorporateLiveAcquisitionService(config, database),
          }]
        : [];
      return {
        module: LiveModule,
        imports: [PrivateBetaAuthModule],
        controllers: [
          PrivateBetaLiveController,
          ...(config.ownershipMode === 'corporate' ? [CorporateLiveAcquisitionController] : []),
        ],
        providers: [...providers, FollowedSourcesService, ...corporateAcquisitionProviders],
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
