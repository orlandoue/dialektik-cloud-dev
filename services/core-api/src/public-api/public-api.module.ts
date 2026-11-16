import { Module } from '@nestjs/common';

import { PublicApiController } from './public-api.controller.js';
import { PublicApiRepository } from './public-api.repository.js';
import { PublicApiService } from './public-api.service.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';
import { PrivateBetaAuthModule } from '../private-beta/private-beta-auth.module.js';

@Module({
  imports: [PrivateBetaAuthModule],
  controllers: [PublicApiController],
  providers: [PublicApiRepository, PublicApiService, PublicRateLimitService],
})
export class PublicApiModule {}
