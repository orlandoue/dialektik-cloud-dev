import { describe, expect, it, vi } from 'vitest';

vi.mock('kysely', async (original) => ({
  ...(await original<typeof import('kysely')>()),
  sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({
    execute: (executor: { executeSql: (query: string, params: unknown[]) => unknown }) =>
      executor.executeSql(parts.join('?'), values),
  }),
}));

import { PipelineStatusService } from '../src/health/pipeline-status.service.js';

type Row = Record<string, unknown>;

function core(answer: (query: string) => Row | Error) {
  const queries: string[] = [];
  return {
    queries,
    service: {
      database: {
        executeSql: async (query: string) => {
          queries.push(query);
          const result = answer(query);
          if (result instanceof Error) throw result;
          return { rows: [result] };
        },
      },
    },
  };
}

const summary = {
  trigger: 'startup', startedAt: '2026-11-12T20:00:00.000Z', finishedAt: '2026-11-12T20:03:00.000Z',
  status: 'COMPLETED_FOR_EDITORIAL_REVIEW', targetDay: '2026-11-11', candidateArticles: 180,
  candidatePairs: 40, pairsEvaluated: 7, articlesSelected: 13, articlesProcessed: 9, modelCalls: 25,
  eventGroupsFormed: 3, eventsPromoted: 2, contrastsPromoted: 1,
  skipOrRejectReasons: { PAIR_HEADLINES_TOO_GENERIC: 20, AUTO_SCOPE_ASSESSMENT_INVALID: 1 },
};

const answers = (query: string): Row | Error => {
  if (query.includes('from public.articles')) return { last: new Date('2026-11-12T20:00:00Z'), recent: 214 };
  if (query.includes('corporate_live_source_poll_state'))
    return Object.assign(new Error('permission denied for table'), { code: '42501' });
  if (query.includes('from public.events')) return { last: new Date('2026-11-12T20:02:00Z'), recent: 2 };
  if (query.includes('contradiction_publications')) return { last: new Date('2026-11-12T20:02:30Z'), recent: 1 };
  return new Error('UNEXPECTED_SQL');
};

describe('public pipeline status', () => {
  it('reports the last batch, live counts and which parts could not be read', async () => {
    const db = core(answers);
    const semantic = {
      schedulerEnabled: true, schedulerBusy: false,
      lastSkippedTick: { at: '2026-11-12T20:10:00.000Z', trigger: 'tick', status: 'RECENT_SEMANTIC_RUN' },
      lastRunSummary: summary,
      latestRunRecord: async () => ({ startedAt: summary.startedAt, completedAt: summary.finishedAt, processed: 9, pairAssessments: 6, eventsPromotedSince: 2 }),
    };
    const status = await new PipelineStatusService(db.service as never, semantic as never).status();
    expect(status).toMatchObject({
      lastSyncAt: null,
      lastArticleCapturedAt: '2026-11-12T20:00:00.000Z',
      recentArticlesLast24h: 214,
      scheduler: { enabled: true, busy: false, lastSkippedTick: { status: 'RECENT_SEMANTIC_RUN' } },
      lastSemanticRunAt: '2026-11-12T20:00:00.000Z',
      lastRunStatus: 'COMPLETED_FOR_EDITORIAL_REVIEW',
      lastRunTrigger: 'startup',
      lastRunArticlesProcessed: 9,
      lastRunPairsEvaluated: 7,
      lastRunModelCalls: 25,
      lastRunEventsPromoted: 2,
      lastRunContrastsPromoted: 1,
      lastRunSkipOrRejectReasons: { PAIR_HEADLINES_TOO_GENERIC: 20, AUTO_SCOPE_ASSESSMENT_INVALID: 1 },
      latestPublishedEventAt: '2026-11-12T20:02:00.000Z',
      latestPublishedContrastAt: '2026-11-12T20:02:30.000Z',
      eventsPublishedLast24h: 2,
      contrastsPublishedLast24h: 1,
      // A table the reader cannot see is reported, not fatal.
      unavailable: ['sync:42501'],
    });
    // Only aggregates are read: no identifiers, texts or URLs are selected.
    for (const query of db.queries) expect(query).not.toMatch(/\b(?:url\w*|headline|text_original|title\w*|id)\s+as\b/u);
    expect(JSON.stringify(status)).not.toMatch(/https?:|01[0-9A-HJKMNP-TV-Z]{24}/u);
  });

  it('falls back to the database record after a restart', async () => {
    const db = core(answers);
    const semantic = {
      schedulerEnabled: true, schedulerBusy: false, lastSkippedTick: undefined, lastRunSummary: undefined,
      latestRunRecord: async () => ({ startedAt: '2026-11-12T00:23:00.000Z', completedAt: '2026-11-12T00:24:00.000Z', processed: 2, pairAssessments: 1, eventsPromotedSince: 0 }),
    };
    const status = await new PipelineStatusService(db.service as never, semantic as never).status();
    expect(status.lastSemanticRunAt).toBe('2026-11-12T00:23:00.000Z');
    expect(status.lastRunArticlesProcessed).toBe(2);
    expect(status.lastRunPairsEvaluated).toBe(1);
    expect(status.lastRunEventsPromoted).toBe(0);
    expect(status.lastRunStatus).toBeNull();
    expect(status.lastRunSkipOrRejectReasons).toBeNull();
  });

  it('caches for twenty seconds so pings cannot hammer the database', async () => {
    const db = core(answers);
    const service = new PipelineStatusService(db.service as never);
    await service.status(1_000);
    const reads = db.queries.length;
    await service.status(1_000 + 19_000);
    expect(db.queries.length).toBe(reads);
    await service.status(1_000 + 21_000);
    expect(db.queries.length).toBe(reads * 2);
  });
});
