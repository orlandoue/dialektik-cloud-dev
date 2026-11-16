import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { CoreApiConfigModule } from './config/core-api-config.module.js';
import type { CoreApiConfig } from './config/core-api-config.js';
import { CoreDatabaseModule } from './database/core-database.module.js';
import { HealthModule } from './health/health.module.js';
import { CoreLifecycleService } from './lifecycle/core-lifecycle.service.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { PublicApiModule } from './public-api/public-api.module.js';
import { SemanticModule } from './semantic/semantic.module.js';
import { LiveModule } from './live/live.module.js';
import { ShadowPreflightModule } from './semantic-shadow/shadow.module.js';
import { EphemeralInspectorModule } from './ephemeral/ephemeral.inspector.js';
import { PersonalOwnerModule } from './personal-owner/personal-owner.module.js';

@Module({})
export class AppModule {
  public static register(config: Readonly<CoreApiConfig>): DynamicModule {
    return {
      imports: [
        CoreApiConfigModule.register(config),
        CoreDatabaseModule,
        HealthModule,
        ModerationModule,
        PublicApiModule,
        SemanticModule.register(config),
        LiveModule.register(config),
        ShadowPreflightModule.register(config),
        EphemeralInspectorModule.register(config),
        PersonalOwnerModule.register(config),
      ],
      module: AppModule,
      providers: [CoreLifecycleService],
    };
  }
}
