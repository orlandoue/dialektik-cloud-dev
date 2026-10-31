import {
  Controller,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { CorporateLiveAcquisitionService } from './corporate-live-acquisition.service.js';

@Controller('live/acquisition')
@UseGuards(PrivateBetaAuthGuard)
export class CorporateLiveAcquisitionController {
  constructor(
    @Inject(CorporateLiveAcquisitionService)
    private readonly acquisition: CorporateLiveAcquisitionService,
  ) {}

  @Post('poll')
  async poll() {
    if (!(await this.acquisition.startIfEnabled())) throw new NotFoundException();
    return { status: 'POLL_SCHEDULED' as const };
  }
}
