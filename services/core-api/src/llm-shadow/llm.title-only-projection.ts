import { createHash } from 'node:crypto';
import type { Insertable } from 'kysely';
import { generateUlid, type EventAnalystTitleOnlyShadowEnvelopeTable } from '@dialektik/database';
import type {
  EventAnalystFactKind,
  EventAnalystProviderInput,
  EventAnalystValidation,
  PreparedEventAnalystInput,
} from './llm.event-analyst.js';
import {
  EVENT_ANALYST_SCHEMA,
  prepareEventAnalystInput,
  validateEventAnalystResult,
} from './llm.event-analyst.js';
import type { LLMGeneration } from './llm.contracts.js';
import type { SemanticEnvelope } from '../ephemeral/ephemeral.contracts.js';

export const TITLE_ONLY_CLOUDFLARE_PROVIDER = 'llm_cloudflare_workers_ai' as const;
export const TITLE_ONLY_GPT_OSS_MODEL = '@cf/openai/gpt-oss-20b' as const;
export const TITLE_ONLY_SCOPE = 'TITLE_ONLY' as const;
const SOURCE_ID = '01M4CQTXP483R30JDW6EJQ6ADQ';
const ARTICLE_ID = '01M4CRBAXJPQEMJVXPKH1EY1N6';
const ARTICLE_VERSION_ID = '01M4CRBAXJX973BQ21979KQJ8W';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export interface TitleOnlyProjectionContext {
  readonly sourceId: string;
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly projectionVersionId: string;
  readonly policyId: string;
  readonly acquiredContentSha256: string;
  readonly normalizedBodySha256: string;
  readonly titleSha256: string;
  readonly projectionPolicyVersion: string;
  readonly projectionSha256: string;
  readonly normalizationVersion: string;
  readonly inputCodepointLength: number;
  readonly titleCodepointLength: number;
  readonly attributionSha256: string;
  readonly schemaSha256: string;
  readonly skillSha256: string;
  readonly acquiredAt: string;
  readonly processedAt: string;
  readonly metadata: Readonly<{
    canonicalUrl: string;
    publisherItemId: string | null;
    publishedAt: string;
    availableAt: string;
    modifiedAt: string | null;
    language: string | null;
  }>;
}

/** The only text field accepted for external inference is the approved title projection. */
export interface TitleOnlyProjectionText {
  readonly title: string;
  readonly language: string | null;
}

export interface TitleOnlyProjectionReceipt {
  readonly runId: string;
  readonly attemptedAt: string;
  readonly provider: typeof TITLE_ONLY_CLOUDFLARE_PROVIDER;
  readonly model: typeof TITLE_ONLY_GPT_OSS_MODEL;
  readonly scope: typeof TITLE_ONLY_SCOPE;
  readonly sourceId: string;
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly projectionVersionId: string;
  readonly projectionSha256: string;
  readonly state: 'ATTEMPT_PENDING' | 'RESPONSE_RECEIVED' | 'UNKNOWN_SENT';
  readonly status:
    | 'PENDING'
    | 'VALIDATED_PERSISTED'
    | 'VALIDATED_EPHEMERAL_ONLY'
    | 'CORE_REJECTED'
    | 'PROVIDER_FAILED';
  readonly attemptCount: 1;
  readonly httpStatus: number | null;
  readonly latencyMs: number | null;
  readonly schemaValid: boolean | null;
  readonly applicability: string | null;
  readonly eventNuggetCount: number | null;
  readonly factCount: number | null;
  readonly groundedFactCount: number | null;
  readonly unsupportedFactCount: number | null;
  readonly validEvidenceReferenceCount: number | null;
  readonly invalidEvidenceReferenceCount: number | null;
  readonly schemaIssueCode: string | null;
  readonly responseEnvelopeVariant: string | null;
  readonly completionStatus: string | null;
  readonly usage: Readonly<{
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  }> | null;
  readonly persistence: 'PERSISTED' | 'NOT_AUTHORIZED' | 'NOT_APPLICABLE';
  readonly errorCategory: string | null;
  readonly realNewsBodyTransmitted: false;
  readonly bodyPersisted: false;
  readonly promptPersisted: false;
  readonly rawResponsePersisted: false;
  readonly liveAuthority: 'UNASSIGNED';
  readonly v10_11Executions: 0;
  readonly finalHoldoutExecutions: 0;
}

export interface TitleOnlyProjectionReceiptWriter {
  writePending(receipt: TitleOnlyProjectionReceipt): Promise<void>;
  writeCompleted(receipt: TitleOnlyProjectionReceipt): Promise<void>;
}

export interface TitleOnlyProjectionAuthorization {
  isAllowed(
    scope: 'EXTERNAL_INFERENCE' | 'DERIVED_SHADOW_PERSISTENCE',
    context: TitleOnlyProjectionContext,
  ): Promise<boolean>;
  reserveAttempt(context: TitleOnlyProjectionContext, runId: string): Promise<boolean>;
  recordAttemptOutcome(
    context: TitleOnlyProjectionContext,
    runId: string,
    outcome: Readonly<{
      state: 'RESPONSE_RECEIVED' | 'UNKNOWN_SENT';
      httpStatus: number | null;
      latencyMs: number;
      errorCategory: string | null;
    }>,
  ): Promise<void>;
}

export interface TitleOnlyProjectionPersistence {
  persist(envelope: TitleOnlySemanticEnvelope, validated: EventAnalystValidation): Promise<void>;
}

export interface TitleOnlySemanticEnvelope extends SemanticEnvelope {
  readonly titleOnlyScope: typeof TITLE_ONLY_SCOPE;
  readonly projectionVersionId: string;
  readonly projectionSha256: string;
  readonly attributionSha256: string;
  readonly schemaSha256: string;
  readonly skillSha256: string;
  readonly eventAnalyst: EventAnalystValidation;
}

export interface TitleOnlyProjectionProvider {
  readonly provider: string;
  readonly model: string;
  readonly providerConfigVersion: string;
  generateDetailed(
    input: EventAnalystProviderInput,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<LLMGeneration>;
}

export interface RunTitleOnlyProjectionDependencies {
  readonly provider: TitleOnlyProjectionProvider;
  readonly authorization: TitleOnlyProjectionAuthorization;
  readonly persistence: TitleOnlyProjectionPersistence;
  readonly receipts: TitleOnlyProjectionReceiptWriter;
  readonly now?: () => string;
  readonly createRunId?: () => string;
}

export interface RunTitleOnlyProjectionResult {
  readonly receipt: TitleOnlyProjectionReceipt;
  readonly persisted: boolean;
}

function assertClosedKeys(value: unknown, allowed: readonly string[], code: string): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== [...allowed].sort().join('\0')
  )
    throw new Error(code);
}

function assertContext(context: TitleOnlyProjectionContext): void {
  if (
    context.sourceId !== SOURCE_ID ||
    context.articleId !== ARTICLE_ID ||
    context.articleVersionId !== ARTICLE_VERSION_ID ||
    !/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(context.projectionVersionId) ||
    !/^[0-9a-f]{64}$/u.test(context.policyId) ||
    !/^[0-9a-f]{64}$/u.test(context.acquiredContentSha256) ||
    !/^[0-9a-f]{64}$/u.test(context.normalizedBodySha256) ||
    !/^[0-9a-f]{64}$/u.test(context.titleSha256) ||
    context.projectionPolicyVersion !== 'rsh-institutional-event-only-v1' ||
    !/^[0-9a-f]{64}$/u.test(context.projectionSha256) ||
    !/^[0-9a-f]{64}$/u.test(context.attributionSha256) ||
    !/^[0-9a-f]{64}$/u.test(context.schemaSha256) ||
    !/^[0-9a-f]{64}$/u.test(context.skillSha256) ||
    !Number.isSafeInteger(context.inputCodepointLength) ||
    context.inputCodepointLength < 1 ||
    !Number.isSafeInteger(context.titleCodepointLength) ||
    context.titleCodepointLength < 1 ||
    !Number.isFinite(Date.parse(context.acquiredAt)) ||
    !Number.isFinite(Date.parse(context.processedAt))
  )
    throw new Error('TITLE_ONLY_PROJECTION_IDENTITY_INVALID');
}

function prepareTitleOnlyInput(
  projection: TitleOnlyProjectionText,
  context: TitleOnlyProjectionContext,
): PreparedEventAnalystInput {
  assertClosedKeys(projection, ['title', 'language'], 'TITLE_ONLY_PROJECTION_TEXT_SHAPE_INVALID');
  if (
    typeof projection.title !== 'string' ||
    !projection.title.trim() ||
    Array.from(projection.title).length !== context.titleCodepointLength ||
    sha256(projection.title) !== context.titleSha256 ||
    !(projection.language === null || /^[A-Za-z][A-Za-z0-9-]{0,34}$/u.test(projection.language))
  )
    throw new Error('TITLE_ONLY_PROJECTION_HASH_MISMATCH');
  const articleVersion = context.articleVersionId;
  const prepared = prepareEventAnalystInput({
    articleVersion,
    title: projection.title,
    body: '',
    language: projection.language,
  });
  if (prepared.blocks.length !== 1) throw new Error('TITLE_ONLY_CITABLE_BLOCK_INVALID');
  const onlyTitleBlock = prepared.blocks[0];
  if (
    onlyTitleBlock?.block_id !== 'B001' ||
    onlyTitleBlock.field !== 'title' ||
    onlyTitleBlock.start_offset !== 0 ||
    onlyTitleBlock.end_offset !== context.titleCodepointLength
  )
    throw new Error('TITLE_ONLY_CITABLE_BLOCK_INVALID');
  return prepared;
}

function receiptBase(
  context: TitleOnlyProjectionContext,
  runId: string,
  attemptedAt: string,
  state: TitleOnlyProjectionReceipt['state'],
  status: TitleOnlyProjectionReceipt['status'],
): TitleOnlyProjectionReceipt {
  return Object.freeze({
    runId,
    attemptedAt,
    provider: TITLE_ONLY_CLOUDFLARE_PROVIDER,
    model: TITLE_ONLY_GPT_OSS_MODEL,
    scope: TITLE_ONLY_SCOPE,
    sourceId: context.sourceId,
    articleId: context.articleId,
    articleVersionId: context.articleVersionId,
    projectionVersionId: context.projectionVersionId,
    projectionSha256: context.projectionSha256,
    state,
    status,
    attemptCount: 1,
    httpStatus: null,
    latencyMs: null,
    schemaValid: null,
    applicability: null,
    eventNuggetCount: null,
    factCount: null,
    groundedFactCount: null,
    unsupportedFactCount: null,
    validEvidenceReferenceCount: null,
    invalidEvidenceReferenceCount: null,
    schemaIssueCode: null,
    responseEnvelopeVariant: null,
    completionStatus: null,
    usage: null,
    persistence: 'NOT_APPLICABLE',
    errorCategory: null,
    realNewsBodyTransmitted: false,
    bodyPersisted: false,
    promptPersisted: false,
    rawResponsePersisted: false,
    liveAuthority: 'UNASSIGNED',
    v10_11Executions: 0,
    finalHoldoutExecutions: 0,
  });
}

function makeEnvelope(
  context: TitleOnlyProjectionContext,
  projection: TitleOnlyProjectionText,
  prepared: PreparedEventAnalystInput,
  provider: TitleOnlyProjectionProvider,
  providerRunId: string,
  validation: EventAnalystValidation,
): TitleOnlySemanticEnvelope {
  const evidence = prepared.blocks.map((block) =>
    Object.freeze({
      field: 'title' as const,
      start: block.start_offset,
      end: block.end_offset,
      sourceSha256: context.titleSha256,
      spanSha256: block.block_hash,
      articleVersionId: context.articleVersionId,
      acquiredContentHash: context.acquiredContentSha256,
      normalizedInputHash: context.normalizedBodySha256,
      normalizationVersion: context.normalizationVersion,
      providerRunId,
      retainedQuote: null,
    }),
  );
  const metadata = Object.freeze({
    articleId: context.articleId,
    articleVersionId: context.articleVersionId,
    sourceId: context.sourceId,
    canonicalUrl: context.metadata.canonicalUrl,
    publisherItemId: context.metadata.publisherItemId,
    publishedAt: context.metadata.publishedAt,
    availableAt: context.metadata.availableAt,
    modifiedAt: context.metadata.modifiedAt,
    acquiredAt: context.acquiredAt,
    language: projection.language,
    title: projection.title,
    contentEncoding: 'utf-8' as const,
  });
  return Object.freeze({
    authority: 'SHADOW_NOT_AUTHORITATIVE',
    metadata,
    accessMode: 'FULLTEXT_EPHEMERAL',
    policyId: context.policyId,
    acquiredContentHash: context.acquiredContentSha256,
    normalizedInput: Object.freeze({
      inputHash: context.normalizedBodySha256,
      titleHash: context.titleSha256,
      bodyCodepoints: context.inputCodepointLength,
      titleCodepoints: context.titleCodepointLength,
      normalizationVersion: context.normalizationVersion,
      offsetConvention: 'unicode_code_point_v1',
    }),
    provider: Object.freeze({
      providerType: TITLE_ONLY_CLOUDFLARE_PROVIDER,
      providerVersion: provider.providerConfigVersion,
      candidateCommit: null,
    }),
    providerRunId,
    processedAt: context.processedAt,
    reproducibilityClass: 'HASH_VERIFIABLE_REFETCH_REQUIRED',
    evidence: Object.freeze(evidence),
    observations: Object.freeze([]),
    titleOnlyScope: TITLE_ONLY_SCOPE,
    projectionVersionId: context.projectionVersionId,
    projectionSha256: context.projectionSha256,
    attributionSha256: context.attributionSha256,
    schemaSha256: context.schemaSha256,
    skillSha256: context.skillSha256,
    eventAnalyst: validation,
  });
}

export async function runTitleOnlyProjectionShadow(
  context: TitleOnlyProjectionContext,
  projection: TitleOnlyProjectionText,
  skillInstruction: string,
  dependencies: RunTitleOnlyProjectionDependencies,
  signal = new AbortController().signal,
): Promise<RunTitleOnlyProjectionResult> {
  assertClosedKeys(
    context,
    [
      'sourceId',
      'articleId',
      'articleVersionId',
      'projectionVersionId',
      'policyId',
      'acquiredContentSha256',
      'normalizedBodySha256',
      'titleSha256',
      'projectionPolicyVersion',
      'projectionSha256',
      'normalizationVersion',
      'inputCodepointLength',
      'titleCodepointLength',
      'attributionSha256',
      'schemaSha256',
      'skillSha256',
      'acquiredAt',
      'processedAt',
      'metadata',
    ],
    'TITLE_ONLY_CONTEXT_SHAPE_INVALID',
  );
  assertClosedKeys(
    context.metadata,
    ['canonicalUrl', 'publisherItemId', 'publishedAt', 'availableAt', 'modifiedAt', 'language'],
    'TITLE_ONLY_METADATA_SHAPE_INVALID',
  );
  assertContext(context);
  if (
    dependencies.provider.provider !== TITLE_ONLY_CLOUDFLARE_PROVIDER ||
    dependencies.provider.model !== TITLE_ONLY_GPT_OSS_MODEL ||
    !dependencies.provider.providerConfigVersion.startsWith('product-cloudflare-workers-ai-v1.') ||
    !skillInstruction.trim() ||
    sha256(JSON.stringify(EVENT_ANALYST_SCHEMA)) !== context.schemaSha256 ||
    sha256(skillInstruction) !== context.skillSha256
  )
    throw new Error('TITLE_ONLY_PROVIDER_OR_SKILL_CONFIGURATION_MISMATCH');
  const prepared = prepareTitleOnlyInput(projection, context);
  if (!(await dependencies.authorization.isAllowed('EXTERNAL_INFERENCE', context)))
    throw new Error('TITLE_ONLY_EXTERNAL_INFERENCE_GRANT_REQUIRED');

  const runId = (dependencies.createRunId ?? (() => generateUlid({ now: Date.now })))();
  if (!/^[A-Za-z0-9-]{16,64}$/u.test(runId)) throw new Error('TITLE_ONLY_RUN_ID_INVALID');
  const attemptedAt = (dependencies.now ?? (() => new Date().toISOString()))();
  if (!Number.isFinite(Date.parse(attemptedAt)))
    throw new Error('TITLE_ONLY_ATTEMPT_TIMESTAMP_INVALID');
  if (!(await dependencies.authorization.reserveAttempt(context, runId)))
    throw new Error('TITLE_ONLY_AUTHORIZED_ATTEMPT_RESERVATION_FAILED');
  let receipt = receiptBase(context, runId, attemptedAt, 'ATTEMPT_PENDING', 'PENDING');
  // A durable reservation precedes the only provider call. Failure to write it aborts before inference.
  await dependencies.receipts.writePending(receipt);
  const startedAt = performance.now();
  let generation: LLMGeneration;
  try {
    generation = await dependencies.provider.generateDetailed(
      prepared.providerInput,
      EVENT_ANALYST_SCHEMA,
      signal,
    );
  } catch (error) {
    receipt = Object.freeze({
      ...receipt,
      state: 'UNKNOWN_SENT',
      status: 'PROVIDER_FAILED',
      latencyMs: Math.round(performance.now() - startedAt),
      errorCategory:
        error instanceof Error && /^LLM_[A-Z_]+$/u.test(error.message)
          ? error.message
          : 'LLM_PROVIDER_FAILED',
    });
    await dependencies.authorization.recordAttemptOutcome(context, runId, {
      state: 'UNKNOWN_SENT',
      httpStatus: null,
      latencyMs: receipt.latencyMs ?? 0,
      errorCategory: receipt.errorCategory ?? 'LLM_PROVIDER_FAILED',
    });
    await dependencies.receipts.writeCompleted(receipt);
    return Object.freeze({ receipt, persisted: false });
  }

  await dependencies.authorization.recordAttemptOutcome(context, runId, {
    state: 'RESPONSE_RECEIVED',
    httpStatus: generation.httpStatus ?? null,
    latencyMs: generation.elapsedMs ?? Math.round(performance.now() - startedAt),
    errorCategory: null,
  });
  const validation = validateEventAnalystResult(generation.output, prepared);
  const coreValid =
    validation.schemaValid && validation.blockSetValid && validation.invalidBlockRefs === 0;
  let persisted = false;
  let status: TitleOnlyProjectionReceipt['status'] = coreValid
    ? 'VALIDATED_EPHEMERAL_ONLY'
    : 'CORE_REJECTED';
  let persistence: TitleOnlyProjectionReceipt['persistence'] = 'NOT_APPLICABLE';
  if (coreValid) {
    if (await dependencies.authorization.isAllowed('DERIVED_SHADOW_PERSISTENCE', context)) {
      const envelope = makeEnvelope(
        context,
        projection,
        prepared,
        dependencies.provider,
        runId,
        validation,
      );
      await dependencies.persistence.persist(envelope, validation);
      persisted = true;
      status = 'VALIDATED_PERSISTED';
      persistence = 'PERSISTED';
    } else {
      persistence = 'NOT_AUTHORIZED';
    }
  }
  const diagnostics = generation.providerDiagnostics;
  receipt = Object.freeze({
    ...receipt,
    state: 'RESPONSE_RECEIVED',
    status,
    httpStatus: generation.httpStatus ?? null,
    latencyMs: generation.elapsedMs ?? Math.round(performance.now() - startedAt),
    schemaValid: validation.schemaValid,
    applicability: validation.applicability,
    eventNuggetCount: validation.eventNuggets.length,
    factCount: validation.factCount,
    groundedFactCount: validation.supportedDirect + validation.supportedNormalized,
    unsupportedFactCount: validation.unsupportedFacts,
    validEvidenceReferenceCount: validation.validEvidenceRefs,
    invalidEvidenceReferenceCount: validation.invalidBlockRefs,
    schemaIssueCode: validation.issueCodes[0] ?? null,
    responseEnvelopeVariant: diagnostics?.responseEnvelopeVariant ?? null,
    completionStatus: diagnostics?.completionStatus ?? null,
    usage: Object.freeze({
      inputTokens: generation.usage.inputTokens,
      outputTokens: generation.usage.outputTokens,
      totalTokens: generation.usage.totalTokens,
    }),
    persistence,
    errorCategory: coreValid ? null : (validation.issueCodes[0] ?? 'CORE_VALIDATION_FAILED'),
  });
  await dependencies.receipts.writeCompleted(receipt);
  return Object.freeze({ receipt, persisted });
}

export function titleOnlyPersistenceValues(input: {
  readonly envelope: TitleOnlySemanticEnvelope;
  readonly validation: EventAnalystValidation;
  readonly id: string;
  readonly recordedAt: string;
  readonly schemaSha256: string;
  readonly skillSha256: string;
}): Insertable<EventAnalystTitleOnlyShadowEnvelopeTable> {
  const { envelope, validation } = input;
  const facts = validation.eventNuggets.flatMap((nugget) =>
    nugget.facts
      .filter((fact) => fact.enteringObservation)
      .map((fact) => ({
        kind: fact.kind,
        valueSha256: sha256(fact.value),
        evidenceBlockIds: [...fact.evidenceBlockIds],
        support: fact.support,
        normalizedTime: fact.normalizedTime,
      })),
  );
  const semanticDerivatives = Object.freeze({
    eventCandidate:
      validation.eventCandidate === null || validation.eventCandidate === 'UNCERTAIN'
        ? 'UNCERTAIN'
        : validation.eventCandidate
          ? 'TRUE'
          : 'FALSE',
    missingOrUncertainCount: validation.missingOrUncertain.length,
    facts,
  });
  const evidenceLocators = Object.freeze(
    envelope.evidence.map((item) => ({
      blockId: 'B001',
      field: item.field,
      start: item.start,
      end: item.end,
      sourceSha256: item.sourceSha256,
      spanSha256: item.spanSha256,
    })),
  );
  const row = {
    id: input.id,
    source_id: envelope.metadata.sourceId,
    article_id: envelope.metadata.articleId,
    article_version_id: envelope.metadata.articleVersionId,
    projection_version_id: envelope.projectionVersionId,
    provider_run_id: envelope.providerRunId,
    provider_type: TITLE_ONLY_CLOUDFLARE_PROVIDER,
    model_id: TITLE_ONLY_GPT_OSS_MODEL,
    projection_policy_version: 'rsh-institutional-event-only-v1',
    acquired_content_sha256: envelope.acquiredContentHash,
    projection_sha256: envelope.projectionSha256,
    title_sha256: envelope.normalizedInput.titleHash,
    schema_sha256: input.schemaSha256,
    skill_sha256: input.skillSha256,
    derivative_sha256: sha256(JSON.stringify(semanticDerivatives)),
    event_candidate: semanticDerivatives.eventCandidate,
    applicability: validation.applicability,
    event_nugget_count: validation.eventNuggets.length,
    fact_count: validation.factCount,
    grounded_fact_count: facts.length,
    unsupported_fact_count: validation.unsupportedFacts,
    valid_evidence_reference_count: validation.validEvidenceRefs,
    invalid_evidence_reference_count: validation.invalidBlockRefs,
    semantic_derivatives: JSON.stringify(semanticDerivatives),
    evidence_locators: JSON.stringify(evidenceLocators),
    recorded_at: input.recordedAt,
  };
  return row as Insertable<EventAnalystTitleOnlyShadowEnvelopeTable>;
}

export type TitleOnlySemanticFactKind = EventAnalystFactKind;
