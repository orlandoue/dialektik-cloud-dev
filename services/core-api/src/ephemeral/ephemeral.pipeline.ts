import type {
  ContentAccessPolicy,
  EphemeralPipelineDependencies,
  EphemeralProcessingRequest,
  EphemeralSafeLog,
  SemanticEnvelope,
  SemanticProcessingState,
  SemanticProcessingErrorCode,
} from './ephemeral.contracts';
import { EphemeralArticleContent } from './ephemeral.content';
import { assertOriginalMetadata, sha256Bytes } from './ephemeral.normalization';
import { assertProviderIdentity, mapEphemeralProviderOutput } from './ephemeral.provider';
import { bindLLMEvidenceToAccessMode } from '../llm-shadow/llm.envelope.js';

const rightsKeys = [
  'metadataStorage',
  'excerptStorage',
  'fulltextAcquisition',
  'fulltextMachineProcessing',
  'fulltextPersistence',
  'derivedSemanticPersistence',
  'minimalEvidenceFragment',
  'redisplay',
  'externalSourceLink',
] as const;
export function assertFulltextProcessingRights(
  policy: ContentAccessPolicy,
  sourceId: string,
): void {
  if (
    !policy.active ||
    !policy.policyId ||
    policy.sourceId !== sourceId ||
    !['METADATA_ONLY', 'EXCERPT_EPHEMERAL', 'FULLTEXT_EPHEMERAL', 'FULLTEXT_PERSISTED'].includes(
      policy.accessMode,
    ) ||
    rightsKeys.some((key) => typeof policy.rights[key] !== 'boolean') ||
    !Number.isSafeInteger(policy.evidenceMaxCodepoints) ||
    policy.evidenceMaxCodepoints < 0 ||
    (!policy.rights.minimalEvidenceFragment && policy.evidenceMaxCodepoints !== 0) ||
    policy.accessMode === 'METADATA_ONLY' ||
    !policy.rights.metadataStorage ||
    !policy.rights.derivedSemanticPersistence ||
    (policy.accessMode === 'EXCERPT_EPHEMERAL'
      ? !policy.rights.excerptStorage ||
        policy.rights.localProcessing !== true ||
        policy.rights.fulltextAcquisition ||
        policy.rights.fulltextMachineProcessing ||
        policy.rights.fulltextPersistence
      : !policy.rights.fulltextAcquisition ||
        !policy.rights.fulltextMachineProcessing ||
        (policy.accessMode === 'FULLTEXT_PERSISTED' && !policy.rights.fulltextPersistence))
  )
    throw new Error('RIGHTS_DENIED');
}
function durableMetadata(
  metadata: EphemeralProcessingRequest['metadata'],
): EphemeralProcessingRequest['metadata'] {
  return Object.freeze({
    articleId: metadata.articleId,
    articleVersionId: metadata.articleVersionId,
    sourceId: metadata.sourceId,
    canonicalUrl: metadata.canonicalUrl,
    publisherItemId: metadata.publisherItemId,
    publishedAt: metadata.publishedAt,
    availableAt: metadata.availableAt,
    modifiedAt: metadata.modifiedAt,
    acquiredAt: metadata.acquiredAt,
    language: metadata.language,
    title: metadata.title,
    contentEncoding: metadata.contentEncoding,
  });
}
function durableProvider(
  provider: EphemeralPipelineDependencies['provider']['identity'],
): EphemeralPipelineDependencies['provider']['identity'] {
  return Object.freeze({
    providerType: provider.providerType,
    providerVersion: provider.providerVersion,
    candidateCommit: provider.candidateCommit,
    ...(provider.runtime === undefined
      ? {}
      : {
          runtime: Object.freeze({
            python: provider.runtime.python,
            model: provider.runtime.model,
          }),
        }),
  });
}

function safeLog(dependencies: EphemeralPipelineDependencies, event: EphemeralSafeLog): void {
  try {
    dependencies.log?.(Object.freeze(event));
  } catch {
    /* Never forward logger exceptions or content. */
  }
}
class EphemeralStageError extends Error {
  constructor(readonly code: SemanticProcessingErrorCode) {
    super(code);
  }
}
async function boundedStage<T>(
  work: (signal: AbortSignal) => Promise<T>,
  controller: AbortController,
  timeoutMs: number,
  errorCode: SemanticProcessingErrorCode,
  disposeLate?: (value: T) => void,
  timeoutCode: SemanticProcessingErrorCode = errorCode,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = Promise.resolve().then(() => work(controller.signal));
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EphemeralStageError(timeoutCode));
    }, timeoutMs);
  });
  void operation.then(
    (value) => {
      if (controller.signal.aborted) disposeLate?.(value);
    },
    () => undefined,
  );
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    throw error instanceof EphemeralStageError ? error : new EphemeralStageError(errorCode);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export async function processEphemeralArticle(
  request: EphemeralProcessingRequest,
  dependencies: EphemeralPipelineDependencies,
): Promise<SemanticEnvelope> {
  let acquired: Buffer | null = null;
  let parsedBody: Buffer | null = null;
  let content: EphemeralArticleContent | null = null;
  let stageCode: SemanticProcessingErrorCode = 'RIGHTS_DENIED';
  let acquiredContentHash: string | null = null;
  const controller = new AbortController();
  const timeoutMs = dependencies.timeoutMs ?? 30_000;
  const maxAcquiredBytes = dependencies.maxAcquiredBytes ?? 4 * 1024 * 1024;
  const maxBodyBytes = dependencies.maxBodyBytes ?? 2 * 1024 * 1024;
  const state = async (value: SemanticProcessingState): Promise<void> => {
    if (dependencies.onState)
      await boundedStage(
        () => dependencies.onState?.(value) ?? Promise.resolve(),
        controller,
        timeoutMs,
        'PERSISTENCE_FAILED',
      );
  };
  try {
    stageCode = 'INPUT_INVALID';
    assertOriginalMetadata(request.metadata, request.position);
    stageCode = 'RIGHTS_DENIED';
    assertFulltextProcessingRights(request.policy, request.metadata.sourceId);
    stageCode = 'INPUT_INVALID';
    assertProviderIdentity(dependencies.provider.identity);
    if (
      !request.permanentExclusionVerified ||
      !request.providerRunId ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 120_000 ||
      !Number.isSafeInteger(maxAcquiredBytes) ||
      maxAcquiredBytes < 1 ||
      !Number.isSafeInteger(maxBodyBytes) ||
      maxBodyBytes < 1
    )
      throw new Error(stageCode);
    stageCode = 'PERSISTENCE_FAILED';
    await state('PROCESSING');
    stageCode = 'ACQUISITION_FAILED';
    acquired = await boundedStage(
      (signal) => dependencies.acquire(signal),
      controller,
      timeoutMs,
      stageCode,
      (late) => late.fill(0),
    );
    if (!Buffer.isBuffer(acquired) || acquired.length === 0 || acquired.length > maxAcquiredBytes)
      throw new Error(stageCode);
    acquiredContentHash = sha256Bytes(acquired);
    stageCode = 'PARSE_FAILED';
    const parseInput = acquired;
    const parsed = await boundedStage(
      (signal) => dependencies.parse(parseInput, signal),
      controller,
      timeoutMs,
      stageCode,
      (late) => late.body.fill(0),
    );
    parsedBody = parsed.body;
    if (!Buffer.isBuffer(parsedBody) || parsedBody.length === 0 || parsedBody.length > maxBodyBytes)
      throw new Error(stageCode);
    stageCode = 'INPUT_INVALID';
    content = new EphemeralArticleContent(request.metadata, acquired, parsed);
    stageCode = 'PROVIDER_FAILED';
    const owned = content;
    const raw = await boundedStage(
      (signal) => owned.observe(dependencies.provider, request.position, signal),
      controller,
      timeoutMs,
      'PROVIDER_FAILED',
      undefined,
      'PROVIDER_TIMEOUT',
    );
    stageCode = 'MAPPING_FAILED';
    const mapped = mapEphemeralProviderOutput(raw, content, request);
    if (
      mapped.llm &&
      (mapped.llm.config.providerVersion !== dependencies.provider.identity.providerVersion ||
        !['llm_gemini', 'llm_cloudflare_workers_ai', 'authored_stub'].includes(
          dependencies.provider.identity.providerType,
        ))
    )
      throw new Error('MAPPING_FAILED');
    const durableLLM = mapped.llm
      ? bindLLMEvidenceToAccessMode(mapped.llm, request.policy.accessMode)
      : undefined;
    let envelope: SemanticEnvelope = Object.freeze({
      authority: 'SHADOW_NOT_AUTHORITATIVE',
      ...(durableLLM ? { llm: durableLLM } : {}),
      metadata: durableMetadata(request.metadata),
      accessMode: request.policy.accessMode as
        | 'EXCERPT_EPHEMERAL'
        | 'FULLTEXT_EPHEMERAL'
        | 'FULLTEXT_PERSISTED',
      policyId: request.policy.policyId,
      acquiredContentHash: content.acquiredContentHash,
      normalizedInput: content.normalizedInput,
      provider: durableProvider(dependencies.provider.identity),
      providerRunId: request.providerRunId,
      processedAt: new Date().toISOString(),
      // Permission to retain a body does not prove that one was retained.
      reproducibilityClass: 'HASH_VERIFIABLE_REFETCH_REQUIRED',
      evidence: Object.freeze(
        mapped.evidence.map((locator) =>
          request.policy.accessMode === 'EXCERPT_EPHEMERAL' && locator.field === 'body'
            ? Object.freeze({ ...locator, field: 'excerpt' as const })
            : locator,
        ),
      ),
      observations: mapped.observations,
      articleProposals: mapped.articleProposals,
      candidateApplicability: mapped.candidateApplicability,
    });
    // Full source no longer needed when entering persistence.
    content.dispose();
    acquired = null;
    parsedBody = null;
    stageCode = 'PERSISTENCE_FAILED';
    if (dependencies.resolveVersionId) {
      const versionId = await boundedStage(
        (signal) =>
          dependencies.resolveVersionId?.(envelope, signal) ??
          Promise.resolve(envelope.metadata.articleVersionId),
        controller,
        timeoutMs,
        stageCode,
      );
      if (!versionId) throw new Error(stageCode);
      if (versionId !== envelope.metadata.articleVersionId)
        envelope = Object.freeze({
          ...envelope,
          metadata: Object.freeze({ ...envelope.metadata, articleVersionId: versionId }),
          evidence: Object.freeze(
            envelope.evidence.map((locator) =>
              Object.freeze({ ...locator, articleVersionId: versionId }),
            ),
          ),
        });
    }
    await boundedStage(
      (signal) => dependencies.persist(envelope, signal),
      controller,
      timeoutMs,
      stageCode,
    );
    // Persistence already committed. A notification failure cannot undo its durable state.
    try {
      await state('PROCESSED_SHADOW');
    } catch {
      /* Body-free observers are best effort after commit. */
    }
    safeLog(dependencies, {
      articleId: request.metadata.articleId,
      canonicalUrl: request.metadata.canonicalUrl,
      state: 'PROCESSED_SHADOW',
      code: 'PROCESSED_SHADOW',
      length: envelope.normalizedInput.bodyCodepoints,
      inputHash: envelope.normalizedInput.inputHash,
    });
    return envelope;
  } catch (error) {
    if (error instanceof EphemeralStageError) stageCode = error.code;
    content?.dispose();
    acquired?.fill(0);
    parsedBody?.fill(0);
    if (dependencies.onFailure) {
      const failureController = new AbortController();
      try {
        const receipt = Object.freeze({
          articleId: request.metadata.articleId,
          sourceId: request.metadata.sourceId,
          policyId: request.policy.policyId,
          provider: durableProvider(dependencies.provider.identity),
          errorCode: stageCode,
          acquiredContentHash,
          normalizedInputHash: content?.normalizedInput.inputHash ?? null,
          titleInputHash: content?.normalizedInput.titleHash ?? null,
          failedAt: new Date().toISOString(),
        });
        await boundedStage(
          (signal) => dependencies.onFailure?.(receipt, signal) ?? Promise.resolve(),
          failureController,
          Math.min(timeoutMs > 0 && timeoutMs <= 120_000 ? timeoutMs : 1000, 1000),
          'PERSISTENCE_FAILED',
        );
      } catch {
        /* Receipt failure never exposes source content or replaces the original error. */
      } finally {
        failureController.abort();
      }
    }
    // A fresh signal allows only a bounded body-free failure state write.
    if (dependencies.onState) {
      const failureController = new AbortController();
      try {
        await boundedStage(
          () => dependencies.onState?.('PROCESSING_FAILED') ?? Promise.resolve(),
          failureController,
          Math.min(timeoutMs > 0 ? timeoutMs : 1000, 1000),
          'PERSISTENCE_FAILED',
        );
      } catch {
        /* Original safe error remains the public result. */
      } finally {
        failureController.abort();
      }
    }
    safeLog(dependencies, {
      articleId: request.metadata.articleId,
      canonicalUrl: request.metadata.canonicalUrl,
      state: 'PROCESSING_FAILED',
      code: stageCode,
      length: content?.normalizedInput.bodyCodepoints ?? null,
      inputHash: content?.normalizedInput.inputHash ?? null,
    });
    throw new Error(stageCode);
  } finally {
    controller.abort();
    content?.dispose();
    acquired?.fill(0);
    parsedBody?.fill(0);
    content = null;
    acquired = null;
    parsedBody = null;
  }
}
