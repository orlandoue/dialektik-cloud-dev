import {
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  Body,
} from "@nestjs/common";
import { LiveSemanticProductionService } from "./live-semantic-production.service.js";

@Controller("v1/mod/live-semantic-production")
export class LiveSemanticProductionController {
  constructor(
    @Inject(LiveSemanticProductionService)
    private readonly service: LiveSemanticProductionService,
  ) {}

  @Post("run")
  run(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.runBatch(authorization, body);
  }

  @Post("promote")
  promote(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.promote(authorization, body);
  }

  @Post("reject")
  reject(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.reject(authorization, body);
  }

  @Post("quarantine-legacy")
  quarantineLegacy(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.quarantineLegacyContradiction(authorization, body);
  }

  @Get("review")
  review(
    @Headers("authorization") authorization: string | undefined,
    @Query("day") day: string | undefined,
  ) {
    return this.service.listReview(authorization, day);
  }
}
