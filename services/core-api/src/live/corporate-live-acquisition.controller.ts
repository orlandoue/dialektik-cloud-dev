import {
  Controller,
  Inject,
  NotFoundException,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
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
  async poll(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.acquisition.startIfEnabled();
    if (!result.enabled) throw new NotFoundException();
    if (!result.scheduled) {
      reply.status(503);
      return {
        status: 'POLL_STATUS_UPDATE_FAILED',
        errorType: result.errorType,
        driverCode: result.driverCode,
        sqlState: result.sqlState,
      };
    }
    return { status: 'POLL_SCHEDULED' as const };
  }
}
