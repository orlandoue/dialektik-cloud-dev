import {
  PROMPT_VERSION_V2,
  SCHEMA_VERSION_V2,
  EVIDENCE_RESOLVER_VERSION,
  EXTRACTION_PROMPT_V2,
  EXTRACTION_SCHEMA_V2,
} from './llm.semantic-v2.js';
import type { LLMConfig } from './llm.contracts.js';
import { createLLMConfig, sha256 } from './llm.schema.js';
export interface GeminiProviderProfile {
  readonly config: LLMConfig;
  readonly thinkingLevel: 'minimal' | 'low' | 'medium' | 'high';
  readonly protocol: 'native-stateless-structured-sse-v2';
}
export function createGeminiProfile(
  model: string,
  thinkingLevel: GeminiProviderProfile['thinkingLevel'] = 'minimal',
  bounds: Partial<Pick<LLMConfig, 'maxArticles' | 'maxCalls' | 'timeoutMs'>> = {},
): GeminiProviderProfile {
  if (!['minimal', 'low', 'medium', 'high'].includes(thinkingLevel))
    throw Error('LLM_PROVIDER_CONFIG_INVALID');
  const base = createLLMConfig(model, {
    maxArticles: 20,
    maxCalls: 80,
    timeoutMs: 55000,
    ...bounds,
  });
  const protocol = 'native-stateless-structured-sse-v2' as const;
  const configHash = sha256(
    JSON.stringify({
      semanticConfigHash: base.configHash,
      model,
      thinkingLevel,
      maxOutputTokens: 1024,
      protocol,
      store: false,
      background: false,
      stream: true,
      tools: [],
    }),
  );
  return Object.freeze({
    config: Object.freeze({
      ...base,
      maxOutputTokens: 1024,
      configHash,
      providerVersion: 'product-gemini-runtime-v2.' + configHash.slice(0, 24),
    }),
    thinkingLevel,
    protocol,
  });
}
export function readGeminiRuntimeProfiles(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const contract = env.DIALEKTIK_GEMINI_SEMANTIC_CONTRACT ?? 'v1';
  if (!['v1', 'v2'].includes(contract)) throw Error('LLM_SEMANTIC_CONFIG_INVALID');
  const create = contract === 'v2' ? createGeminiV2Profile : createGeminiProfile;
  const model = env.DIALEKTIK_GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
  const level = env.DIALEKTIK_GEMINI_THINKING_LEVEL ?? 'minimal';
  if (!['minimal', 'low', 'medium', 'high'].includes(level))
    throw Error('LLM_PROVIDER_CONFIG_INVALID');
  const fallback = env.DIALEKTIK_GEMINI_FALLBACK_MODEL;
  if (fallback === model) throw Error('LLM_DUPLICATE_PROVIDER_PROFILE');
  return Object.freeze(
    [model, ...(fallback ? [fallback] : [])].map((m) =>
      create(m, level as GeminiProviderProfile['thinkingLevel']),
    ),
  );
}

/** Explicit opt-in contract repair; V1 identities remain byte-compatible. */
export function createGeminiV2Profile(
  model: string,
  thinkingLevel: GeminiProviderProfile['thinkingLevel'] = 'minimal',
  bounds: Partial<Pick<LLMConfig, 'maxArticles' | 'maxCalls' | 'timeoutMs'>> = {},
): GeminiProviderProfile {
  const profile = createGeminiProfile(model, thinkingLevel, bounds);
  const contract = {
    promptVersion: PROMPT_VERSION_V2,
    schemaVersion: SCHEMA_VERSION_V2,
    evidenceResolverVersion: EVIDENCE_RESOLVER_VERSION,
  };
  const configHash = sha256(
    JSON.stringify({
      runtime: profile.config.configHash,
      ...contract,
      prompt: EXTRACTION_PROMPT_V2,
      schema: EXTRACTION_SCHEMA_V2,
    }),
  );
  return Object.freeze({
    ...profile,
    config: Object.freeze({
      ...profile.config,
      ...contract,
      configHash,
      providerVersion: 'product-gemini-runtime-v3.' + configHash.slice(0, 24),
    }),
  });
}
