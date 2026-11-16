import { Controller, Inject, UseGuards } from '@nestjs/common';
import { PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { LiveApplicationService } from './live.service.js';
import { LiveController } from './live.controller.js';

@Controller('live')
@UseGuards(PrivateBetaAuthGuard)
export class PrivateBetaLiveController extends LiveController {
  constructor(@Inject(LiveApplicationService) service: LiveApplicationService) {
    super(service);
  }
}
