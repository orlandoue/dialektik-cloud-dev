import { assertLLMActive, isAborted } from './llm.assert.js';
import { present } from './llm.assert.js';
import type {
  LLMConfig,
  LLMGeneration,
  LLMUsage,
  StructuredLLMTransport,
} from './llm.contracts.js';
import { EXTRACTION_PROMPT, RELATION_PROMPT } from './llm.schema.js';
/** Reuses the existing Gemini Interactions REST/env protocol; no evaluation imports or SDK. */
export class GeminiStructuredTransport implements StructuredLLMTransport {
  readonly kind = 'external' as const;
  readonly name = 'gemini';
  #apiKey: string;
  #lastRequest: number | null = null;
  constructor(
    private readonly config: LLMConfig,
    private readonly request: typeof fetch = fetch,
  ) {
    this.#apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
    if (!this.#apiKey) throw new Error('GEMINI_API_KEY_REQUIRED');
  }
  async generate(
    stage: 'extraction' | 'relation',
    input: unknown,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<LLMGeneration> {
    const delay =
      this.#lastRequest === null ? 0 : Math.max(0, 12500 - (performance.now() - this.#lastRequest));
    if (delay)
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('LLM_ABORTED'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, delay);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    assertLLMActive(signal);
    this.#lastRequest = performance.now();
    let response: Response;
    try {
      response = await this.request(
        'https://generativelanguage.googleapis.com/v1beta/interactions',
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-goog-api-key': this.#apiKey,
          },
          body: JSON.stringify({
            model: this.config.model,
            input: JSON.stringify(input),
            system_instruction: stage === 'extraction' ? EXTRACTION_PROMPT : RELATION_PROMPT,
            response_format: { type: 'text', mime_type: 'application/json', schema },
            generation_config: {
              max_output_tokens: this.config.maxOutputTokens,
              seed: 0,
              thinking_level: 'high',
              thinking_summaries: 'none',
            },
            service_tier: 'standard',
            tools: [],
            store: false,
            background: false,
            stream: false,
          }),
        },
      );
    } catch {
      throw new Error(isAborted(signal) ? 'LLM_ABORTED' : 'LLM_TRANSPORT_FAILED');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 429
          ? 'LLM_RATE_LIMIT'
          : response.status === 401 || response.status === 403
            ? 'LLM_CREDENTIAL_REJECTED'
            : response.status === 404
              ? 'LLM_MODEL_UNAVAILABLE'
              : 'LLM_PROVIDER_FAILED',
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('LLM_RESPONSE_INVALID');
    const chunks: Uint8Array[] = [];
    let size = 0;
    let bytes: Buffer | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        chunks.push(value);
        size += value.length;
        if (size > 262144) throw new Error('LLM_RESPONSE_BOUND');
      }
      bytes = Buffer.concat(chunks);
      const payload: unknown = JSON.parse(bytes.toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('LLM_RESPONSE_INVALID');
      const p = payload as Record<string, unknown>;
      if (p.status !== 'completed' || !Array.isArray(p.steps))
        throw new Error('LLM_PROVIDER_INCOMPLETE');
      const output: string[] = [];
      for (const step of p.steps) {
        if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
        const s = step as Record<string, unknown>;
        if (s.type !== 'model_output' || !Array.isArray(s.content)) continue;
        for (const item of s.content) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const c = item as Record<string, unknown>;
            if (c.type === 'text' && typeof c.text === 'string') output.push(c.text);
          }
        }
      }
      if (output.length !== 1 || present(output[0]).includes(this.#apiKey))
        throw new Error('LLM_RESPONSE_INVALID');
      const usage =
        p.usage && typeof p.usage === 'object' && !Array.isArray(p.usage)
          ? (p.usage as Record<string, unknown>)
          : {};
      const count = (key: string): number | null =>
        typeof usage[key] === 'number' && Number.isSafeInteger(usage[key]) && usage[key] >= 0
          ? usage[key]
          : null;
      const safeUsage: LLMUsage = {
        inputTokens: count('total_input_tokens'),
        outputTokens: count('total_output_tokens'),
        totalTokens: count('total_tokens'),
        cost: null,
      };
      assertLLMActive(signal);
      return { output: JSON.parse(present(output[0])) as unknown, usage: safeUsage };
    } catch (error) {
      throw new Error(
        error instanceof Error && /^LLM_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'LLM_RESPONSE_INVALID',
      );
    } finally {
      for (const chunk of chunks) chunk.fill(0);
      bytes?.fill(0);
      await reader.cancel().catch(() => undefined);
    }
  }
  dispose(): void {
    this.#apiKey = '';
  }
  toJSON(): object {
    return { provider: 'gemini', credential: '[REDACTED]' };
  }
}
