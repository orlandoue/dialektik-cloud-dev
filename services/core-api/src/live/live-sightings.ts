import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';

/**
 * A feed is polled every few seconds and lists the same items for days. A
 * receipt is the evidence of what was seen (URL, dates, rights policy, hash
 * of the raw payload), so a new one is written only when that evidence
 * changes. Repeated sightings of unchanged items are kept as a counter in
 * live_item_sightings (migration 099), written at most once per hour per
 * item: every update leaves a dead row behind.
 */
export interface ReceiptEvidence {
  readonly policy_id: string;
  readonly discovery_url: string;
  readonly discovered_url: string | null;
  readonly canonical_url: string | null;
  readonly source_item_id: string | null;
  readonly raw_payload_hash: string;
  readonly adapter_version: string;
  readonly disposition: string;
  readonly error_code: string | null;
}

const EVIDENCE_FIELDS = ['policy_id', 'discovery_url', 'discovered_url', 'canonical_url', 'source_item_id',
  'raw_payload_hash', 'adapter_version', 'disposition', 'error_code'] as const satisfies readonly (keyof ReceiptEvidence)[];

/** A receipt is only needed when some evidence differs from the latest one. */
export function receiptNeeded(latest: ReceiptEvidence | undefined, candidate: ReceiptEvidence): boolean {
  if (latest === undefined) return true;
  return EVIDENCE_FIELDS.some((field) => (latest[field] ?? null) !== (candidate[field] ?? null));
}

/** The latest receipt of an item, for comparison. */
export async function latestReceiptEvidence(db: Kysely<any>, exclusionId: string): Promise<ReceiptEvidence | undefined> {
  const rows = await sql<ReceiptEvidence>`select policy_id, discovery_url, discovered_url, canonical_url, source_item_id,
      raw_payload_hash, adapter_version, disposition, error_code
    from public.live_acquisition_receipts where exclusion_id = ${exclusionId}
    order by seen_at desc, id desc limit 1`.execute(db);
  return rows.rows[0];
}

export const SIGHTING_WRITE_INTERVAL_MS = 60 * 60_000;
const MAX_REMEMBERED = 50_000;

/**
 * Writes repeated sightings at most once per hour per item: an in-memory
 * throttle avoids even asking the database, and the upsert only updates a
 * row whose last sighting is an hour old (so a restart or a second process
 * cannot write more often either).
 */
export class SightingRecorder {
  readonly #written = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async record(db: Kysely<any>, exclusionId: string, seenAt: Date): Promise<'written' | 'throttled' | 'unavailable'> {
    const last = this.#written.get(exclusionId);
    if (last !== undefined && this.now() - last < SIGHTING_WRITE_INTERVAL_MS) return 'throttled';
    try {
      await sql`insert into public.live_item_sightings(exclusion_id, first_seen_at, last_seen_at, sightings)
        values (${exclusionId}, ${seenAt}, ${seenAt}, 1)
        on conflict (exclusion_id) do update set last_seen_at = excluded.last_seen_at,
          sightings = public.live_item_sightings.sightings + 1
        where public.live_item_sightings.last_seen_at <= excluded.last_seen_at - interval '1 hour'`.execute(db);
    } catch (error) {
      // Before migration 099 sightings are simply not counted.
      if ((error as { code?: string }).code === '42P01') return 'unavailable';
      throw error;
    }
    this.#written.delete(exclusionId);
    this.#written.set(exclusionId, this.now());
    if (this.#written.size > MAX_REMEMBERED) {
      const oldest = this.#written.keys().next().value;
      if (oldest !== undefined) this.#written.delete(oldest);
    }
    return 'written';
  }
}

export const sightings = new SightingRecorder();

let available = false;
/** Whether migration 099 exists; until then last_seen_at comes from receipts only. */
export function liveSightingsAvailable(): boolean {
  return available;
}
export function setLiveSightingsAvailable(value: boolean): void {
  available = value;
}

const RECHECK_MS = 5 * 60_000;

@Injectable()
export class LiveSightingsMonitor implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #logger = new Logger(LiveSightingsMonitor.name);

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

  async check(): Promise<void> {
    try {
      const rows = await sql<{ ok: boolean }>`select to_regclass('public.live_item_sightings') is not null as ok`
        .execute(this.db.database);
      setLiveSightingsAvailable(rows.rows[0]?.ok === true);
      if (available && this.#timer) {
        clearInterval(this.#timer);
        this.#timer = undefined;
        this.#logger.log('Live item sightings available (migration 099).');
      }
    } catch {
      /* The next check retries. */
    }
  }
}
