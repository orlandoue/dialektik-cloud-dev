import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/health/health.controller.js';
import { LiveSemanticProductionService } from '../src/semantic/live-semantic-production.service.js';

describe('freshness wake', () => {
  let service: LiveSemanticProductionService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    process.env.DIALEKTIK_LIVE_SEMANTIC_SCHEDULER_ENABLED = 'true';
    service = new LiveSemanticProductionService({} as never, {} as never, {} as never);
  });
  afterEach(() => { service.onModuleDestroy(); delete process.env.DIALEKTIK_LIVE_SEMANTIC_SCHEDULER_ENABLED; vi.useRealTimers(); vi.restoreAllMocks(); });
  it('wakes asynchronously only once an hour and never overlaps', async () => {
    let finish!: (value:string)=>void;
    const run=vi.spyOn(service,'runScheduled').mockImplementationOnce(() => new Promise(resolve=>{finish=resolve;})).mockResolvedValue('RECENT_SEMANTIC_RUN');
    service.wakeFromHealthPing(); service.wakeFromHealthPing();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61*60*1000);
    service.wakeFromHealthPing();
    expect(run).toHaveBeenCalledTimes(1);
    finish('DONE'); await Promise.resolve(); await Promise.resolve();
    service.wakeFromHealthPing();
    expect(run).toHaveBeenCalledTimes(2);
    service.wakeFromHealthPing();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('does nothing when the scheduler is disabled', () => {
    delete process.env.DIALEKTIK_LIVE_SEMANTIC_SCHEDULER_ENABLED;
    const run=vi.spyOn(service,'runScheduled');
    service.wakeFromHealthPing();
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps liveness synchronous when starting a background wake', () => {
    const wake=vi.spyOn(service,'wakeFromHealthPing').mockImplementation(()=>{});
    const health={liveness:()=>({status:'live'})};
    const controller=new HealthController(health as never,service);
    expect(controller.liveness()).toEqual({status:'live'});
    expect(wake).toHaveBeenCalledOnce();
  });
});
