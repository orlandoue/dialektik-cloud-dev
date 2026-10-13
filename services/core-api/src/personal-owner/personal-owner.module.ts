import { Module, type DynamicModule } from '@nestjs/common';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { assertLiveDatabase } from '../live/live.sync.js';
import { PersonalOwnerController } from './personal-owner.controller.js';
import { PersonalOwnerGuard } from './personal-owner.auth.js';
import { PersonalOwnerService } from './personal-owner.service.js';
import { PersonalOwnerOperationalService } from './personal-owner-operational.service.js';
import {
  PERSONAL_OWNER_FEED_READER,
  PERSONAL_OWNER_JOB_DISPATCHER,
  PERSONAL_OWNER_LLM_TRANSPORT_FACTORY,
  GuardedPersonalOwnerFeedReader,
  type PersonalOwnerFeedReader,
  type PersonalOwnerJobDispatcher,
  type PersonalOwnerLLMTransportFactory,
} from './personal-owner-operational.adapters.js';
import {
  ConfiguredPersonalOwnerLLMTransportFactory,
  PersonalOwnerOperationalDispatcher,
} from './personal-owner-operational.dispatcher.js';
import { PersonalOwnerTestController } from './personal-owner-test.controller.js';
import {
  PERSONAL_OWNER_TEST_RUNNER,
  PersonalOwnerTestWorkflowService,
  type PersonalOwnerTestRunner,
} from './personal-owner-test-workflow.js';
import { PersonalOwnerTestArticlesService } from './personal-owner-test-articles.js';
import { PersonalOwnerTestRunnerAdapter } from './personal-owner-test-runner.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function personalOwnerTestWorkflowEnabled(config: Readonly<CoreApiConfig>): boolean {
  let target: URL;
  try {
    target = new URL(config.databaseUrl);
  } catch {
    return false;
  }
  return (
    ['test', 'development'].includes(config.nodeEnvironment) &&
    config.ownershipMode === 'personal' &&
    config.semanticMode === 'unassigned' &&
    LOOPBACK_HOSTS.has(config.host) &&
    LOOPBACK_HOSTS.has(target.hostname) &&
    /^\/dialektik_test_[a-z0-9_]+$/u.test(target.pathname) &&
    Boolean(config.personalOwnerId && config.personalOwnerAuthTokenSha256) &&
    process.env.DIALEKTIK_PERSONAL_OWNER_TEST_MODE === '1' &&
    process.env.DIALEKTIK_PERSONAL_OWNER_TEST_PROVIDER_MODE === 'mock'
  );
}

@Module({})
export class PersonalOwnerModule {
  static register(config: Readonly<CoreApiConfig>): DynamicModule {
    if (
      config.ownershipMode !== 'personal' ||
      config.nodeEnvironment === 'production' ||
      config.semanticMode !== 'unassigned'
    )
      return { module: PersonalOwnerModule };

    assertLiveDatabase(config);
    const testWorkflowEnabled = personalOwnerTestWorkflowEnabled(config);
    return {
      module: PersonalOwnerModule,
      controllers: [
        PersonalOwnerController,
        ...(testWorkflowEnabled ? [PersonalOwnerTestController] : []),
      ],
      providers: [
        PersonalOwnerGuard,
        {
          provide: 'PERSONAL_OWNER_CLOCK',
          useValue: () => new Date(),
        },
        {
          provide: PERSONAL_OWNER_FEED_READER,
          useFactory: (): PersonalOwnerFeedReader => new GuardedPersonalOwnerFeedReader(),
        },
        {
          provide: PERSONAL_OWNER_LLM_TRANSPORT_FACTORY,
          useFactory: (): PersonalOwnerLLMTransportFactory =>
            new ConfiguredPersonalOwnerLLMTransportFactory(),
        },
        {
          provide: PERSONAL_OWNER_JOB_DISPATCHER,
          inject: [CoreDatabaseService, PERSONAL_OWNER_LLM_TRANSPORT_FACTORY],
          useFactory: (
            database: CoreDatabaseService,
            transportFactory: PersonalOwnerLLMTransportFactory,
          ): PersonalOwnerJobDispatcher =>
            new PersonalOwnerOperationalDispatcher(config, database, transportFactory),
        },
        {
          provide: PersonalOwnerService,
          inject: [CoreDatabaseService, 'PERSONAL_OWNER_CLOCK'],
          useFactory: (database: CoreDatabaseService, now: () => Date) =>
            new PersonalOwnerService(config, database, now),
        },
        {
          provide: PersonalOwnerOperationalService,
          inject: [
            CoreDatabaseService,
            'PERSONAL_OWNER_CLOCK',
            PERSONAL_OWNER_FEED_READER,
            PERSONAL_OWNER_JOB_DISPATCHER,
          ],
          useFactory: (
            database: CoreDatabaseService,
            now: () => Date,
            feedReader: PersonalOwnerFeedReader,
            dispatcher: PersonalOwnerJobDispatcher,
          ) => new PersonalOwnerOperationalService(config, database, now, feedReader, dispatcher),
        },
        ...(testWorkflowEnabled
          ? [
              PersonalOwnerTestArticlesService,
              {
                provide: PERSONAL_OWNER_TEST_RUNNER,
                inject: [CoreDatabaseService, PersonalOwnerTestArticlesService],
                useFactory: (
                  database: CoreDatabaseService,
                  articles: PersonalOwnerTestArticlesService,
                ): PersonalOwnerTestRunner =>
                  new PersonalOwnerTestRunnerAdapter(database, articles),
              },
              {
                provide: PersonalOwnerTestWorkflowService,
                inject: [CoreDatabaseService, PERSONAL_OWNER_TEST_RUNNER],
                useFactory: (database: CoreDatabaseService, runner: PersonalOwnerTestRunner) =>
                  new PersonalOwnerTestWorkflowService(config, database, runner),
              },
            ]
          : []),
      ],
    };
  }
}
