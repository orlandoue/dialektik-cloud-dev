import { createDatabase, destroyDatabase } from "@dialektik/database";
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";

import {
  CORE_API_CONFIG,
  type CoreApiConfig,
} from "../config/core-api-config.js";

/** A separate optional connection: the ordinary Core reader never gains writes. */
@Injectable()
export class ModerationDatabaseService implements OnApplicationShutdown {
  readonly #database: ReturnType<typeof createDatabase> | undefined;
  #destroyed = false;

  public constructor(@Inject(CORE_API_CONFIG) config: Readonly<CoreApiConfig>) {
    this.#database =
      config.moderationDatabaseUrl === undefined
        ? undefined
        : createDatabase({
            applicationName: "dialektik-core-moderation",
            connectionString: config.moderationDatabaseUrl,
            maxConnections: Math.min(config.databasePoolMax, 3),
            ...(config.databaseCaCertificate === undefined
              ? {}
              : { caCertificate: config.databaseCaCertificate }),
          });
  }

  public get database(): ReturnType<typeof createDatabase> {
    if (this.#database === undefined || this.#destroyed) {
      throw new ServiceUnavailableException(
        "Editorial writing is not configured.",
      );
    }
    return this.#database;
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#database !== undefined) await destroyDatabase(this.#database);
  }
}
