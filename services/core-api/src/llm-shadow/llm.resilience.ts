import { isAborted } from './llm.assert.js';
import type { LLMConfig } from './llm.contracts.js';
export class ProviderFailure extends Error {
  constructor(
    readonly status: number | null,
    readonly category: 'HTTP' | 'NETWORK' | 'INCOMPLETE' | 'SCHEMA',
    readonly providerCode?: string,
  ) {
    super('LLM_PROVIDER_ATTEMPT_FAILED');
  }
}
export interface ProviderCounter {
  attempts: number;
  successes: number;
  failures: number;
  latencyMsTotal: number;
  latencyMsMax: number;
  httpErrors: Record<string, number>;
  circuitUntil: number;
  consecutiveFailures: number;
  busy: boolean;
}
export interface ProviderResilienceCallBound {
  /** A per-call ceiling that may narrow, but never widen, the shared policy. */
  readonly maxAttemptsPerModel?: number;
  readonly maxTotalAttempts?: number;
}
const retryable = (s: number | null) =>
  s !== null && (s === 408 || s === 429 || (s >= 500 && s <= 599));
export class ProviderResilience {
  private wireAttempts = 0;
  private readonly counters = new Map<string, ProviderCounter>();
  constructor(
    private readonly policy = {
      maxAttemptsPerModel: 3,
      maxTotalAttempts: 4,
      failureThreshold: 3,
      cooldownMs: 60000,
      baseDelayMs: 500,
      maxDelayMs: 4000,
    },
    private readonly clock = () => Date.now(),
    private readonly random = () => Math.random(),
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void> = abortableDelay,
  ) {
    if (
      !Number.isSafeInteger(policy.maxAttemptsPerModel) ||
      policy.maxAttemptsPerModel < 1 ||
      policy.maxAttemptsPerModel > 3 ||
      !Number.isSafeInteger(policy.maxTotalAttempts) ||
      policy.maxTotalAttempts < 1 ||
      policy.maxTotalAttempts > 6 ||
      policy.failureThreshold < 1 ||
      policy.failureThreshold > 5 ||
      policy.cooldownMs < 1 ||
      policy.cooldownMs > 300000 ||
      policy.baseDelayMs < 1 ||
      policy.maxDelayMs < policy.baseDelayMs ||
      policy.maxDelayMs > 30000
    )
      throw Error('LLM_RESILIENCE_BOUND_INVALID');
  }
  snapshot(): Readonly<Record<string, Readonly<Omit<ProviderCounter, 'busy'>>>> {
    return Object.fromEntries(
      [...this.counters].map(([model, c]) => {
        const { busy, ...safe } = c;
        void busy;
        return [model, { ...safe, httpErrors: { ...safe.httpErrors } }];
      }),
    );
  }
  async run<T, P extends Readonly<{ config: LLMConfig }>>(
    profiles: readonly P[],
    work: (profile: P, attempt: number) => Promise<T>,
    signal = new AbortController().signal,
    callBound: ProviderResilienceCallBound = {},
  ): Promise<{ value: T; profile: P; attempts: number }> {
    const maxAttemptsPerModel = callBound.maxAttemptsPerModel ?? this.policy.maxAttemptsPerModel;
    const maxTotalAttempts = callBound.maxTotalAttempts ?? this.policy.maxTotalAttempts;
    if (
      !profiles.length ||
      profiles.length > 2 ||
      new Set(profiles.map((p) => p.config.model)).size !== profiles.length ||
      !Number.isSafeInteger(maxAttemptsPerModel) ||
      maxAttemptsPerModel < 1 ||
      maxAttemptsPerModel > this.policy.maxAttemptsPerModel ||
      !Number.isSafeInteger(maxTotalAttempts) ||
      maxTotalAttempts < 1 ||
      maxTotalAttempts > this.policy.maxTotalAttempts
    )
      throw Error('LLM_FALLBACK_BOUND_INVALID');
    let total = 0;
    const singleAttempt = maxAttemptsPerModel === 1 && maxTotalAttempts === 1;
    const wireLimit = Math.min(120, maxTotalAttempts, ...profiles.map((p) => p.config.maxCalls));
    for (const profile of profiles) {
      const model = profile.config.model;
      let c = this.counters.get(model);
      if (!c) {
        if (this.counters.size >= 8) throw Error('LLM_MODEL_COUNTER_BOUND');
        c = {
          attempts: 0,
          successes: 0,
          failures: 0,
          latencyMsTotal: 0,
          latencyMsMax: 0,
          httpErrors: {},
          circuitUntil: 0,
          consecutiveFailures: 0,
          busy: false,
        };
        this.counters.set(model, c);
      }
      if (c.busy || c.circuitUntil > this.clock()) continue;
      c.busy = true;
      try {
        for (
          let attempt = 1;
          attempt <= this.policy.maxAttemptsPerModel &&
          attempt <= maxAttemptsPerModel &&
          total < maxTotalAttempts &&
          this.wireAttempts < wireLimit;
          attempt++
        ) {
          if (isAborted(signal)) throw Error('LLM_ABORTED');
          total++;
          this.wireAttempts++;
          c.attempts++;
          const started = this.clock();
          let measured = false;
          const recordLatency = () => {
            if (measured) return;
            measured = true;
            const elapsed = Math.max(0, this.clock() - started);
            c.latencyMsTotal += elapsed;
            c.latencyMsMax = Math.max(c.latencyMsMax, elapsed);
          };
          try {
            const value = await work(profile, total);
            c.successes++;
            c.consecutiveFailures = 0;
            c.circuitUntil = 0;
            return { value, profile, attempts: total };
          } catch (error) {
            recordLatency();
            c.failures++;
            const failure =
              error instanceof ProviderFailure ? error : new ProviderFailure(null, 'SCHEMA');
            const code = failure.status === null ? failure.category : String(failure.status);
            c.httpErrors[code] = (c.httpErrors[code] ?? 0) + 1;
            if (isAborted(signal)) throw Error('LLM_ABORTED');
            const canFallback =
              retryable(failure.status) ||
              failure.category === 'NETWORK' ||
              failure.category === 'INCOMPLETE';
            c.consecutiveFailures = canFallback ? c.consecutiveFailures + 1 : 0;
            if (canFallback && c.consecutiveFailures >= this.policy.failureThreshold)
              c.circuitUntil = this.clock() + this.policy.cooldownMs;
            if (!canFallback)
              throw new ProviderFailure(failure.status, failure.category, failure.providerCode);
            // A caller may declare provider operations at-most-once. In that
            // mode any failure after dispatch is surfaced for reconciliation;
            // it is never replayed against this or another profile.
            if (singleAttempt)
              throw new ProviderFailure(failure.status, failure.category, failure.providerCode);
            if (
              !retryable(failure.status) ||
              c.circuitUntil > this.clock() ||
              attempt === maxAttemptsPerModel ||
              total === maxTotalAttempts
            )
              break;
            const cap = Math.min(
              this.policy.maxDelayMs,
              this.policy.baseDelayMs * 2 ** (attempt - 1),
            );
            const fraction = Math.min(1, Math.max(0, this.random()));
            await this.sleep(Math.floor(cap * (0.5 + 0.5 * fraction)), signal);
          } finally {
            recordLatency();
          }
        }
      } finally {
        c.busy = false;
      }
    }
    throw Error('LLM_PROVIDER_CIRCUIT_OR_CAPACITY_BLOCKED');
  }
}
export async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (isAborted(signal)) throw Error('LLM_ABORTED');
  await new Promise<void>((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(Error('LLM_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
/** Metadata identity only; body acquisition belongs inside the scoped job, after rights/leases. */
export class AsyncSemanticQueue {
  private readonly pending: { id: string; execute: () => Promise<void> }[] = [];
  private readonly seen = new Set<string>();
  private active = false;
  private closed = false;
  private readonly idleResolvers: (() => void)[] = [];
  private failures = 0;
  constructor(private readonly maxPending = 8) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 16)
      throw Error('LLM_QUEUE_BOUND');
  }
  enqueue(id: string, execute: () => Promise<void>): void {
    if (
      this.closed ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      this.seen.has(id) ||
      this.seen.size >= 64 ||
      this.pending.length >= this.maxPending
    )
      throw Error('LLM_QUEUE_REJECTED');
    this.seen.add(id);
    this.pending.push({ id, execute });
    if (!this.active) {
      this.active = true;
      queueMicrotask(() => void this.drain());
    }
  }
  private async drain(): Promise<void> {
    for (;;) {
      const job = this.pending.shift();
      if (!job) break;
      try {
        await job.execute();
      } catch {
        this.failures++;
      }
    }
    this.active = false;
    for (const resolve of this.idleResolvers.splice(0)) resolve();
  }
  async idle(): Promise<void> {
    if (this.active) await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }
  close(): void {
    this.closed = true;
  }
  snapshot(): object {
    return {
      pending: this.pending.length,
      active: this.active,
      accepted: this.seen.size,
      failures: this.failures,
    };
  }
}
