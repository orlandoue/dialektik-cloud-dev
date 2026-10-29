import { createDatabase, destroyDatabase } from '@dialektik/database';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';

/** Separate least-privilege writer; never use the Core reader or moderation connection for AI writes. */
@Injectable()
export class HeadlineSemanticDatabaseService implements OnApplicationShutdown {
  readonly #database: ReturnType<typeof createDatabase> | undefined;
  #closed = false;

  constructor(@Inject(CORE_API_CONFIG) config: Readonly<CoreApiConfig>) {
    const url = process.env.HEADLINE_AI_DATABASE_URL?.trim();
    this.#database = !url
      ? undefined
      : createDatabase({
          connectionString: url,
          applicationName: 'dialektik-headline-semantic',
          maxConnections: Math.min(config.databasePoolMax, 2),
          ...(config.databaseCaCertificate === undefined
            ? {}
            : { caCertificate: config.databaseCaCertificate }),
        });
  }

  get database(): ReturnType<typeof createDatabase> {
    if (!this.#database || this.#closed)
      throw new ServiceUnavailableException('Headline analysis is not configured.');
    return this.#database;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#database) await destroyDatabase(this.#database);
  }
}
