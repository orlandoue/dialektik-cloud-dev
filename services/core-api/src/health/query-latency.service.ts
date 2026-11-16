import { Inject, Injectable } from '@nestjs/common';
import { CompiledQuery, Kysely, PostgresDialect, sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import { LiveRepository } from '../live/live.repository.js';
import { PublicApiRepository } from '../public-api/public-api.repository.js';
import { PublicApiService } from '../public-api/public-api.service.js';
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
  /** Deployed commit (Render sets RENDER_GIT_COMMIT), to tell which code answered. */
  readonly build: string | null;
  readonly profilesAvailable: boolean;
  /** Costliest plan nodes of the Chilean live news read: node, table or index, ms. */
  readonly liveNewsPlan: readonly string[];
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

interface PlanNode {
  readonly 'Node Type': string;
  readonly 'Relation Name'?: string;
  readonly 'Index Name'?: string;
  readonly 'Actual Total Time'?: number;
  readonly 'Actual Loops'?: number;
  readonly Plans?: readonly PlanNode[];
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

  /** The SQL and parameters LiveRepository.list sends, without running it. */
  async #liveNewsQuery(): Promise<{ sql: string; parameters: readonly unknown[] } | null> {
    let captured: { sql: string; parameters: readonly unknown[] } | null = null;
    const pool = {
      async connect() {
        return {
          async query(command: string | { text: string; values?: unknown[] }, values?: unknown[]) {
            captured = typeof command === 'string' ? { sql: command, parameters: values ?? [] }
              : { sql: command.text, parameters: command.values ?? [] };
            return { rows: [] };
          },
          release() {},
        };
      },
      async end() {},
    };
    const recorder = new Kysely<never>({ dialect: new PostgresDialect({ pool: pool as never }) });
    try {
      await new LiveRepository(recorder as never).list({ limit: 25, market: 'CL' });
    } finally {
      await recorder.destroy();
    }
    return captured;
  }

  /** Top plan nodes by time spent in the node itself (children excluded). */
  async #liveNewsPlan(): Promise<string[]> {
    try {
      const query = await this.#liveNewsQuery();
      if (!query) return [];
      const result = await this.db.database.executeQuery<{ 'QUERY PLAN': unknown }>(
        CompiledQuery.raw(`explain (analyze, format json) ${query.sql}`, [...query.parameters]));
      const raw = result.rows[0]?.['QUERY PLAN'];
      const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { Plan: PlanNode }[];
      const nodes: { label: string; ms: number }[] = [];
      const walk = (node: PlanNode): number => {
        const total = (node['Actual Total Time'] ?? 0) * (node['Actual Loops'] ?? 1);
        const children = (node.Plans ?? []).reduce((sum, child) => sum + walk(child), 0);
        const target = node['Index Name'] ?? node['Relation Name'] ?? '';
        nodes.push({ label: `${node['Node Type']}${target ? ` ${target}` : ''} loops=${node['Actual Loops'] ?? 1}`, ms: Math.max(0, total - children) });
        return total;
      };
      walk(plan[0]!.Plan);
      return nodes.sort((a, b) => b.ms - a.ms).slice(0, 6).map((node) => `${node.label}: ${Math.round(node.ms)} ms`);
    } catch (error) {
      return [`ERROR ${(error as { code?: string })?.code ?? 'UNKNOWN'}`];
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
    // Event detail with coverage: the carousel opens five of these at once.
    const service = new PublicApiService(publicApi);
    for (const country of ['CL', 'ES'] as const) {
      const first = (await publicApi.listContradictions({ cursor: null, limit: 1, country }).catch(() => []))[0];
      if (first) {
        timings[`event_detail_${country}`] = await this.#time(async () =>
          (await service.event(first.event_id, true)).body.articles?.length ?? 0);
      }
    }

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
    const liveNewsPlan = await this.#liveNewsPlan();
    return {
      generatedAt: new Date().toISOString(),
      build: process.env.RENDER_GIT_COMMIT?.slice(0, 12) ?? null,
      profilesAvailable: sourceProfilesAvailable(),
      liveNewsPlan,
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
