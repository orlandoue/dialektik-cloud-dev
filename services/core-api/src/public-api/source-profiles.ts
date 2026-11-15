import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';

let available = false;

/**
 * Whether migration 087 (media_source_profiles) is applied. Until it is, the
 * API answers exactly as before (Chile only). Set by SourceProfilesMonitor.
 */
export function sourceProfilesAvailable(): boolean {
  return available;
}

/** For the monitor and tests. */
export function setSourceProfilesAvailable(value: boolean): void {
  available = value;
}

const RECHECK_MS = 5 * 60_000;

/** Detects migration 087 at startup and every five minutes until it exists. */
@Injectable()
export class SourceProfilesMonitor implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #logger = new Logger(SourceProfilesMonitor.name);

  constructor(@Inject(CoreDatabaseService) private readonly db: CoreDatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.check();
    if (!available) {
      this.#timer = setInterval(() => void this.check(), RECHECK_MS);
      this.#timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  async check(): Promise<boolean> {
    try {
      const result = await sql<{ ok: boolean }>`select to_regclass('public.media_source_profiles') is not null as ok`
        .execute(this.db.database);
      if (result.rows[0]?.ok === true && !available) {
        available = true;
        this.#logger.log('Media source profiles available: multi-country API enabled.');
        if (this.#timer) clearInterval(this.#timer);
      }
    } catch {
      // Keep the previous state; the next check retries.
    }
    return available;
  }
}

export const PUBLIC_COUNTRIES = ['CL', 'ES', 'AR', 'US'] as const;
export type PublicCountry = typeof PUBLIC_COUNTRIES[number];

/** ?country=CL|ES|AR|US; Chile when omitted, as before. */
export function parsePublicCountry(value: unknown): PublicCountry {
  if (value === undefined) return 'CL';
  if (typeof value === 'string' && (PUBLIC_COUNTRIES as readonly string[]).includes(value)) return value as PublicCountry;
  throw new Error('INVALID_COUNTRY');
}
