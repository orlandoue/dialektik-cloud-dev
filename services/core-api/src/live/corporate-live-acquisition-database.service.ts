import { createDatabase, destroyDatabase } from '@dialektik/database';
import { Injectable, ServiceUnavailableException, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreApiConfig } from '../config/core-api-config.js';

/** Dedicated, narrowly granted writer for corporate live acquisition. */
@Injectable()
export class CorporateLiveAcquisitionDatabaseService implements OnApplicationShutdown {
  readonly #database: ReturnType<typeof createDatabase> | undefined;
  #closed = false;

  constructor(config: Readonly<CoreApiConfig>) {
    const url = process.env.CORPORATE_LIVE_DATABASE_URL?.trim();
    this.#database = !url
      ? undefined
      : createDatabase({
          connectionString: url,
          applicationName: 'dialektik-corporate-live-acquisition',
          maxConnections: Math.min(config.databasePoolMax, 2),
          ...(config.databaseCaCertificate === undefined
            ? {}
            : { caCertificate: config.databaseCaCertificate }),
        });
  }

  get isConfigured(): boolean {
    return this.#database !== undefined && !this.#closed;
  }

  get database(): ReturnType<typeof createDatabase> {
    if (!this.isConfigured)
      throw new ServiceUnavailableException('Corporate live acquisition writer is not configured.');
    return this.#database!;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#database) await destroyDatabase(this.#database);
  }
}
