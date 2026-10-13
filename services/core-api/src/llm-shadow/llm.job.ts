import { present } from './llm.assert.js';
import type { Database } from '@dialektik/database';
import type { Kysely } from 'kysely';
import type {
  EphemeralPipelineDependencies,
  EphemeralProcessingRequest,
  SemanticEnvelope,
} from '../ephemeral/ephemeral.contracts.js';
import { processEphemeralArticle } from '../ephemeral/ephemeral.pipeline.js';
import { EphemeralEnvelopeRepository } from '../ephemeral/ephemeral.repository.js';
import type { LLMConfig, ProcessingRoute, StructuredLLMTransport } from './llm.contracts.js';
import { LLMShadowEngine } from './llm.engine.js';
import {
  LLMShadowRepository,
  type LLMFrozenInput,
  type LLMProviderAttemptLifecycle,
} from './llm.repository.js';
export interface LLMShadowJobInput {
  readonly request: EphemeralProcessingRequest;
  readonly frozen: LLMFrozenInput;
  readonly route: ProcessingRoute;
  /** Caller must supply the qualified content/pacing path. No direct publisher fetch here. */
  readonly content: Pick<EphemeralPipelineDependencies, 'acquire' | 'parse'>;
}
export interface LLMShadowJobOptions {
  readonly providerAttemptLifecycle?: LLMProviderAttemptLifecycle;
  readonly disableCache?: boolean;
}
/** Frozen manifest, once-only registration, audited scoped processing, then immutable seal. */
export async function runLLMShadowJob(
  database: Kysely<Database>,
  runId: string,
  config: LLMConfig,
  transport: StructuredLLMTransport,
  inputs: readonly LLMShadowJobInput[],
  signal = new AbortController().signal,
  options: LLMShadowJobOptions = {},
) {
  if (
    !inputs.length ||
    inputs.length > config.maxArticles ||
    inputs.some(
      (i, n) =>
        i.request.providerRunId !== runId ||
        i.request.position !== n + 1 ||
        i.request.metadata.articleId !== i.frozen.articleId ||
        i.request.metadata.articleVersionId !== i.frozen.versionId ||
        i.request.metadata.sourceId !== i.frozen.sourceId ||
        i.request.policy.policyId !== i.frozen.policyId,
    )
  )
    throw new Error('LLM_JOB_MANIFEST_INVALID');
  if (
    inputs.some(
      (i, n) =>
        n > 0 &&
        (Date.parse(i.request.metadata.availableAt) <
          Date.parse(present(inputs[n - 1]).request.metadata.availableAt) ||
          (Date.parse(i.request.metadata.availableAt) ===
            Date.parse(present(inputs[n - 1]).request.metadata.availableAt) &&
            i.frozen.articleId <= present(inputs[n - 1]).frozen.articleId)),
    )
  )
    throw new Error('LLM_JOB_ORDER_INVALID');
  const hooks = new LLMShadowRepository(
    database,
    runId,
    config,
    transport.kind,
    transport.providerType,
    options.providerAttemptLifecycle,
    options.disableCache ?? false,
  );
  // Authenticate routes before any acquisition or provider invocation.
  for (const i of inputs) await hooks.authorize(i.request, i.route, signal);
  await hooks.register(inputs.map((i) => i.frozen));
  const repository = new EphemeralEnvelopeRepository(database, {
    inputProvenance: transport.kind === 'external' ? 'LIVE_REAL' : 'AUTHORED_STUB',
    runIdentity: hooks.runIdentity,
  });
  const engine = new LLMShadowEngine(config, transport, hooks),
    envelopes: SemanticEnvelope[] = [],
    failures: string[] = [];
  try {
    for (const i of inputs) {
      if (signal.aborted) throw new Error('LLM_JOB_ABORTED');
      try {
        const envelope = await processEphemeralArticle(i.request, {
          ...i.content,
          acquire: async (s) => {
            const combined = AbortSignal.any([s, signal]);
            await engine.authorize(i.request, i.route, combined);
            return i.content.acquire(combined);
          },
          parse: (artifact, s) => i.content.parse(artifact, AbortSignal.any([s, signal])),
          provider: (() => {
            const provider = engine.scope(i.request, i.route, {
              inputHash: i.frozen.inputHash,
              titleHash: i.frozen.titleHash,
            });
            return {
              ...provider,
              observe: (input, s = new AbortController().signal) =>
                provider.observe(input, AbortSignal.any([s, signal])),
            };
          })(),
          // Exact preregistered version is immutable. Never silently rebind it.
          persist: (e, s) => repository.persist(e, AbortSignal.any([s, signal])),
          onFailure: (r, s) => repository.persistFailure(r, s),
          timeoutMs: Math.min(120000, config.timeoutMs * (1 + config.topK)),
        });
        envelopes.push(envelope);
        engine.accept(i.frozen.articleId);
      } catch {
        engine.reject(i.frozen.articleId);
        failures.push(i.frozen.articleId);
      }
    }
    const graph = engine.graph.snapshot();
    const snapshotId = envelopes.length
      ? await repository.persistGraph(graph, envelopes, signal)
      : null;
    return {
      runId,
      runIdentity: hooks.runIdentity,
      snapshotId,
      envelopes,
      failures,
      calls: engine.callCount,
      graph,
    };
  } finally {
    engine.close();
    transport.dispose?.();
  }
}
