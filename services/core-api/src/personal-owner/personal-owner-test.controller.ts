import { Body, Controller, Get, Header, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';
import { PersonalOwnerGuard } from './personal-owner.auth.js';
import { PersonalOwnerTestArticlesService } from './personal-owner-test-articles.js';
import { PersonalOwnerTestWorkflowService } from './personal-owner-test-workflow.js';

@Controller('personal/owner/test')
@UseGuards(PersonalOwnerGuard)
export class PersonalOwnerTestController {
  constructor(
    @Inject(PersonalOwnerTestWorkflowService)
    private readonly service: PersonalOwnerTestWorkflowService,
    @Inject(PersonalOwnerTestArticlesService)
    private readonly articles: PersonalOwnerTestArticlesService,
    @Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>,
  ) {}

  @Post('articles/ingest')
  @Header('Cache-Control', 'no-store')
  ingestArticle() {
    return this.articles.ingest();
  }

  @Get('articles')
  @Header('Cache-Control', 'no-store')
  listArticles() {
    return this.articles.list();
  }

  @Get('authorizations')
  @Header('Cache-Control', 'no-store')
  listAuthorizations() {
    return this.articles.listAuthorizations();
  }

  @Get('jobs/:jobId')
  @Header('Cache-Control', 'no-store')
  get(@Param('jobId') jobId: string) {
    return this.service.get(jobId, this.serviceOwnerIdentity());
  }

  @Post('jobs')
  @Header('Cache-Control', 'no-store')
  start(@Body() body: unknown) {
    return this.service.start(body);
  }

  @Post('jobs/:jobId/cancel')
  @Header('Cache-Control', 'no-store')
  cancel(@Param('jobId') jobId: string) {
    return this.service.cancel(jobId, this.serviceOwnerIdentity());
  }

  /** The guard authenticates the configured owner; the service binds the body owner. */
  private serviceOwnerIdentity(): string {
    return this.config.personalOwnerId ?? '';
  }
}
