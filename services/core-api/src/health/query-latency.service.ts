import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import { LiveRepository } from '../live/live.repository.js';
import { PublicApiRepository } from '../public-api/public-api.repository.js';
import { sourceProfilesAvailable } from '../public-api/source-profiles.js';

/**
 * Public, read-only performance probe: runs the reads the app makes when it
 * opens the Coliseo for each country and reports milliseconds and row
 * counts, plus database size. Never returns identifiers, text or URLs.
 * Cached for two minutes and never run twice at once.
 */
export interface QueryTiming {
  readonly ms: number;
  readonly rows: number | null;
  readonly error: string | null;
}

export interface QueryLatencyReport {
  readonly generatedAt: string;
  readonly profilesAvailable: boolean;
  readonly timings: Readonly<Record<string, QueryTiming>>;
  readonly database: {
    readonly sizeMb: number | null;
    readonly largestTablesMb: Readonly<Record<string, number>>;
    readonly connections: number | null;
    readonly events: number | null;
    readonly articles: number | null;
    readonly articlesLast24hByCountry: Readonly<Record<string, number>>;
  };
}

const CACHE_MS = 120_000;
const QUERY_LIMIT_MS = 45_000;

@Injectable()
export class QueryLatencyService {
  #cache: { at: number; report: QueryLatencyReport } | undefined;
  #running: Promise<QueryLatencyReport> | undefined;

  constructor(@Inject(CoreDatabaseService) private readonly db: CoreDatabaseService) {}

  report(): Promise<QueryLatencyReport> {
    if (this.#cache && Date.now() - this.#cache.at < CACHE_MS) return Promise.resolve(this.#cache.report);
    this.#running ??= this.#measure().then((report) => {
      this.#cache = { at: Date.now(), report };
      return report;
    }).finally(() => { this.#running = undefined; });
    return this.#running;
  }

  async #time(work: () => Promise<number | null>): Promise<QueryTiming> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      const rows = await Promise.race([
        work(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), QUERY_LIMIT_MS); }),
      ]);
      return { ms: Math.round(performance.now() - started), rows, error: null };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]{1,40}$/u.test(error.message) ? error.message
        : typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'ERROR';
      return { ms: Math.round(performance.now() - started), rows: null, error: code };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #number(query: Promise<{ rows: { n: unknown }[] }>): Promise<number | null> {
    try {
      const value = Number((await query).rows[0]?.n);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  async #measure(): Promise<QueryLatencyReport> {
    const database = this.db.database;
    const publicApi = new PublicApiRepository(this.db);
    const live = new LiveRepository(database);
    const timings: Record<string, QueryTiming> = {};
    // Sequential on purpose: each figure is the cost of one request alone.
    for (const country of ['CL', 'ES', 'AR', 'US'] as const) {
      timings[`feed_${country}`] = await this.#time(async () =>
        (await publicApi.listFeed({ cursor: null, limit: 20, country })).length);
      timings[`contrasts_${country}`] = await this.#time(async () =>
        (await publicApi.listContradictions({ cursor: null, limit: 20, country })).length);
      timings[`live_videos_${country}`] = await this.#time(async () =>
        (await live.list({ limit: 25, market: country, format: 'videos' })).length);
      timings[`live_sources_${country}`] = await this.#time(async () =>
        (await live.sources(undefined, country)).length);
    }
    timings.live_news_CL = await this.#time(async () => (await live.list({ limit: 25, market: 'CL' })).length);

    const largest: Record<string, number> = {};
    try {
      const tables = await sql<{ name: string; mb: number }>`
        select c.relname as name, round(pg_total_relation_size(c.oid) / 1048576.0, 1)::float8 as mb
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc limit 10`.execute(database);
      for (const row of tables.rows) largest[row.name] = row.mb;
    } catch { /* not visible to this role */ }
    const byCountry: Record<string, number> = {};
    if (sourceProfilesAvailable()) {
      try {
        const rows = await sql<{ country: string; n: number }>`
          select p.country_code as country, count(*)::int as n from articles a
          join media_source_profiles p on p.source_id = a.source_id
          where a.captured_at > now() - interval '24 hours' group by 1`.execute(database);
        for (const row of rows.rows) byCountry[row.country] = row.n;
      } catch { /* profiles not readable */ }
    }
    return {
      generatedAt: new Date().toISOString(),
      profilesAvailable: sourceProfilesAvailable(),
      timings,
      database: {
        sizeMb: await this.#number(sql<{ n: unknown }>`select round(pg_database_size(current_database()) / 1048576.0, 1) as n`.execute(database)),
        largestTablesMb: largest,
        connections: await this.#number(sql<{ n: unknown }>`select count(*) as n from pg_stat_activity where datname = current_database()`.execute(database)),
        events: await this.#number(sql<{ n: unknown }>`select count(*) as n from events`.execute(database)),
        articles: await this.#number(sql<{ n: unknown }>`select count(*) as n from articles`.execute(database)),
        articlesLast24hByCountry: byCountry,
      },
    };
  }
}
