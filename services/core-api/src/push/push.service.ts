import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Database } from '@dialektik/database';
import { sql, type Transaction } from 'kysely';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { EditionService } from '../edition/edition.service.js';
import { PublicApiRepository } from '../public-api/public-api.repository.js';
import { PUBLIC_COUNTRIES, type PublicCountry } from '../public-api/source-profiles.js';
import { FcmSender, parseServiceAccount, type PushMessage } from './fcm-sender.js';

const MISSING = new Set(['42P01', '42883']);
/** Checked every 10 minutes: each reader gets the notice within their hour. */
const DAILY_CHECK_MS = 10 * 60_000;
/** An older duel is not «del día»: nothing is sent that day. */
const DAILY_MAX_AGE_MS = 36 * 60 * 60_000;

export interface DailyDuel {
  readonly eventId: string;
  readonly title: string;
}

/** Chile's local date and hour, whatever the server's time zone. */
export function santiagoClock(now: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/** The notice never names the outlets nor says who is right. */
export function dailyDuelMessage(duel: DailyDuel): PushMessage {
  const title = duel.title.replace(/^Contraste de enfoques:\s*/u, '').trim();
  return {
    title: 'Duelo del día',
    body: title.length > 140 ? `${title.slice(0, 139).trimEnd()}…` : title,
    data: { kind: 'daily_duel', event_id: duel.eventId },
  };
}

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  readonly #logger = new Logger(PushService.name);
  readonly #sender: FcmSender | null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    @Inject(CoreDatabaseService) private readonly db: CoreDatabaseService,
    @Inject(PublicApiRepository) private readonly repository: PublicApiRepository,
    @Optional() @Inject(EditionService) private readonly editions?: EditionService,
  ) {
    const account = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    this.#sender = account === null ? null : new FcmSender(account);
  }

  onModuleInit(): void {
    if (this.#sender === null || process.env.DIALEKTIK_PUSH === 'off') {
      this.#logger.log('Push notices are off (no FIREBASE_SERVICE_ACCOUNT_JSON or DIALEKTIK_PUSH=off).');
      return;
    }
    this.#timer = setInterval(() => { void this.sendDaily().catch(() => undefined); }, DAILY_CHECK_MS);
    this.#timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
  }

  async register(userId: string, input: { token: string; dailyEnabled: boolean; dailyHour: number; country: string }): Promise<void> {
    if (!(PUBLIC_COUNTRIES as readonly string[]).includes(input.country)) throw new BadRequestException('Invalid country.');
    await this.#asReader(userId, (tx) => sql`select public.dialektik_register_push_device(
      ${userId}::uuid, ${input.token}, ${input.dailyEnabled}, ${input.dailyHour}, ${input.country})`.execute(tx));
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.#asReader(userId, (tx) => sql`select public.dialektik_unregister_push_device(${userId}::uuid, ${token})`.execute(tx));
  }

  async #asReader(userId: string, work: (tx: Transaction<Database>) => Promise<unknown>): Promise<void> {
    try {
      await this.db.database.transaction().setAccessMode('read write').execute(async (tx) => {
        await sql`select set_config('dialektik.social_user', ${userId}, true)`.execute(tx);
        await work(tx);
      });
    } catch (error) {
      if (MISSING.has((error as { code?: string }).code ?? '')) {
        throw new ServiceUnavailableException('Push storage is not available yet.');
      }
      throw error;
    }
  }

  /** The newest published duel of a country, if it is recent enough. */
  async dailyDuel(country: PublicCountry, now = new Date()): Promise<DailyDuel | null> {
    // The hour's edition chooses it, so the notice and Inicio agree.
    const edition = await this.editions?.latest(country).catch(() => null);
    if (edition && edition.duel_event_id !== null
      && now.getTime() - new Date(edition.generated_at).getTime() <= 3 * 60 * 60_000) {
      const card = edition.cards[edition.duel_event_id];
      if (card !== undefined && typeof card.title_descriptive === 'string') {
        return { eventId: edition.duel_event_id, title: card.title_descriptive };
      }
    }
    const rows = await this.repository.listContradictions({ cursor: null, limit: 1, country });
    const row = rows[0];
    if (row === undefined || now.getTime() - new Date(row.confirmed_at).getTime() > DAILY_MAX_AGE_MS) return null;
    return { eventId: row.event_id, title: row.event_title };
  }

  /** Sends the «Duelo del día» to the readers whose hour it is. */
  async sendDaily(now = new Date()): Promise<{ sent: number; forgotten: number; skipped: number }> {
    const totals = { sent: 0, forgotten: 0, skipped: 0 };
    if (this.#sender === null || this.#running) return totals;
    this.#running = true;
    try {
      const { day, hour } = santiagoClock(now);
      const due = await this.#asSender((tx) => sql<{ token: string; country: string; last_event_id: string | null }>`
        select token, country, last_event_id from public.dialektik_push_daily_due(${hour}, ${day}::date)`.execute(tx));
      const duels = new Map<string, DailyDuel | null>();
      const delivered = new Map<string, string[]>();
      const gone: string[] = [];
      const done: string[] = [];
      for (const device of due.rows) {
        const country = (PUBLIC_COUNTRIES as readonly string[]).includes(device.country) ? device.country as PublicCountry : 'CL';
        if (!duels.has(country)) duels.set(country, await this.dailyDuel(country, now));
        const duel = duels.get(country) ?? null;
        // No duel today, or the same one as yesterday: nothing is sent, and
        // the device is not retried until tomorrow.
        if (duel === null || duel.eventId === device.last_event_id) {
          totals.skipped += 1;
          done.push(device.token);
          continue;
        }
        const outcome = await this.#sender.send(device.token, dailyDuelMessage(duel)).catch(() => 'failed' as const);
        if (outcome === 'delivered') {
          totals.sent += 1;
          delivered.set(duel.eventId, [...(delivered.get(duel.eventId) ?? []), device.token]);
        } else if (outcome === 'unregistered') {
          gone.push(device.token);
        }
      }
      await this.#asSender(async (tx) => {
        for (const [eventId, tokens] of delivered) {
          await sql`select public.dialektik_push_daily_mark(${tokens}::text[], ${day}::date, ${eventId})`.execute(tx);
        }
        if (done.length > 0) await sql`select public.dialektik_push_daily_mark(${done}::text[], ${day}::date, null)`.execute(tx);
        if (gone.length > 0) await sql`select public.dialektik_push_forget(${gone}::text[])`.execute(tx);
      });
      totals.forgotten = gone.length;
      if (totals.sent + totals.forgotten > 0) {
        this.#logger.log(`Daily duel notices: ${totals.sent} sent, ${totals.forgotten} tokens forgotten, ${totals.skipped} skipped.`);
      }
      return totals;
    } catch (error) {
      if (!MISSING.has((error as { code?: string }).code ?? '')) {
        this.#logger.warn(`Daily duel notices failed: ${(error as { code?: string }).code ?? (error as Error).message}`);
      }
      return totals;
    } finally {
      this.#running = false;
    }
  }

  async #asSender<T>(work: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.database.transaction().setAccessMode('read write').execute(async (tx) => {
      await sql`select set_config('dialektik.push_sender', 'on', true)`.execute(tx);
      return work(tx);
    });
  }
}
