import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Database } from '@dialektik/database';
import { sql, type Transaction } from 'kysely';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { activeCatalogMarkets } from '../live/live.publisher-market.js';
import { PublicApiRepository } from '../public-api/public-api.repository.js';
import { eventCard } from '../public-api/public-api.service.js';
import { SHARED_READ_OPTIONS, SharedReadCache } from '../public-api/shared-read-cache.js';
import { PUBLIC_COUNTRIES, type PublicCountry } from '../public-api/source-profiles.js';
import { ScienceService } from '../science/science.service.js';
import { StoryGroupsService } from '../stories/story-groups.service.js';
import {
  breakingCase,
  composeEdition,
  EDITION_RULES,
  type Edition,
  type EditionEvent,
  type EditionPin,
} from './edition-rules.js';

const MISSING = new Set(['42P01', '42703', '42883']);
/** Checked every 10 minutes: a new edition each clock hour, or at once for breaking news. */
const CHECK_EVERY_MS = 10 * 60_000;
/** At most one extra (breaking) edition per country every 20 minutes. */
const BREAKING_GAP_MS = 20 * 60_000;
/** Cases read for an edition: the newest published ones of the country. */
const CANDIDATES = 150;

export type EditionTrigger = 'hourly' | 'breaking' | 'moderation' | 'startup';

export interface EditionPayload extends Edition {
  readonly country: string;
  readonly generated_at: string;
  readonly next_at: string;
  readonly trigger: EditionTrigger;
  /** Card of every case the edition names, as /v1/feed shapes it. */
  readonly cards: Record<string, Record<string, unknown>>;
  readonly story_titles: Record<string, string>;
}

export interface PinJson {
  id: string;
  target_kind: 'event' | 'story';
  target_id: string;
  action: 'pin' | 'hide' | 'duel';
  reason: string;
  expires_at: string;
}

function nextHour(now: Date): Date {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

@Injectable()
export class EditionService implements OnModuleInit, OnModuleDestroy {
  readonly #logger = new Logger(EditionService.name);
  readonly #latest = new SharedReadCache<EditionPayload | null>(SHARED_READ_OPTIONS);
  #timer: ReturnType<typeof setInterval> | undefined;
  #startup: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  readonly #lastBreaking = new Map<string, number>();

  constructor(
    @Inject(CoreDatabaseService) private readonly db: CoreDatabaseService,
    @Inject(PublicApiRepository) private readonly repository: PublicApiRepository,
    @Inject(StoryGroupsService) private readonly stories: StoryGroupsService,
    @Inject(ScienceService) private readonly science: ScienceService,
  ) {}

  onModuleInit(): void {
    if (process.env.DIALEKTIK_HOME_EDITION === 'off') return;
    this.#startup = setTimeout(() => { void this.tick(new Date(), true).catch(() => undefined); }, 3 * 60_000);
    this.#startup.unref?.();
    this.#timer = setInterval(() => { void this.tick(new Date()).catch(() => undefined); }, CHECK_EVERY_MS);
    this.#timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    if (this.#startup !== undefined) clearTimeout(this.#startup);
  }

  countries(): PublicCountry[] {
    return activeCatalogMarkets().filter((c): c is PublicCountry => (PUBLIC_COUNTRIES as readonly string[]).includes(c));
  }

  /** The current edition of a country, from memory; null before the first one. */
  latest(country: PublicCountry): Promise<EditionPayload | null> {
    return this.#latest.get(`edition:${country}`, () => this.#readLatest(country));
  }

  async #readLatest(country: PublicCountry): Promise<EditionPayload | null> {
    try {
      const rows = await sql<{ payload: EditionPayload }>`select payload from public.home_editions
        where country = ${country} order by generated_at desc limit 1`.execute(this.db.database);
      return rows.rows[0]?.payload ?? null;
    } catch (error) {
      if (MISSING.has((error as { code?: string }).code ?? '')) return null;
      throw error;
    }
  }

  /** One check: a new edition each clock hour, or at once for a breaking case. */
  async tick(now: Date, startup = false): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (const country of this.countries()) {
        const current = await this.#readLatest(country);
        const generated = current === null ? 0 : new Date(current.generated_at).getTime();
        const thisHour = new Date(now); thisHour.setUTCMinutes(0, 0, 0);
        if (current === null || generated < thisHour.getTime()) {
          await this.compose(country, startup ? 'startup' : 'hourly', now);
          continue;
        }
        if (now.getTime() - (this.#lastBreaking.get(country) ?? 0) < BREAKING_GAP_MS) continue;
        const events = await this.#events(country, now);
        const breaking = breakingCase(events, current, now);
        if (breaking !== null) {
          this.#lastBreaking.set(country, now.getTime());
          await this.compose(country, 'breaking', now, events);
        }
      }
    } catch (error) {
      if (!MISSING.has((error as { code?: string }).code ?? '')) {
        this.#logger.warn(`Home edition failed: ${(error as { code?: string }).code ?? (error as Error).message}`);
      }
    } finally {
      this.#running = false;
    }
  }

  async compose(country: PublicCountry, trigger: EditionTrigger, now = new Date(), known?: EditionEvent[]): Promise<EditionPayload> {
    const rows = await this.repository.listFeed({ cursor: null, limit: CANDIDATES, country });
    const cards = new Map(rows.filter((r) => r.analysis_state === 'PUBLISHED').map((r) => [r.id, r]));
    const events = known ?? await this.#events(country, now, [...cards.values()]);
    const stories = await this.stories.stories().catch(() => []);
    const pins = await this.#pins(country);
    const edition = composeEdition(
      events.filter((e) => cards.has(e.id)),
      stories.map((s) => ({ id: s.id, title: s.title, eventIds: s.event_ids })),
      pins.map((p) => ({ id: p.id, targetKind: p.target_kind, targetId: p.target_id, action: p.action, reason: p.reason, expiresAt: new Date(p.expires_at) })),
      now,
    );
    const named = new Set(edition.items.flatMap((i) => i.event_ids));
    if (edition.duel_event_id !== null) named.add(edition.duel_event_id);
    const payload: EditionPayload = {
      ...edition,
      country,
      generated_at: now.toISOString(),
      next_at: nextHour(now).toISOString(),
      trigger,
      cards: Object.fromEntries([...named].filter((id) => cards.has(id)).map((id) => [id, eventCard(cards.get(id)!) as unknown as Record<string, unknown>])),
      story_titles: Object.fromEntries(stories.filter((s) => edition.items.some((i) => i.kind === 'story' && i.id === s.id)).map((s) => [s.id, s.title])),
    };
    await this.db.database.transaction().setAccessMode('read write').execute(async (tx) => {
      await sql`insert into public.home_editions (country, generated_at, trigger, rules_version, duel_event_id, payload)
        values (${country}, ${now}, ${trigger}, ${EDITION_RULES.version}, ${edition.duel_event_id}, ${JSON.stringify(payload)}::jsonb)`.execute(tx);
      await sql`delete from public.home_editions where generated_at < now() - interval '2 days'`.execute(tx);
    });
    this.#latest.invalidate(`edition:${country}`);
    this.#logger.log(`Home edition ${country} (${trigger}): ${edition.items.length} items, duel ${edition.duel_event_id ?? 'none'}.`);
    return payload;
  }

  /** Coverage of the newest published cases: outlets, first and last coverage, duel. */
  async #events(country: PublicCountry, now: Date, known?: { id: string; source_count: number; detected_at: Date; category: string }[]): Promise<EditionEvent[]> {
    const feed = known ?? (await this.repository.listFeed({ cursor: null, limit: CANDIDATES, country }))
      .filter((r) => r.analysis_state === 'PUBLISHED');
    if (feed.length === 0) return [];
    const ids = feed.map((r) => r.id);
    const coverage = await sql<{ id: string; source_ids: string[]; first_coverage: Date; last_coverage: Date; duel_at: Date | null }>`
      select a.event_id::text as id, array_agg(distinct a.source_id::text) as source_ids,
        min(a.published_at) as first_coverage, max(a.published_at) as last_coverage,
        (select max(c.confirmed_at) from public.contradiction_publications c
          where c.event_id = a.event_id and c.publication_state = 'published'
            and c.confirmed_by is not null and c.confirmed_at is not null) as duel_at
      from public.articles a
      where a.event_id::text = any(${ids}::text[]) and a.origin = 'LIVE_REAL'
      group by a.event_id`.execute(this.db.database);
    const byId = new Map(coverage.rows.map((r) => [r.id, r]));
    return feed.map((row) => {
      const c = byId.get(row.id);
      // A case without live articles (a fixture) counts by its card.
      return {
        id: row.id,
        category: row.category,
        sourceIds: c?.source_ids ?? Array.from({ length: row.source_count }, (_, i) => `${row.id}#${i}`),
        firstCoverage: new Date(c?.first_coverage ?? row.detected_at),
        lastCoverage: new Date(c?.last_coverage ?? row.detected_at),
        duelAt: c?.duel_at ? new Date(c.duel_at) : null,
      };
    }).filter((e) => e.lastCoverage.getTime() <= now.getTime() + 5 * 60_000);
  }

  async #pins(country: PublicCountry): Promise<PinJson[]> {
    try {
      const rows = await sql<{ id: string; target_kind: 'event' | 'story'; target_id: string; action: 'pin' | 'hide' | 'duel'; reason: string; expires_at: Date }>`
        select id::text, target_kind, target_id, action, reason, expires_at from public.home_edition_pins
        where country = ${country} and removed_at is null and expires_at > now()
        order by created_at`.execute(this.db.database);
      return rows.rows.map((r) => ({ ...r, expires_at: new Date(r.expires_at).toISOString() }));
    } catch (error) {
      if (MISSING.has((error as { code?: string }).code ?? '')) return [];
      throw error;
    }
  }

  // Moderation: the current edition, its pins, and changes to them.

  async moderation(userId: string, country: PublicCountry): Promise<{ edition: EditionPayload | null; pins: PinJson[] }> {
    this.#assertModerator(userId);
    return { edition: await this.#readLatest(country), pins: await this.#pins(country) };
  }

  async pin(userId: string, input: { country: PublicCountry; targetKind: 'event' | 'story'; targetId: string; action: EditionPin['action']; reason: string; hours: number }): Promise<EditionPayload> {
    this.#assertModerator(userId);
    if (input.action === 'duel' && input.targetKind !== 'event') throw new BadRequestException('Only a case can be the duel.');
    await this.#asModerator(userId, (tx) => sql`insert into public.home_edition_pins (country, target_kind, target_id, action, reason, created_by, expires_at)
      values (${input.country}, ${input.targetKind}, ${input.targetId}, ${input.action}, ${input.reason.trim()}, ${userId}::uuid,
        now() + make_interval(hours => ${input.hours}))`.execute(tx));
    return this.compose(input.country, 'moderation');
  }

  async unpin(userId: string, pinId: string): Promise<EditionPayload> {
    this.#assertModerator(userId);
    const result = await this.#asModerator(userId, (tx) => sql<{ country: PublicCountry }>`update public.home_edition_pins
      set removed_at = now() where id = ${pinId}::uuid and removed_at is null returning country`.execute(tx));
    const country = result.rows[0]?.country;
    if (country === undefined) throw new NotFoundException('Pin not found.');
    return this.compose(country, 'moderation');
  }

  #assertModerator(userId: string): void {
    if (!this.science.isModerator(userId)) throw new ForbiddenException({ code: 'PUBLIC_FORBIDDEN' });
  }

  #asModerator<T>(userId: string, work: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.database.transaction().setAccessMode('read write').execute(async (tx) => {
      await sql`select set_config('dialektik.science_moderator', 'on', true)`.execute(tx);
      await sql`select set_config('dialektik.social_user', ${userId}, true)`.execute(tx);
      return work(tx);
    });
  }
}
