import { ProviderFailure, type ProviderResilience } from './llm.resilience.js';
import type { LLMGeneration, StructuredLLMTransport } from './llm.contracts.js';
import { semanticContract } from './llm.semantic-v2.js';
import type { GeminiProviderProfile } from './llm.provider-config.js';
import { auditNativeStream } from './llm.gemini-stream.js';
export class GeminiStreamingTransport implements StructuredLLMTransport {
  readonly kind = 'external' as const;
  readonly name = 'gemini-native-stateless-sse-v2';
  #apiKey: string;
  constructor(
    readonly profile: GeminiProviderProfile,
    private readonly invoke = auditNativeStream,
    private readonly resilience?: ProviderResilience,
    private readonly systemInstructionOverride?: string,
  ) {
    this.#apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
    if (!this.#apiKey) throw Error('GEMINI_API_KEY_REQUIRED');
  }
  async generate(
    stage: 'extraction' | 'relation',
    input: unknown,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<LLMGeneration> {
    if (!this.#apiKey || signal.aborted) throw Error('LLM_ABORTED');
    const attempt = async (): Promise<LLMGeneration> => {
      const r = await this.invoke(
        {
          model: this.profile.config.model,
          input: JSON.stringify(input),
          system_instruction:
            this.systemInstructionOverride ??
            (stage === 'extraction'
              ? semanticContract(this.profile.config).prompt
              : semanticContract(this.profile.config).relationPrompt),
          response_format: { type: 'text', mime_type: 'application/json', schema },
          generation_config: {
            thinking_level: this.profile.thinkingLevel,
            thinking_summaries: 'none',
            max_output_tokens: this.profile.config.maxOutputTokens,
          },
          tools: [],
          store: false,
          background: false,
          stream: true,
        },
        this.#apiKey,
        signal,
        this.profile,
      );
      try {
        if (!r.complete)
          throw new ProviderFailure(
            r.httpStatus !== 200 ? r.httpStatus : null,
            r.httpStatus !== 200 ? 'HTTP' : r.finalStatus === 'completed' ? 'SCHEMA' : 'INCOMPLETE',
          );
        return {
          output: r.parsed,
          usage: {
            inputTokens: r.usage.total_input_tokens,
            outputTokens: r.usage.total_output_tokens,
            totalTokens: r.usage.total_tokens,
            cost: null,
          },
        };
      } finally {
        r.output = '';
        r.parsed = null;
      }
    };
    return this.resilience
      ? (await this.resilience.run([this.profile], attempt, signal)).value
      : attempt();
  }
  dispose(): void {
    this.#apiKey = '';
  }
  toJSON(): object {
    return {
      provider: this.name,
      version: this.profile.config.providerVersion,
      credential: '[REDACTED]',
    };
  }
}
