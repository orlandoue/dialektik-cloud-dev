import { createGeminiV2Profile } from './llm.provider-config.js';
import { createCloudflareProfile } from './llm.cloudflare-config.js';
import type { EphemeralArticleContent } from '../ephemeral/ephemeral.content.js';
import type { EphemeralProcessingRequest } from '../ephemeral/ephemeral.contracts.js';
import type { GroundedFact, LLMEnvelopeExtension, VerifiedExtraction } from './llm.contracts.js';
import { FACT_ROLES, OBSERVATION_STATUSES } from './llm.contracts.js';
import { createLLMConfig, sha256 } from './llm.schema.js';
import { exactObject } from './llm.grounding.js';
export function verifyLLMEnvelope(
  raw: unknown,
  content: EphemeralArticleContent,
  request: EphemeralProcessingRequest,
): LLMEnvelopeExtension {
  const v = exactObject(raw, [
    'mode',
    'config',
    'route',
    'extraction',
    'relations',
    'outputHash',
    'cacheKey',
    'usage',
    'evidenceVerification',
  ]);
  if (
    v.mode !== 'LLM_SEMANTIC_SHADOW' ||
    v.evidenceVerification !== 'VERIFIED' ||
    !['EXTERNAL_LLM_PROCESSING_ALLOWED', 'LOCAL_ONLY_PROCESSING'].includes(String(v.route))
  )
    throw new Error('MAPPING_FAILED');
  const quoteV2 =
    v.config !== null &&
    typeof v.config === 'object' &&
    'schemaVersion' in v.config &&
    v.config.schemaVersion === 'product-llm-schema-v2';
  const config = exactObject(v.config, [
    'model',
    'providerVersion',
    'configHash',
    'promptVersion',
    'schemaVersion',
    ...(quoteV2 ? ['evidenceResolverVersion'] : []),
    'retrievalVersion',
    'graphVersion',
    'maxArticles',
    'maxCalls',
    'topK',
    'timeoutMs',
    'maxRetries',
    'concurrency',
    'maxOutputTokens',
  ]);
  if (
    typeof config.model !== 'string' ||
    typeof config.maxArticles !== 'number' ||
    typeof config.maxCalls !== 'number' ||
    typeof config.topK !== 'number' ||
    typeof config.timeoutMs !== 'number'
  )
    throw new Error('MAPPING_FAILED');
  const bounds = {
    maxArticles: config.maxArticles,
    maxCalls: config.maxCalls,
    topK: config.topK,
    timeoutMs: config.timeoutMs,
  };
  const model = config.model;
  const cloudflareV1 =
    typeof config.providerVersion === 'string' &&
    config.providerVersion.startsWith('product-cloudflare-workers-ai-v1.');
  const expected = quoteV2
    ? (['minimal', 'low', 'medium', 'high'] as const)
        .map((level) => createGeminiV2Profile(model, level, bounds).config)
        .find((c) => c.configHash === config.configHash)
    : cloudflareV1
      ? createCloudflareProfile(model, {
          maxArticles: config.maxArticles,
          maxCalls: config.maxCalls,
          timeoutMs: config.timeoutMs,
        }).config
      : createLLMConfig(model, bounds);
  if (!expected || Object.entries(expected).some(([k, x]) => config[k] !== x))
    throw new Error('MAPPING_FAILED');
  const e = exactObject(v.extraction, ['status', 'boundedOccurrence', 'boundedThread', 'facts']);
  if (
    !OBSERVATION_STATUSES.includes(e.status as VerifiedExtraction['status']) ||
    typeof e.boundedOccurrence !== 'boolean' ||
    typeof e.boundedThread !== 'boolean' ||
    !Array.isArray(e.facts) ||
    e.facts.length > 12
  )
    throw new Error('MAPPING_FAILED');
  const facts = e.facts.map((rawFact): GroundedFact => {
    const f = exactObject(rawFact, [
      'id',
      'role',
      'valueHash',
      'retrievalHash',
      'evidence',
      'isoDate',
    ]);
    const locator = exactObject(f.evidence, [
      'field',
      'start',
      'end',
      'sourceSha256',
      'spanSha256',
    ]);
    if (
      typeof f.id !== 'string' ||
      !/^f[0-9]{1,2}$/.test(f.id) ||
      !FACT_ROLES.includes(f.role as GroundedFact['role']) ||
      typeof f.valueHash !== 'string' ||
      typeof f.retrievalHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.retrievalHash) ||
      typeof locator.start !== 'number' ||
      typeof locator.end !== 'number' ||
      !(locator.field === 'title' || locator.field === 'body') ||
      typeof locator.sourceSha256 !== 'string' ||
      typeof locator.spanSha256 !== 'string' ||
      f.valueHash !== locator.spanSha256 ||
      f.isoDate !== null
    )
      throw new Error('MAPPING_FAILED');
    const evidence: GroundedFact['evidence'] = {
      field: locator.field,
      start: locator.start,
      end: locator.end,
      sourceSha256: locator.sourceSha256,
      spanSha256: locator.spanSha256,
    };
    content.verifyLocator(evidence);
    content.verifyLLMFactFingerprint(evidence, String(f.role), f.retrievalHash);
    return Object.freeze({
      id: f.id,
      role: f.role as GroundedFact['role'],
      valueHash: f.valueHash,
      retrievalHash: f.retrievalHash,
      evidence: Object.freeze(evidence),
      isoDate: null,
    });
  });
  if (
    new Set(facts.map((f) => f.id)).size !== facts.length ||
    (!e.boundedOccurrence && facts.length && e.status === 'OBSERVATION_AVAILABLE')
  )
    throw new Error('MAPPING_FAILED');
  if (
    typeof v.outputHash !== 'string' ||
    !/^([a-f0-9]{64})$/.test(v.outputHash) ||
    v.outputHash !== sha256(JSON.stringify({ extraction: v.extraction, relations: v.relations })) ||
    typeof v.cacheKey !== 'string' ||
    v.cacheKey !==
      sha256(
        JSON.stringify([
          expected.configHash,
          content.normalizedInput.inputHash,
          content.normalizedInput.titleHash,
        ]),
      )
  )
    throw new Error('MAPPING_FAILED');
  const usage = exactObject(v.usage, ['inputTokens', 'outputTokens', 'totalTokens', 'cost']);
  if (
    usage.cost !== null ||
    ['inputTokens', 'outputTokens', 'totalTokens'].some(
      (k) =>
        usage[k] !== null &&
        (typeof usage[k] !== 'number' ||
          !Number.isSafeInteger(usage[k]) ||
          usage[k] < 0 ||
          usage[k] > 1000000000),
    )
  )
    throw new Error('MAPPING_FAILED');
  if (!Array.isArray(v.relations) || v.relations.length > expected.topK)
    throw new Error('MAPPING_FAILED');
  // Relation support on the other Article is also checked against immutable envelopes by PostgreSQL.
  for (const r of v.relations) {
    const relation = exactObject(r, [
      'decision',
      'occurrence',
      'thread',
      'leftFacts',
      'rightFacts',
      'targetArticleId',
      'targetVersionId',
    ]);
    if (
      ![
        'SAME_OCCURRENCE',
        'DIFFERENT_OCCURRENCE_SAME_THREAD',
        'DIFFERENT_THREAD',
        'UNKNOWN',
        'NOT_APPLICABLE',
      ].includes(String(relation.decision)) ||
      !['SAME', 'DISTINCT', 'UNKNOWN', 'NOT_APPLICABLE'].includes(String(relation.occurrence)) ||
      !['SAME', 'DISTINCT', 'UNKNOWN', 'NOT_APPLICABLE'].includes(String(relation.thread)) ||
      !Array.isArray(relation.leftFacts) ||
      !Array.isArray(relation.rightFacts) ||
      relation.leftFacts.length > 12 ||
      relation.rightFacts.length > 12 ||
      relation.leftFacts.some((id) => !facts.some((f) => f.id === id)) ||
      typeof relation.targetArticleId !== 'string' ||
      typeof relation.targetVersionId !== 'string' ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(relation.targetArticleId) ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(relation.targetVersionId) ||
      relation.targetArticleId === request.metadata.articleId
    )
      throw new Error('MAPPING_FAILED');
  }
  return Object.freeze({
    ...v,
    config: expected,
    extraction: Object.freeze({
      status: e.status,
      boundedOccurrence: e.boundedOccurrence,
      boundedThread: e.boundedThread,
      facts: Object.freeze(facts),
    }),
  }) as unknown as LLMEnvelopeExtension;
}

/**
 * Persist excerpt-backed body evidence under the rights-aware excerpt label.
 * The provider-facing body locator was verified against transient input; this
 * changes only the durable fingerprint field and its envelope hash.
 */
export function bindLLMEvidenceToAccessMode(
  envelope: LLMEnvelopeExtension,
  accessMode: 'METADATA_ONLY' | 'EXCERPT_EPHEMERAL' | 'FULLTEXT_EPHEMERAL' | 'FULLTEXT_PERSISTED',
): LLMEnvelopeExtension {
  if (accessMode !== 'EXCERPT_EPHEMERAL') return envelope;
  const hasBodyEvidence = envelope.extraction.facts.some((fact) => fact.evidence.field === 'body');
  if (!hasBodyEvidence) return envelope;
  const extraction = Object.freeze({
    ...envelope.extraction,
    facts: Object.freeze(
      envelope.extraction.facts.map((fact) => {
        if (fact.evidence.field !== 'body') return fact;
        return Object.freeze({
          ...fact,
          evidence: Object.freeze({ ...fact.evidence, field: 'excerpt' as const }),
        });
      }),
    ),
  });
  return Object.freeze({
    ...envelope,
    extraction,
    outputHash: sha256(JSON.stringify({ extraction, relations: envelope.relations })),
  });
}
