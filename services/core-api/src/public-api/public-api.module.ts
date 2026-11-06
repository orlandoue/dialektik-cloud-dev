import { Module } from '@nestjs/common';

import { FollowedSourcesController } from './followed-sources.controller.js';
import { FollowedSourcesService } from './followed-sources.service.js';
import { PublicApiController } from './public-api.controller.js';
import { PublicApiRepository } from './public-api.repository.js';
import { PublicApiService } from './public-api.service.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';
import { PrivateBetaAuthModule } from '../private-beta/private-beta-auth.module.js';
import { SocialController } from './social.controller.js';
import { SocialService } from './social.service.js';

@Module({
  imports: [PrivateBetaAuthModule],
  controllers: [FollowedSourcesController, PublicApiController, SocialController],
  providers: [PublicApiRepository, PublicApiService, PublicRateLimitService, FollowedSourcesService, SocialService],
})
export class PublicApiModule {}
