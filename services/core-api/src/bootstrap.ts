import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import type { CoreApiConfig } from './config/core-api-config.js';
import { createFastifyOptions, registerRequestCorrelation } from './http/request-correlation.js';
import { SafeHttpExceptionFilter } from './http/safe-http-exception.filter.js';

export async function createCoreApplication(
  config: Readonly<CoreApiConfig>,
  options: Readonly<{ abortOnError?: boolean }> = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter(createFastifyOptions(config));
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    adapter,
    {
      abortOnError: options.abortOnError ?? true,
      logger: false,
    },
  );

  registerRequestCorrelation(adapter.getInstance());
  if (
    config.nodeEnvironment !== 'production' &&
    ['fixture', 'unassigned'].includes(config.semanticMode ?? 'disabled')
  ) {
    adapter.getInstance().addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (origin !== undefined && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Vary', 'Origin');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, If-None-Match, If-Modified-Since, Cache-Control',
        );
        reply.header('Access-Control-Expose-Headers', 'ETag, Last-Modified');
        if (request.method === 'OPTIONS') await reply.code(204).send();
      }
    });
  }
  application.useGlobalFilters(new SafeHttpExceptionFilter());
  application.enableShutdownHooks();

  return application;
}

export async function startCoreApplication(
  config: Readonly<CoreApiConfig>,
  options: Readonly<{ abortOnError?: boolean }> = {},
): Promise<NestFastifyApplication> {
  const application = await createCoreApplication(config, options);
  await application.listen(config.port, config.host);

  application.getHttpAdapter().getInstance().log.info(
    {
      environment: config.nodeEnvironment,
      event: 'core_api_started',
      host: config.host,
      port: config.port,
    },
    'Dialektik Core API started',
  );

  return application;
}
