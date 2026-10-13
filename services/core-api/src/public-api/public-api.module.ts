import { Module } from '@nestjs/common';

import { PublicApiController } from './public-api.controller.js';
import { PublicApiRepository } from './public-api.repository.js';
import { PublicApiService } from './public-api.service.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';

@Module({
  controllers: [PublicApiController],
  providers: [PublicApiRepository, PublicApiService, PublicRateLimitService],
})
export class PublicApiModule {}
