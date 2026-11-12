import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/health/health.controller.js';
import {
  planScheduledSemanticPairs,
  planSubBatches,
  sourcesPerCluster,
  type SemanticCandidatePair,
  type SemanticPreclusterArticle,
} from '../src/semantic/live-semantic-precluster.js';
import { AutoPromotionTally, LiveSemanticProductionService, SCHEDULED_MAX_NEW_EXTRACTIONS, SCHEDULED_SUB_BATCHES } from '../src/semantic/live-semantic-production.service.js';
import { hasStrongPairOverlap, isSportsText } from '../src/semantic/live-semantic-scheduler-prefilter.js';

const article = (id: string, source: string, headline: string): SemanticPreclusterArticle => ({
  articleId: id, sourceId: source, publishedAt: new Date('2026-11-11T12:00:00Z'), headline,
  eventKey: '', eventTitle: headline, eventSummary: '',
});
const pair = (left: SemanticPreclusterArticle, right: SemanticPreclusterArticle): SemanticCandidatePair =>
  ({ left, right, clusterKey: `${left.articleId}-${right.articleId}` });

describe('scheduled batch planning', () => {
  const topics = ['Steinert', 'Gajardo', 'Rabat', 'Codelco', 'Hermosilla', 'Kast', 'Boric', 'Matthei', 'Jara', 'Kaiser'];
  const pairs = topics.map((name, i) => pair(
    article(`a${i}`, 'press', `${name} responde por el caso en Santiago`),
    article(`b${i}`, 'video', `${name} responde por el caso ante la prensa`),
  ));

  it('respects the runs table: at most five new extractions per batch', () => {
    // live_semantic_production_runs.requested_count is checked 1..5.
    expect(SCHEDULED_MAX_NEW_EXTRACTIONS).toBe(5);
  });

  it('evaluates up to eight distinct pairs when articles are already extracted', () => {
    // One new article per pair: five pairs fit in five extractions.
    const plan = planScheduledSemanticPairs(pairs, new Set(pairs.map(p => p.left.articleId)), { maxPairs: 8, maxNewExtractions: SCHEDULED_MAX_NEW_EXTRACTIONS });
    expect(plan.pairs).toHaveLength(5);
    expect(plan.newExtractions).toBe(5);
    // With more budget the same planner reaches the pair cap.
    expect(planScheduledSemanticPairs(pairs, new Set(pairs.map(p => p.left.articleId)), { maxPairs: 8, maxNewExtractions: 12 }).pairs).toHaveLength(8);
  });

  it('never plans more new extractions than the cap', () => {
    const allNew = new Set(pairs.flatMap(p => [p.left.articleId, p.right.articleId]));
    const plan = planScheduledSemanticPairs(pairs, allNew, { maxPairs: 8, maxNewExtractions: SCHEDULED_MAX_NEW_EXTRACTIONS });
    expect(plan.newExtractions).toBeLessThanOrEqual(5);
    expect(plan.pairs).toHaveLength(2);
  });

  it('reuses an extracted article for free and prefers distinct topics first', () => {
    const shared = article('s', 'press', 'Steinert asume como agregada en Paraguay');
    const repeated = [
      pair(shared, article('x', 'video', 'Steinert asume en Paraguay tras su salida')),
      pair(shared, article('y', 'radio', 'Steinert asume en Paraguay y responde')),
      pair(article('g1', 'press', 'Gajardo defiende la reforma en Hacienda'), article('g2', 'video', 'Gajardo defiende la reforma ante diputados')),
    ];
    const plan = planScheduledSemanticPairs(repeated, new Set(['x', 'y', 'g1', 'g2']), { maxPairs: 8, maxNewExtractions: 12 });
    // Distinct topics first: Steinert, then Gajardo, then the second Steinert pair.
    expect(plan.pairs.map(p => p.right.articleId)).toEqual(['x', 'g2', 'y']);
    expect(plan.newExtractions).toBe(4);
  });

  it('returns nothing when no pair is pending', () => {
    expect(planScheduledSemanticPairs([], new Set(), { maxPairs: 8, maxNewExtractions: 12 }).pairs).toHaveLength(0);
  });
});

describe('two chained sub-batches per run', () => {
  const topics = ['Steinert', 'Gajardo', 'Rabat', 'Codelco', 'Hermosilla', 'Kast', 'Boric', 'Matthei'];
  const pairs = topics.map((name, i) => pair(
    article(`a${i}`, 'press', `${name} responde`), article(`b${i}`, 'video', `${name} responde`)));
  const allNew = new Set(pairs.flatMap(p => [p.left.articleId, p.right.articleId]));

  const limits = { maxPairs: 8, maxNewPerBatch: SCHEDULED_MAX_NEW_EXTRACTIONS, batches: SCHEDULED_SUB_BATCHES };

  it('fills two sub-batches of at most five new extractions each', () => {
    const plans = planSubBatches(pairs, allNew, limits);
    expect(plans).toHaveLength(2);
    for (const plan of plans) expect(plan.newExtractions).toBeLessThanOrEqual(5);
    // Two new articles per pair: two pairs fit in each sub-batch.
    expect(plans.flatMap(plan => plan.pairs)).toHaveLength(4);
  });

  it('treats an article extracted in the first sub-batch as free in the second', () => {
    const hub = article('hub', 'press', 'Steinert responde');
    const star = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map(id => pair(hub, article(id, `s-${id}`, 'Steinert responde')));
    const pending = new Set(['hub', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6']);
    const plans = planSubBatches(star, pending, limits);
    expect(plans[0]?.newExtractions).toBe(5);
    // «hub» was extracted in the first sub-batch; the rest are new.
    expect(plans[1]?.articleIds).toContain('hub');
    expect(plans[1]?.newExtractions).toBe(2);
    expect(plans.flatMap(plan => plan.pairs)).toHaveLength(6);
  });

  it('reaches eight pairs when one side of each is already extracted', () => {
    const halfNew = new Set(pairs.map(p => p.left.articleId));
    const plans = planSubBatches(pairs, halfNew, limits);
    expect(plans.flatMap(plan => plan.pairs)).toHaveLength(8);
    expect(plans.map(plan => plan.newExtractions)).toEqual([5, 3]);
  });

  it('stops when nothing new remains to extract', () => {
    expect(planSubBatches(pairs, new Set(), limits)).toHaveLength(0);
  });

  it('counts the distinct media of each candidate case', () => {
    const a = article('a', 'press', 'x'), b = article('b', 'video', 'x'), c = article('c', 'radio', 'x');
    const map = sourcesPerCluster([{ left: a, right: b, clusterKey: 'k' }, { left: a, right: c, clusterKey: 'k' }]);
    expect(map.get('k')).toBe(3);
  });
});

describe('pre-model pruning', () => {
  it('keeps sports and non-sports items apart, without mistaking a political party', () => {
    expect(isSportsText('Colo Colo gana el campeonato')).toBe(true);
    expect(isSportsText('El partido terminó con goles en el estadio')).toBe(true);
    expect(isSportsText('Partido Republicano presenta su candidatura')).toBe(false);
    expect(isSportsText('Senado aprueba reforma de pensiones')).toBe(false);
  });

  it('requires shared specifics in the headline and across the excerpt', () => {
    // Two headline words, but nothing else in common: too weak.
    expect(hasStrongPairOverlap(
      'Steinert viaja a Paraguay', 'La exsubsecretaria fue nombrada.',
      'Steinert en Paraguay', 'Hoy llueve en Santiago.',
    )).toBe(false);
    expect(hasStrongPairOverlap(
      'Steinert asume en Paraguay', 'Nombrada agregada tras su salida de Seguridad.',
      'Steinert asume cargo en Paraguay', 'La exsubsecretaria fue nombrada agregada.',
    )).toBe(true);
    expect(hasStrongPairOverlap('Lluvia en Santiago', 'texto', 'Steinert en Paraguay', 'texto')).toBe(false);
  });
});

describe('adaptive spacing between batches', () => {
  it('drains a backlog every fifteen minutes', () => {
    const gap = LiveSemanticProductionService.minimumGapMs;
    expect(gap('tick', true, 16)).toBe(15 * 60 * 1000);
    expect(gap('tick', false, 468)).toBe(15 * 60 * 1000);
    expect(gap('tick', true, 15)).toBe(45 * 60 * 1000);
    expect(gap('startup', true, 468)).toBe(10 * 60 * 1000);
  });

  it('retries sooner after an empty batch and runs soon after a deploy', () => {
    const gap = LiveSemanticProductionService.minimumGapMs;
    expect(gap('tick', true)).toBe(45 * 60 * 1000);
    expect(gap('tick', false)).toBe(30 * 60 * 1000);
    expect(gap('health', false)).toBe(30 * 60 * 1000);
    // A deploy is not blocked by the previous empty batch; a crash loop is.
    expect(gap('startup', true)).toBe(10 * 60 * 1000);
    expect(gap('startup', false)).toBe(10 * 60 * 1000);
  });
});

describe('scheduler lifecycle', () => {
  let service: LiveSemanticProductionService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    process.env.DIALEKTIK_LIVE_SEMANTIC_SCHEDULER_ENABLED = 'true';
    service = new LiveSemanticProductionService({} as never, {} as never, {} as never);
  });
  afterEach(() => { service.onModuleDestroy(); delete process.env.DIALEKTIK_LIVE_SEMANTIC_SCHEDULER_ENABLED; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('runs a startup batch 15 seconds after boot, then checks every five minutes', async () => {
    const run = vi.spyOn(service, 'runScheduled').mockResolvedValue('RECENT_SEMANTIC_RUN');
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[2]).toBe('startup');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[2]).toBe('tick');
  });

  it('records a failing tick as a safe reason code', async () => {
    vi.spyOn(service, 'runScheduled').mockRejectedValue(new Error('SEMANTIC_AUTOMATION_ACTOR_REQUIRED'));
    service.wakeFromHealthPing();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.lastSkippedTick?.status).toBe('FAILED:SEMANTIC_AUTOMATION_ACTOR_REQUIRED');
    expect(service.lastSkippedTick?.trigger).toBe('health');
  });

  it('does not start when the scheduler is disabled', async () => {
    delete process.env.DIALEKTIK_LIVE_SEMANTIC_SCHEDULER_ENABLED;
    const run = vi.spyOn(service, 'runScheduled');
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('automatic promotion tally', () => {
  it('counts rejections by reason code', () => {
    const tally = new AutoPromotionTally();
    tally.reject('AUTO_SCOPE_ASSESSMENT_INVALID');
    tally.reject('AUTO_SCOPE_ASSESSMENT_INVALID');
    tally.reject('AUTO_PROMOTION_REVIEW_REQUIRED');
    expect(tally.reasons).toEqual({ AUTO_SCOPE_ASSESSMENT_INVALID: 2, AUTO_PROMOTION_REVIEW_REQUIRED: 1 });
  });
});

describe('health controller', () => {
  it('answers 503 for the pipeline status when its service is missing', async () => {
    const reply = { header: vi.fn(), code: vi.fn() };
    const controller = new HealthController({ liveness: () => ({ status: 'live' }) } as never);
    expect(await controller.pipelineStatus(reply as never)).toEqual({ status: 'unavailable' });
    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.header).toHaveBeenCalledWith('cache-control', 'no-store');
    expect(controller.liveness()).toEqual({ status: 'live' });
  });
});
