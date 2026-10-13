import { createDatabase, databaseIsReady, destroyDatabase } from '@dialektik/database';
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';

@Injectable()
export class CoreDatabaseService implements OnApplicationShutdown {
  readonly #database: ReturnType<typeof createDatabase>;
  #destroyed = false;

  public constructor(@Inject(CORE_API_CONFIG) config: Readonly<CoreApiConfig>) {
    this.#database = createDatabase({
      applicationName: 'dialektik-core-api',
      connectionString: config.databaseUrl,
      maxConnections: config.databasePoolMax,
    });
  }

  public get database(): ReturnType<typeof createDatabase> {
    return this.#database;
  }

  public async isReady(): Promise<boolean> {
    if (this.#destroyed) {
      return false;
    }

    return databaseIsReady(this.#database);
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    await destroyDatabase(this.#database);
  }
}
