import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { assertExactQueryKeys } from '../public-api/public-api.validation.js';
import { ShadowPreflightService } from './shadow.service.js';

@Controller('shadow/semantic')
export class ShadowPreflightController {
  constructor(@Inject(ShadowPreflightService) private readonly service: ShadowPreflightService) {}

  @Get('preflight')
  @Header('Cache-Control', 'no-store')
  preflight(@Query() query: Readonly<Record<string, unknown>>) {
    assertExactQueryKeys(query, []);
    return this.service.preflight();
  }
}
