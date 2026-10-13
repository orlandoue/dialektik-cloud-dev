import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

import { CORE_API_CONFIG } from '../config/core-api-config.js';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseModule } from '../database/core-database.module.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import {
  PrivateBetaAuthGuard,
  PrivateBetaAuthorizationService,
} from './private-beta-auth.guard.js';
import { PrivateBetaTesterRepository } from './private-beta-tester.repository.js';
import { SupabaseJwtVerifier } from './supabase-jwt-verifier.js';

const providers: Provider[] = [
  {
    provide: SupabaseJwtVerifier,
    inject: [CORE_API_CONFIG],
    useFactory: (config: Readonly<CoreApiConfig>) =>
      new SupabaseJwtVerifier(config.supabaseAuthIssuer),
  },
  PrivateBetaTesterRepository,
  {
    provide: PrivateBetaAuthorizationService,
    inject: [SupabaseJwtVerifier, PrivateBetaTesterRepository],
    useFactory: (
      verifier: SupabaseJwtVerifier,
      testers: PrivateBetaTesterRepository,
    ) => new PrivateBetaAuthorizationService(verifier, testers),
  },
  PrivateBetaAuthGuard,
];

@Module({
  exports: [PrivateBetaAuthGuard],
  imports: [CoreDatabaseModule],
  providers,
})
export class PrivateBetaAuthModule {}
