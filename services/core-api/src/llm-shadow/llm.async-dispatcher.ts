import type { StructuredLLMTransport } from './llm.contracts.js';
import { readGeminiRuntimeProfiles, type GeminiProviderProfile } from './llm.provider-config.js';
import { AsyncSemanticQueue, ProviderResilience } from './llm.resilience.js';
import { GeminiStreamingTransport } from './llm.streaming-transport.js';
/** Enqueue only immutable run identities. Resolve rights/manifests and acquire content inside work. */
export class GeminiAsyncShadowDispatcher {
  private readonly queue = new AsyncSemanticQueue(8);
  constructor(
    private readonly work: (
      runId: string,
      profile: GeminiProviderProfile,
      transport: StructuredLLMTransport,
    ) => Promise<void>,
    private readonly profiles: readonly GeminiProviderProfile[] = readGeminiRuntimeProfiles(),
    private readonly resilience = new ProviderResilience(),
    private readonly transportFactory: (
      profile: GeminiProviderProfile,
      resilience: ProviderResilience,
    ) => StructuredLLMTransport = (profile, resilience) =>
      new GeminiStreamingTransport(profile, undefined, resilience),
    private readonly clock = () => Date.now(),
  ) {
    if (!profiles.length || profiles.length > 2) throw Error('LLM_FALLBACK_BOUND_INVALID');
  }
  enqueue(runId: string): void {
    this.queue.enqueue(runId, async () => {
      const counters = this.resilience.snapshot();
      const profile = this.profiles.find(
        (p) => (counters[p.config.model]?.circuitUntil ?? 0) <= this.clock(),
      );
      if (!profile) throw Error('LLM_PROVIDER_CIRCUIT_OR_CAPACITY_BLOCKED');
      // Selection precedes registry/cache/engine construction. The chosen actual profile is mandatory.
      const transport = this.transportFactory(profile, this.resilience);
      try {
        await this.work(runId, profile, transport);
      } finally {
        transport.dispose?.();
      }
    });
  }
  async idle(): Promise<void> {
    await this.queue.idle();
  }
  close(): void {
    this.queue.close();
  }
  snapshot(): object {
    return { queue: this.queue.snapshot(), models: this.resilience.snapshot() };
  }
}
