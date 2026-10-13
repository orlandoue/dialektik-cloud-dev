import 'reflect-metadata';

import { loadCoreApiConfig } from './config/core-api-config.js';
import { startCoreApplication } from './bootstrap.js';

async function main(): Promise<void> {
  const config = loadCoreApiConfig();
  await startCoreApplication(config);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      event: 'core_api_bootstrap_failed',
      level: 'error',
    })}\n`,
  );
  process.exitCode = 1;
});
