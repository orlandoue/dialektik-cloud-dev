import { assertLLMActive } from './llm.assert.js';
import type {
  ContentAccessPolicy,
  EphemeralProcessingRequest,
  FrozenDecisionArticle,
} from '../ephemeral/ephemeral.contracts.js';
import type {
  LLMConfig,
  LLMEnvelopeExtension,
  LLMUsage,
  LLMSemanticObservationProvider,
  ProcessingRoute,
  StructuredLLMTransport,
  VerifiedExtraction,
} from './llm.contracts.js';
import { sha256 } from './llm.schema.js';
import { semanticContract } from './llm.semantic-v2.js';
import { verifyExtraction, verifyRelation } from './llm.grounding.js';
import { BoundedCandidateIndex } from './llm.retrieval.js';
import { DeterministicProposalGraph, type GraphPlacement } from './llm.graph.js';

export interface LLMRuntimeHooks {
  authorize(
    request: EphemeralProcessingRequest,
    route: ProcessingRoute,
    signal: AbortSignal,
  ): Promise<void>;
  withRightsLease?<T>(
    requests: readonly EphemeralProcessingRequest[],
    route: ProcessingRoute,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T>;
  lookupCache?(key: string): Promise<VerifiedExtraction | null>;
  readonly requireUsageAccounting?: boolean;
  claimCall?(
    key: string,
    stage: 'extraction' | 'relation',
    request: EphemeralProcessingRequest,
    signal: AbortSignal,
  ): Promise<void>;
  finishCall?(
    key: string,
    outcome: 'RESPONSE_RECEIVED' | 'FAILED',
    signal: AbortSignal,
    request?: EphemeralProcessingRequest,
    stage?: 'extraction' | 'relation',
    accounting?: Readonly<{ usage?: LLMUsage; failureCategory?: string }>,
  ): Promise<void>;
}
const emptyUsage = (): LLMUsage => ({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cost: null,
});
export const extractionCacheKey = (config: LLMConfig, bodyHash: string, titleHash: string) =>
  sha256(JSON.stringify([config.configHash, bodyHash, titleHash]));
interface PendingObservation {
  request: EphemeralProcessingRequest;
  extraction: VerifiedExtraction;
  placement: GraphPlacement;
  cacheKey: string;
  fragments: readonly Readonly<{ id: string; role: string; value: string }>[];
}
export class LLMShadowEngine {
  readonly graph = new DeterministicProposalGraph();
  readonly index = new BoundedCandidateIndex();
  private readonly cache = new Map<string, VerifiedExtraction>();
  private readonly fragments = new Map<
    string,
    readonly Readonly<{ id: string; role: string; value: string }>[]
  >();
  private readonly requests = new Map<string, EphemeralProcessingRequest>();
  private readonly pending = new Map<string, PendingObservation>();
  private readonly attempted = new Set<string>();
  private lastOrder: { time: number; id: string } | null = null;
  private closed = false;
  private busy = false;
  private calls = 0;
  constructor(
    readonly config: LLMConfig,
    private readonly transport: StructuredLLMTransport,
    private readonly hooks: LLMRuntimeHooks,
  ) {}
  get callCount(): number {
    return this.calls;
  }
  scope(
    request: EphemeralProcessingRequest,
    route: ProcessingRoute,
    expectedInput?: Readonly<{ inputHash: string; titleHash: string }>,
  ): LLMSemanticObservationProvider {
    const identity = Object.freeze({
      providerType:
        this.transport.providerType ??
        (this.transport.kind === 'external' ? 'llm_gemini' : 'authored_stub'),
      providerVersion: this.config.providerVersion,
      candidateCommit: null,
    });
    return {
      name: 'llm_semantic_observation',
      version: this.config.providerVersion,
      identity,
      observe: (input, signal = new AbortController().signal) =>
        this.observe(request, route, input, signal, expectedInput),
    };
  }
  async authorize(
    request: EphemeralProcessingRequest,
    route: ProcessingRoute,
    signal: AbortSignal,
  ): Promise<void> {
    const excerptInput = request.policy.accessMode === 'EXCERPT_EPHEMERAL';
    const contentRightsAllowed = excerptInput
      ? request.policy.rights.metadataStorage &&
        request.policy.rights.excerptStorage &&
        request.policy.rights.localProcessing === true &&
        request.policy.rights.externalAiTransmission === true &&
        request.policy.rights.derivedSemanticPersistence &&
        !request.policy.rights.fulltextAcquisition &&
        !request.policy.rights.fulltextMachineProcessing &&
        !request.policy.rights.fulltextPersistence
      : request.policy.rights.fulltextAcquisition &&
        request.policy.rights.fulltextMachineProcessing &&
        request.policy.rights.derivedSemanticPersistence;
    if (
      route === 'NOT_ALLOWED' ||
      (this.transport.kind === 'external' && route !== 'EXTERNAL_LLM_PROCESSING_ALLOWED') ||
      (!excerptInput && request.policy.accessMode === 'METADATA_ONLY') ||
      !request.policy.active ||
      !contentRightsAllowed ||
      !request.permanentExclusionVerified
    )
      throw new Error('LLM_RIGHTS_DENIED');
    await this.hooks.authorize(request, route, signal);
    assertLLMActive(signal, this.closed);
  }
  private async call(
    stage: 'extraction' | 'relation',
    input: unknown,
    key: string,
    request: EphemeralProcessingRequest,
    route: ProcessingRoute,
    signal: AbortSignal,
    targets: readonly EphemeralProcessingRequest[] = [],
  ) {
    await this.authorize(request, route, signal);
    if (this.calls >= this.config.maxCalls) throw new Error('LLM_CALL_BUDGET_EXHAUSTED');
    await this.hooks.claimCall?.(key, stage, request, signal);
    this.calls++;
    const controller = new AbortController(),
      bounded = AbortSignal.any([signal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let callFinished = false;
    try {
      const invoke = () =>
        this.transport.generate(
          stage,
          input,
          stage === 'extraction'
            ? semanticContract(this.config).schema
            : semanticContract(this.config).relationSchema,
          bounded,
        );
      if (this.transport.kind === 'external' && !this.hooks.withRightsLease)
        throw new Error('LLM_RIGHTS_LEASE_REQUIRED');
      const operation = this.hooks.withRightsLease
        ? this.hooks.withRightsLease([request, ...targets], route, bounded, invoke)
        : invoke();
      const result = await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('LLM_TIMEOUT'));
          }, this.config.timeoutMs);
        }),
      ]);
      assertLLMActive(signal, this.closed);
      if (
        this.hooks.requireUsageAccounting &&
        (result.usage.inputTokens === null || result.usage.outputTokens === null)
      ) {
        await this.hooks.finishCall?.(key, 'FAILED', new AbortController().signal, request, stage, {
          failureCategory: 'USAGE_RECONCILIATION_REQUIRED',
        });
        callFinished = true;
        throw new Error('LLM_USAGE_RECONCILIATION_REQUIRED');
      }
      await this.hooks.finishCall?.(key, 'RESPONSE_RECEIVED', signal, request, stage, {
        usage: result.usage,
      });
      callFinished = true;
      return result;
    } catch (error) {
      if (!callFinished) {
        const code = error instanceof Error ? error.message : '';
        const failureCategory = [
          'LLM_FREE_NEURON_QUOTA_EXHAUSTED',
          'LLM_PROVIDER_CAPACITY_EXCEEDED',
          'LLM_MODEL_REQUIRES_PAID_PLAN',
          'LLM_CREDENTIAL_REJECTED',
          'USAGE_RECONCILIATION_REQUIRED',
        ].includes(code)
          ? code.replace(/^LLM_/, '')
          : 'PROVIDER_OUTCOME_UNKNOWN';
        await this.hooks
          .finishCall?.(key, 'FAILED', new AbortController().signal, request, stage, {
            failureCategory,
          })
          .catch(() => undefined);
      }
      throw new Error(signal.aborted ? 'LLM_ABORTED' : 'LLM_PROVIDER_FAILED');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async observe(
    request: EphemeralProcessingRequest,
    route: ProcessingRoute,
    input: FrozenDecisionArticle,
    signal: AbortSignal,
    expectedInput?: Readonly<{ inputHash: string; titleHash: string }>,
  ): Promise<unknown> {
    if (this.busy) throw new Error('LLM_CONCURRENCY_FORBIDDEN');
    this.busy = true;
    try {
      return await this.observeScoped(request, route, input, signal, expectedInput);
    } finally {
      this.busy = false;
    }
  }
  private async observeScoped(
    request: EphemeralProcessingRequest,
    route: ProcessingRoute,
    input: FrozenDecisionArticle,
    signal: AbortSignal,
    expectedInput?: Readonly<{ inputHash: string; titleHash: string }>,
  ): Promise<unknown> {
    const id = request.metadata.articleId,
      order = { time: Date.parse(request.metadata.availableAt), id };
    if (
      this.closed ||
      this.attempted.has(id) ||
      this.attempted.size >= this.config.maxArticles ||
      !Number.isFinite(order.time) ||
      (this.lastOrder !== null &&
        (order.time < this.lastOrder.time ||
          (order.time === this.lastOrder.time && id <= this.lastOrder.id))) ||
      input.article_id !== id ||
      input.position !== request.position
    )
      throw new Error('LLM_ARTICLE_ORDER_OR_BOUND');
    this.attempted.add(id);
    this.lastOrder = order;
    await this.authorize(request, route, signal);
    const body = input.body,
      title = input.title,
      bodyHash = sha256(body),
      titleHash = sha256(title),
      key = extractionCacheKey(this.config, bodyHash, titleHash);
    if (
      (this.transport.kind === 'external' && !expectedInput) ||
      (expectedInput &&
        (expectedInput.inputHash !== bodyHash || expectedInput.titleHash !== titleHash))
    )
      throw new Error('LLM_INPUT_MANIFEST_MISMATCH');
    let extraction = this.cache.get(key) ?? (await this.hooks.lookupCache?.(key)) ?? null;
    let usage = emptyUsage();
    if (extraction) {
      // Rebind and reverify cached fingerprints against the current exact input.
      extraction = verifyExtraction(
        {
          status: extraction.status,
          boundedOccurrence: extraction.boundedOccurrence,
          boundedThread: extraction.boundedThread,
          facts: extraction.facts.map((f) => {
            // Durable excerpt locators use the rights-aware DB label. Inside
            // the transient normalizer, the same bytes are the body field.
            const field = f.evidence.field === 'excerpt' ? 'body' : f.evidence.field;
            return {
              id: f.id,
              role: f.role,
              value: Array.from(field === 'body' ? body : title)
                .slice(f.evidence.start, f.evidence.end)
                .join(''),
              evidence: {
                field,
                start: f.evidence.start,
                end: f.evidence.end,
                inputHash: f.evidence.sourceSha256,
              },
            };
          }),
        },
        { title, body },
      );
    } else {
      const generation = await this.call(
        'extraction',
        semanticContract(this.config).quoteEvidence
          ? { title, body }
          : { title, body, titleHash, bodyHash, offsetConvention: 'unicode_code_point_v1' },
        key,
        request,
        route,
        signal,
      );
      extraction = semanticContract(this.config).verify(generation.output, { title, body });
      usage = generation.usage;
    }
    assertLLMActive(signal, this.closed);
    const fragments = this.allowedFragments(extraction, { body, title }, request.policy);
    const candidates = this.index.retrieve(
      extraction,
      request.metadata.availableAt,
      id,
      this.config.topK,
    );
    const judged = [];
    for (const candidate of candidates) {
      const target = this.requests.get(candidate.articleId);
      if (!target) throw new Error('LLM_CANDIDATE_SCOPE_INVALID');
      await this.authorize(target, route, signal); // Other side needs its own current external rights.
      const left = { extraction, facts: fragments },
        right = {
          extraction: candidate.extraction,
          facts: this.fragments.get(candidate.articleId) ?? [],
        };
      const generation = await this.call(
        'relation',
        { left, right },
        sha256(
          JSON.stringify([key, candidate.versionId, sha256(JSON.stringify(candidate.extraction))]),
        ),
        request,
        route,
        signal,
        [target],
      );
      const relation = verifyRelation(generation.output, extraction, candidate.extraction);
      // No affirmative interpretation of undisclosed hash-only Source facts.
      if (
        !['UNKNOWN', 'NOT_APPLICABLE'].includes(relation.decision) &&
        (!relation.leftFacts.every((f) => fragments.some((v) => v.id === f)) ||
          !relation.rightFacts.every((f) =>
            (this.fragments.get(candidate.articleId) ?? []).some((v) => v.id === f),
          ))
      )
        throw new Error('LLM_RELATION_CONTEXT_UNAVAILABLE');
      judged.push({ candidate, relation });
      usage = {
        inputTokens: add(usage.inputTokens, generation.usage.inputTokens),
        outputTokens: add(usage.outputTokens, generation.usage.outputTokens),
        totalTokens: add(usage.totalTokens, generation.usage.totalTokens),
        cost: null,
      };
    }
    const placement = this.graph.propose(id, extraction, judged);
    const retainedExtraction = redactExtraction(extraction);
    const retainedRelations = judged.map(({ candidate, relation }) => ({
      ...relation,
      targetArticleId: candidate.articleId,
      targetVersionId: candidate.versionId,
    }));
    const llm: LLMEnvelopeExtension = Object.freeze({
      mode: 'LLM_SEMANTIC_SHADOW',
      config: this.config,
      route,
      extraction: retainedExtraction,
      relations: retainedRelations,
      outputHash: sha256(
        JSON.stringify({ extraction: retainedExtraction, relations: retainedRelations }),
      ),
      cacheKey: key,
      usage,
      evidenceVerification: 'VERIFIED',
    });
    assertLLMActive(signal, this.closed);
    this.pending.set(id, {
      request,
      extraction: {
        ...extraction,
        facts: extraction.facts.map((f) => ({
          ...f,
          isoDate: fragments.some((v) => v.id === f.id) ? f.isoDate : null,
        })),
      },
      placement,
      fragments,
      cacheKey: key,
    });
    return {
      evidence: extraction.facts.map((f) => f.evidence),
      observations: [
        {
          observationKey: 'llm:' + sha256(id + this.config.configHash).slice(0, 24),
          decision: placement.decision,
          applicability:
            extraction.status === 'NOT_APPLICABLE'
              ? 'INAPPLICABLE'
              : extraction.status === 'OBSERVATION_AVAILABLE'
                ? 'APPLICABLE'
                : 'UNKNOWN_APPLICABILITY',
          proposedOccurrenceKey: placement.occurrenceKey,
          proposedThreadKey: placement.threadKey,
        },
      ],
      articleProposals: [
        {
          action:
            placement.decision === 'MATCH'
              ? 'update_occurrence'
              : placement.occurrenceKey === null
                ? 'ambiguous'
                : judged.some((r) => r.relation.thread === 'SAME')
                  ? 'new_occurrence_in_existing_thread'
                  : 'new_thread',
          reasonCode:
            placement.decision === 'MATCH'
              ? 'llm_grounded_same_occurrence'
              : placement.occurrenceKey === null
                ? 'llm_abstention'
                : judged.some((r) => r.relation.thread === 'SAME')
                  ? 'llm_grounded_same_thread'
                  : 'llm_bounded_singleton',
          proposedOccurrenceKey: placement.occurrenceKey,
          proposedThreadKey: placement.threadKey,
          partialOccurrenceCreation:
            placement.occurrenceKey !== null && placement.threadKey === null,
        },
      ],
      llm,
    };
  }
  private allowedFragments(
    extraction: VerifiedExtraction,
    input: Readonly<{ body: string; title: string }>,
    policy: ContentAccessPolicy,
  ) {
    const result: Readonly<{ id: string; role: string; value: string }>[] = [];
    let budget = Math.min(512, policy.evidenceMaxCodepoints);
    if (!policy.rights.minimalEvidenceFragment) return result;
    for (const fact of extraction.facts) {
      const source = fact.evidence.field === 'title' ? input.title : input.body;
      const value = Array.from(source).slice(fact.evidence.start, fact.evidence.end).join('');
      if (Array.from(value).length <= budget) {
        result.push(Object.freeze({ id: fact.id, role: fact.role, value }));
        budget -= Array.from(value).length;
      }
    }
    return Object.freeze(result);
  }
  /** Called only after the audited envelope persistence succeeds and body scope closes. */
  accept(articleId: string): void {
    const pending = this.pending.get(articleId);
    if (!pending || this.closed) throw new Error('LLM_PENDING_OBSERVATION_MISSING');
    const { request, extraction, placement, fragments, cacheKey } = pending;
    this.graph.accept(articleId, placement, redactExtraction(extraction));
    if (placement.occurrenceKey)
      this.index.add({
        articleId,
        versionId: request.metadata.articleVersionId,
        availableAt: request.metadata.availableAt,
        extraction: {
          ...extraction,
          facts: extraction.facts.map((f) => ({
            ...f,
            isoDate: fragments.some((v) => v.id === f.id) ? f.isoDate : null,
          })),
        },
        occurrenceKey: placement.occurrenceKey,
        threadKey: placement.threadKey,
      });
    this.requests.set(articleId, request);
    this.fragments.set(articleId, fragments);
    this.cache.set(cacheKey, redactExtraction(extraction));
    this.pending.delete(articleId);
  }
  reject(articleId: string): void {
    this.pending.delete(articleId);
  }
  close(): void {
    this.closed = true;
    this.pending.clear();
    this.fragments.clear();
    this.requests.clear();
    this.cache.clear();
    this.index.clear();
  }
}
const add = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a + b;

function redactExtraction(extraction: VerifiedExtraction): VerifiedExtraction {
  return Object.freeze({
    ...extraction,
    facts: Object.freeze(extraction.facts.map((f) => Object.freeze({ ...f, isoDate: null }))),
  });
}
