import type { LLMConfig, StructuredLLMTransport } from './llm.contracts.js';
import { CloudflareWorkersAITransport } from './llm.cloudflare.js';
import {
  readCloudflareRuntimeProfiles,
  type CloudflareProviderProfile,
} from './llm.cloudflare-config.js';
import { GeminiStreamingTransport } from './llm.streaming-transport.js';
import { readGeminiRuntimeProfiles, type GeminiProviderProfile } from './llm.provider-config.js';
import { AsyncSemanticQueue, ProviderResilience } from './llm.resilience.js';

export type ProductProviderProfile = GeminiProviderProfile | CloudflareProviderProfile;
export type ProductProviderId = 'gemini' | 'cloudflare_workers_ai';

export interface ProductProviderRuntime {
  readonly provider: ProductProviderId;
  readonly providerType: 'llm_gemini' | 'llm_cloudflare_workers_ai';
  readonly profiles: readonly ProductProviderProfile[];
  createTransport(
    profile: ProductProviderProfile,
    resilience: ProviderResilience,
  ): StructuredLLMTransport;
}

/** Provider selection is explicit; the default remains the existing Gemini path. */
export function readProductProviderRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProductProviderRuntime {
  const selected = env.DIALEKTIK_LLM_PROVIDER?.trim() ?? 'gemini';
  if (selected === 'gemini') {
    const profiles = readGeminiRuntimeProfiles(env);
    return Object.freeze({
      provider: 'gemini' as const,
      providerType: 'llm_gemini' as const,
      profiles,
      createTransport(profile: ProductProviderProfile, resilience: ProviderResilience) {
        if (!('thinkingLevel' in profile)) throw new Error('LLM_PROVIDER_PROFILE_MISMATCH');
        return new GeminiStreamingTransport(profile, undefined, resilience);
      },
    });
  }
  if (selected === 'cloudflare_workers_ai') {
    const profiles = readCloudflareRuntimeProfiles(env);
    return Object.freeze({
      provider: 'cloudflare_workers_ai' as const,
      providerType: 'llm_cloudflare_workers_ai' as const,
      profiles,
      createTransport(profile: ProductProviderProfile, resilience: ProviderResilience) {
        if (!('outputMode' in profile)) throw new Error('LLM_PROVIDER_PROFILE_MISMATCH');
        return new CloudflareWorkersAITransport(profile, undefined, env, undefined, resilience);
      },
    });
  }
  throw new Error('LLM_PROVIDER_UNSUPPORTED');
}

/** Queue only immutable run identities; model selection happens before work starts. */
export class ProductProviderAsyncShadowDispatcher {
  private readonly queue = new AsyncSemanticQueue(8);

  constructor(
    private readonly work: (
      runId: string,
      profile: ProductProviderProfile,
      transport: StructuredLLMTransport,
    ) => Promise<void>,
    private readonly runtime: ProductProviderRuntime = readProductProviderRuntime(),
    private readonly resilience = new ProviderResilience(),
    private readonly clock = () => Date.now(),
  ) {
    if (!runtime.profiles.length || runtime.profiles.length > 2)
      throw new Error('LLM_FALLBACK_BOUND_INVALID');
  }

  enqueue(runId: string): void {
    this.queue.enqueue(runId, async () => {
      const counters = this.resilience.snapshot();
      const profile = this.runtime.profiles.find(
        (candidate) => (counters[candidate.config.model]?.circuitUntil ?? 0) <= this.clock(),
      );
      if (!profile) throw new Error('LLM_PROVIDER_CIRCUIT_OR_CAPACITY_BLOCKED');
      const transport = this.runtime.createTransport(profile, this.resilience);
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
    return {
      provider: this.runtime.provider,
      providerType: this.runtime.providerType,
      queue: this.queue.snapshot(),
      models: this.resilience.snapshot(),
    };
  }
}

export function providerConfig(profile: ProductProviderProfile): LLMConfig {
  return profile.config;
}
