import { Module } from '@nestjs/common';

import { FollowedSourcesController } from './followed-sources.controller.js';
import { FollowedSourcesService } from './followed-sources.service.js';
import { PublicApiController } from './public-api.controller.js';
import { PublicApiRepository } from './public-api.repository.js';
import { PublicApiService } from './public-api.service.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';
import { PrivateBetaAuthModule } from '../private-beta/private-beta-auth.module.js';
import { SocialArenaController } from './social-arena.controller.js';
import { SocialArenaService } from './social-arena.service.js';
import { SocialController } from './social.controller.js';
import { SocialService } from './social.service.js';
import { ScienceController } from '../science/science.controller.js';
import { ScienceService } from '../science/science.service.js';
import { SourceProfilesMonitor } from './source-profiles.js';
import { StoryGroupsController } from '../stories/story-groups.controller.js';
import { StoryGroupsService } from '../stories/story-groups.service.js';
import { PushController } from '../push/push.controller.js';
import { PushService } from '../push/push.service.js';

@Module({
  imports: [PrivateBetaAuthModule],
  controllers: [FollowedSourcesController, PublicApiController, SocialController, SocialArenaController, ScienceController, StoryGroupsController, PushController],
  providers: [SourceProfilesMonitor, PublicApiRepository, PublicApiService, PublicRateLimitService, FollowedSourcesService, SocialService, SocialArenaService, ScienceService, StoryGroupsService, PushService],
})
export class PublicApiModule {}
