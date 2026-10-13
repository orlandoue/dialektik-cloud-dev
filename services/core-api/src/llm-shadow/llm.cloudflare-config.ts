import type { LLMConfig } from './llm.contracts.js';
import {
  EXTRACTION_PROMPT,
  EXTRACTION_SCHEMA,
  RELATION_PROMPT,
  RELATION_SCHEMA,
  createLLMConfig,
  sha256,
} from './llm.schema.js';

export const CLOUDFLARE_PROVIDER_TYPE = 'llm_cloudflare_workers_ai' as const;
export const CLOUDFLARE_GLM_FLASH_MODEL = '@cf/zai-org/glm-4.7-flash';
export const CLOUDFLARE_JSON_MODE_MODEL = '@cf/meta/llama-3.1-8b-instruct';
export const CLOUDFLARE_GPT_OSS_20B_MODEL = '@cf/openai/gpt-oss-20b';
export const CLOUDFLARE_SUPPORTED_MODELS = Object.freeze([
  CLOUDFLARE_GLM_FLASH_MODEL,
  CLOUDFLARE_JSON_MODE_MODEL,
  CLOUDFLARE_GPT_OSS_20B_MODEL,
] as const);
export type CloudflareModel = (typeof CLOUDFLARE_SUPPORTED_MODELS)[number];
export type CloudflareOutputMode = 'prompt-schema-v1' | 'workers-json-schema-v1';
export type CloudflareProtocol = 'workers-ai-run-rest-v1' | 'workers-ai-run-responses-v1';

export interface CloudflareProviderProfile {
  readonly config: LLMConfig;
  readonly outputMode: CloudflareOutputMode;
  readonly protocol: CloudflareProtocol;
  readonly maxRequestBytes: number | null;
}

type CloudflareProfileBounds = Partial<
  Pick<LLMConfig, 'maxArticles' | 'maxCalls' | 'timeoutMs' | 'maxOutputTokens'>
> & { readonly maxRequestBytes?: number };

function isCloudflareModel(value: string): value is CloudflareModel {
  return (CLOUDFLARE_SUPPORTED_MODELS as readonly string[]).includes(value);
}

export function createCloudflareProfile(
  model: string = CLOUDFLARE_GLM_FLASH_MODEL,
  bounds: CloudflareProfileBounds = {},
): CloudflareProviderProfile {
  if (!isCloudflareModel(model)) throw new Error('CLOUDFLARE_MODEL_UNSUPPORTED');
  const maxRequestBytes = bounds.maxRequestBytes ?? null;
  if (maxRequestBytes !== null && (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1))
    throw new Error('CLOUDFLARE_REQUEST_BOUND_INVALID');
  const { maxRequestBytes: _maxRequestBytes, ...configBounds } = bounds;
  void _maxRequestBytes;
  const base = createLLMConfig(model, {
    maxArticles: 20,
    maxCalls: 80,
    timeoutMs: 55000,
    ...configBounds,
  });
  const outputMode: CloudflareOutputMode =
    model === CLOUDFLARE_JSON_MODE_MODEL ? 'workers-json-schema-v1' : 'prompt-schema-v1';
  const protocol: CloudflareProtocol =
    model === CLOUDFLARE_GPT_OSS_20B_MODEL
      ? 'workers-ai-run-responses-v1'
      : 'workers-ai-run-rest-v1';
  const semanticConfig = {
    model,
    promptVersion: base.promptVersion,
    schemaVersion: base.schemaVersion,
    retrievalVersion: base.retrievalVersion,
    graphVersion: base.graphVersion,
    maxArticles: base.maxArticles,
    maxCalls: base.maxCalls,
    topK: base.topK,
    timeoutMs: base.timeoutMs,
    maxRetries: base.maxRetries,
    concurrency: base.concurrency,
    maxOutputTokens: base.maxOutputTokens,
    maxRequestBytes,
    reasoningEffort: protocol === 'workers-ai-run-responses-v1' ? 'low' : null,
  };
  const configHash = sha256(
    JSON.stringify({
      semanticConfig,
      prompts: [EXTRACTION_PROMPT, RELATION_PROMPT],
      schemas: [EXTRACTION_SCHEMA, RELATION_SCHEMA],
      provider: CLOUDFLARE_PROVIDER_TYPE,
      protocol,
      outputMode,
      store: false,
      stream: false,
      tools: [],
    }),
  );
  return Object.freeze({
    config: Object.freeze({
      ...base,
      configHash,
      providerVersion: 'product-cloudflare-workers-ai-v1.' + configHash.slice(0, 24),
    }),
    outputMode,
    protocol,
    maxRequestBytes,
  });
}

export function readCloudflareRuntimeProfiles(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly CloudflareProviderProfile[] {
  const model = env.CLOUDFLARE_AI_MODEL?.trim() ?? CLOUDFLARE_GLM_FLASH_MODEL;
  const fallback = env.CLOUDFLARE_AI_FALLBACK_MODEL?.trim();
  if (fallback && fallback === model) throw new Error('LLM_DUPLICATE_PROVIDER_PROFILE');
  if (fallback && !isCloudflareModel(fallback)) throw new Error('CLOUDFLARE_MODEL_UNSUPPORTED');
  return Object.freeze(
    [model, ...(fallback ? [fallback] : [])].map((candidate) => createCloudflareProfile(candidate)),
  );
}
