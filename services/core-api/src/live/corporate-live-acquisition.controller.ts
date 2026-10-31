import {
  Controller,
  Inject,
  NotFoundException,
  Post,
  ServiceUnavailableException,
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
    const result = await this.acquisition.startIfEnabled();
    if (!result.enabled) throw new NotFoundException();
    if (!result.scheduled) {
      throw new ServiceUnavailableException({
        status: 'POLL_STATUS_UPDATE_FAILED',
        sqlState: result.sqlState,
      });
    }
    return { status: 'POLL_SCHEDULED' as const };
  }
}
