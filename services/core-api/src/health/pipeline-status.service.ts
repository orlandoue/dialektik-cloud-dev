import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import {
  LiveSemanticProductionService,
  type SemanticRunSummary,
} from '../semantic/live-semantic-production.service.js';

/**
 * Public, read-only summary of the news pipeline: timestamps, counts and
 * reason codes only. It never returns identifiers, text, URLs or secrets.
 */
export interface PipelineStatus {
  readonly generatedAt: string;
  readonly lastSyncAt: string | null;
  readonly lastArticleCapturedAt: string | null;
  readonly recentArticlesLast24h: number | null;
  readonly scheduler: {
    readonly enabled: boolean;
    readonly busy: boolean;
    readonly lastSkippedTick: { readonly at: string; readonly trigger: string; readonly status: string } | null;
  };
  readonly lastSemanticRunAt: string | null;
  readonly lastSemanticRunCompletedAt: string | null;
  readonly lastRunStatus: string | null;
  readonly lastRunTrigger: string | null;
  readonly lastRunCandidateArticles: number | null;
  readonly lastRunCandidatePairs: number | null;
  readonly lastRunArticlesProcessed: number | null;
  readonly lastRunPairsEvaluated: number | null;
  readonly lastRunModelCalls: number | null;
  readonly lastRunEventGroupsFormed: number | null;
  readonly lastRunEventsPromoted: number | null;
  readonly lastRunContrastsPromoted: number | null;
  readonly lastRunSkipOrRejectReasons: Readonly<Record<string, number>> | null;
  readonly latestPublishedEventAt: string | null;
  readonly latestPublishedContrastAt: string | null;
  readonly eventsPublishedLast24h: number | null;
  readonly contrastsPublishedLast24h: number | null;
  /** Parts that could not be read, as `part:SQLSTATE`; never SQL text. */
  readonly unavailable: readonly string[];
}

const CACHE_MS = 20_000;

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function code(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const value = (error as { code?: unknown }).code;
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/u.test(value)) return value;
  }
  return 'UNAVAILABLE';
}

@Injectable()
export class PipelineStatusService {
  #cached: { readonly at: number; readonly value: PipelineStatus } | undefined;
  #pending: Promise<PipelineStatus> | undefined;

  public constructor(
    @Inject(CoreDatabaseService) private readonly database: CoreDatabaseService,
    @Optional() @Inject(LiveSemanticProductionService)
    private readonly semantic?: LiveSemanticProductionService,
  ) {}

  public async status(now = Date.now()): Promise<PipelineStatus> {
    if (this.#cached && now - this.#cached.at < CACHE_MS) return this.#cached.value;
    this.#pending ??= this.#collect().finally(() => { this.#pending = undefined; });
    const value = await this.#pending;
    this.#cached = { at: now, value };
    return value;
  }

  async #collect(): Promise<PipelineStatus> {
    const unavailable: string[] = [];
    const attempt = async <T>(part: string, read: () => Promise<T>): Promise<T | null> => {
      try {
        return await read();
      } catch (error) {
        unavailable.push(`${part}:${code(error)}`);
        return null;
      }
    };
    const db = this.database.database;
    const [articles, sync, events, contrasts, record] = await Promise.all([
      attempt('articles', async () => (await sql<{ last: Date | null; recent: number }>`
        select max(captured_at) as last,
          count(*) filter (where captured_at>clock_timestamp()-interval '24 hours')::int as recent
        from public.articles where origin='LIVE_REAL'`.execute(db)).rows[0]),
      attempt('sync', async () => (await sql<{ last: Date | null }>`
        select max(last_polled_at) as last from public.corporate_live_source_poll_state`.execute(db)).rows[0]),
      attempt('events', async () => (await sql<{ last: Date | null; recent: number }>`
        select max(p.published_at) as last,
          count(distinct e.id) filter (where p.published_at>clock_timestamp()-interval '24 hours')::int as recent
        from public.events e join public.positions p on p.event_id=e.id and p.publication_state='published'
        where e.analysis_state='PUBLISHED' and e.origin='LIVE_REAL' and e.merged_into is null`.execute(db)).rows[0]),
      attempt('contrasts', async () => (await sql<{ last: Date | null; recent: number }>`
        select max(confirmed_at) as last,
          count(*) filter (where confirmed_at>clock_timestamp()-interval '24 hours')::int as recent
        from public.contradiction_publications where publication_state='published'`.execute(db)).rows[0]),
      this.semantic
        ? attempt('semantic_runs', () => this.semantic!.latestRunRecord())
        : Promise.resolve(null),
    ]);
    const run: SemanticRunSummary | undefined = this.semantic?.lastRunSummary;
    // The in-memory summary is the richest view; after a restart it is empty
    // until the next batch, so the database record fills the basic fields.
    const sameRun = run !== undefined && (record === null || record.startedAt <= run.finishedAt);
    return {
      generatedAt: new Date().toISOString(),
      lastSyncAt: iso(sync?.last),
      lastArticleCapturedAt: iso(articles?.last),
      recentArticlesLast24h: articles?.recent ?? null,
      scheduler: {
        enabled: this.semantic?.schedulerEnabled ?? false,
        busy: this.semantic?.schedulerBusy ?? false,
        lastSkippedTick: this.semantic?.lastSkippedTick ?? null,
      },
      lastSemanticRunAt: record?.startedAt ?? run?.startedAt ?? null,
      lastSemanticRunCompletedAt: record?.completedAt ?? (sameRun ? run!.finishedAt : null),
      lastRunStatus: sameRun ? run!.status : null,
      lastRunTrigger: sameRun ? run!.trigger : null,
      lastRunCandidateArticles: sameRun ? run!.candidateArticles : null,
      lastRunCandidatePairs: sameRun ? run!.candidatePairs : null,
      lastRunArticlesProcessed: sameRun ? run!.articlesProcessed : record?.processed ?? null,
      lastRunPairsEvaluated: sameRun ? run!.pairsEvaluated : record?.pairAssessments ?? null,
      lastRunModelCalls: sameRun ? run!.modelCalls : null,
      lastRunEventGroupsFormed: sameRun ? run!.eventGroupsFormed : null,
      lastRunEventsPromoted: sameRun ? run!.eventsPromoted : record?.eventsPromotedSince ?? null,
      lastRunContrastsPromoted: sameRun ? run!.contrastsPromoted : null,
      lastRunSkipOrRejectReasons: sameRun ? run!.skipOrRejectReasons : null,
      latestPublishedEventAt: iso(events?.last),
      latestPublishedContrastAt: iso(contrasts?.last),
      eventsPublishedLast24h: events?.recent ?? null,
      contrastsPublishedLast24h: contrasts?.recent ?? null,
      unavailable,
    };
  }
}
