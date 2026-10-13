import { assertLLMActive } from './llm.assert.js';
import { generateUlid, parseUlid, type Database } from '@dialektik/database';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { EphemeralProcessingRequest } from '../ephemeral/ephemeral.contracts.js';
import type {
  LLMConfig,
  LLMEnvelopeExtension,
  LLMProviderType,
  LLMUsage,
  ProcessingRoute,
  VerifiedExtraction,
} from './llm.contracts.js';
import type { LLMRuntimeHooks } from './llm.engine.js';
import { sha256 } from './llm.schema.js';

export interface LLMFrozenInput {
  readonly articleId: string;
  readonly versionId: string;
  readonly sourceId: string;
  readonly policyId: string;
  readonly inputHash: string;
  readonly titleHash: string;
}
export interface LLMProviderAttemptLifecycle {
  beforeProviderCall(
    tx: Transaction<Database>,
    args: Readonly<{
      runId: string;
      stage: 'extraction' | 'relation';
      request: EphemeralProcessingRequest;
    }>,
  ): Promise<void>;
  afterProviderCall(
    tx: Transaction<Database>,
    args: Readonly<{
      runId: string;
      stage: 'extraction' | 'relation';
      request: EphemeralProcessingRequest;
      outcome: 'RESPONSE_RECEIVED' | 'FAILED';
      usage?: LLMUsage;
      failureCategory?: string;
    }>,
  ): Promise<void>;
}
/** Existing envelopes/graph remain the storage spine. This owns only new LLM provenance. */
export class LLMShadowRepository implements LLMRuntimeHooks {
  constructor(
    private readonly database: Kysely<Database>,
    readonly runId: string,
    readonly config: LLMConfig,
    private readonly kind: 'external' | 'local',
    private readonly explicitProviderType?: LLMProviderType,
    private readonly attemptLifecycle?: LLMProviderAttemptLifecycle,
    private readonly disableCache = false,
  ) {}
  get runIdentity(): string {
    return 'LLM_SEMANTIC_SHADOW_V1_' + this.runId;
  }
  get requireUsageAccounting(): boolean {
    return this.kind === 'external' && this.attemptLifecycle !== undefined;
  }
  private get providerType(): LLMProviderType {
    return this.explicitProviderType ?? (this.kind === 'external' ? 'llm_gemini' : 'authored_stub');
  }
  async register(inputs: readonly LLMFrozenInput[]): Promise<void> {
    if (
      !inputs.length ||
      inputs.length > this.config.maxArticles ||
      new Set(inputs.map((i) => i.articleId)).size !== inputs.length
    )
      throw new Error('LLM_FROZEN_INPUT_INVALID');
    const now = new Date().toISOString();
    await this.database.transaction().execute(async (tx) => {
      await tx
        .insertInto('semantic_provider_runs')
        .values({
          id: parseUlid(this.runId),
          provider_type: this.providerType,
          provider_version: this.config.providerVersion,
          candidate_commit: null,
          runtime_python: null,
          runtime_model: null,
          run_identity: this.runIdentity,
          input_provenance: this.kind === 'external' ? 'LIVE_REAL' : 'AUTHORED_STUB',
          created_at: now,
        })
        .execute();
      await tx
        .insertInto('llm_shadow_run_configurations')
        .values({
          provider_run_id: parseUlid(this.runId),
          config_hash: this.config.configHash,
          configuration: this.config,
          input_manifest: JSON.stringify(inputs),
          purpose: 'PRODUCT_DEVELOPMENT',
          mode: 'LLM_SEMANTIC_SHADOW',
          recorded_at: now,
        })
        .execute();
    });
  }
  private async fenceAndAuthorize(
    tx: Transaction<Database>,
    requests: readonly EphemeralProcessingRequest[],
    route: ProcessingRoute,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      signal.aborted ||
      route === 'NOT_ALLOWED' ||
      (this.kind === 'external' && route !== 'EXTERNAL_LLM_PROCESSING_ALLOWED')
    )
      throw new Error('LLM_RIGHTS_DENIED');
    for (const sourceId of [...new Set(requests.map((r) => r.metadata.sourceId))].sort()) {
      await tx
        .selectFrom('prospective_content_rights_write_guards')
        .select('source_id')
        .where('source_id', '=', parseUlid(sourceId))
        .forUpdate()
        .executeTakeFirstOrThrow();
    }
    for (const r of requests) {
      const result = await sql<{
        allowed: boolean;
      }>`select dialektik_llm_route_allowed(${parseUlid(r.metadata.sourceId)},${parseUlid(r.metadata.articleId)},${r.policy.policyId},${this.providerType},${this.kind === 'external'},${this.config.model}) as allowed`.execute(
        tx,
      );
      if (result.rows[0]?.allowed !== true) throw new Error('LLM_RIGHTS_DENIED');
      const p = await tx
        .selectFrom('content_access_policies')
        .selectAll()
        .where('id', '=', r.policy.policyId)
        .executeTakeFirstOrThrow();
      const article = await tx
        .selectFrom('articles')
        .select(['source_id', 'url_canonical', 'event_id'])
        .where('id', '=', parseUlid(r.metadata.articleId))
        .executeTakeFirstOrThrow();
      if (
        article.source_id !== r.metadata.sourceId ||
        article.url_canonical !== r.metadata.canonicalUrl ||
        article.event_id !== null ||
        p.source_id !== r.metadata.sourceId ||
        p.content_access_mode !== r.policy.accessMode ||
        p.metadata_storage !== r.policy.rights.metadataStorage ||
        p.excerpt_storage !== r.policy.rights.excerptStorage ||
        p.local_processing !== (r.policy.rights.localProcessing ?? false) ||
        p.external_ai_transmission !== (r.policy.rights.externalAiTransmission ?? false) ||
        p.evidence_quote_max_codepoints !== r.policy.evidenceMaxCodepoints ||
        p.minimal_evidence_fragment !== r.policy.rights.minimalEvidenceFragment ||
        p.fulltext_acquisition !== r.policy.rights.fulltextAcquisition ||
        p.fulltext_machine_processing !== r.policy.rights.fulltextMachineProcessing ||
        p.derived_semantic_persistence !== r.policy.rights.derivedSemanticPersistence ||
        p.fulltext_persistence !== r.policy.rights.fulltextPersistence
      )
        throw new Error('LLM_RIGHTS_DENIED');
    }
    assertLLMActive(signal);
  }
  async authorize(
    request: EphemeralProcessingRequest,
    route: ProcessingRoute,
    signal: AbortSignal,
  ): Promise<void> {
    await this.database
      .transaction()
      .execute((tx) => this.fenceAndAuthorize(tx, [request], route, signal));
  }
  async withRightsLease<T>(
    requests: readonly EphemeralProcessingRequest[],
    route: ProcessingRoute,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.database.transaction().execute(async (tx) => {
      await this.fenceAndAuthorize(tx, requests, route, signal);
      const value = await work();
      assertLLMActive(signal);
      return value;
    });
  }
  async lookupCache(key: string): Promise<VerifiedExtraction | null> {
    if (this.disableCache) return null;
    const row = await this.database
      .selectFrom('llm_shadow_observations')
      .select('structured_output')
      .where('cache_key', '=', key)
      .where('config_hash', '=', this.config.configHash)
      .orderBy('recorded_at', 'asc')
      .executeTakeFirst();
    return row ? (row.structured_output as LLMEnvelopeExtension).extraction : null;
  }
  private callKey(key: string): string {
    return sha256(this.runId + ':' + key);
  }
  async claimCall(
    key: string,
    stage: 'extraction' | 'relation',
    request: EphemeralProcessingRequest,
    signal: AbortSignal,
  ): Promise<void> {
    assertLLMActive(signal);
    await this.database.transaction().execute(async (tx) => {
      await tx
        .insertInto('llm_shadow_call_claims')
        .values({
          call_key: this.callKey(key),
          provider_run_id: parseUlid(this.runId),
          article_id: parseUlid(request.metadata.articleId),
          stage,
          claimed_at: new Date().toISOString(),
        })
        .execute();
      await this.attemptLifecycle?.beforeProviderCall(tx, {
        runId: this.runId,
        stage,
        request,
      });
    });
  }
  async finishCall(
    key: string,
    outcome: 'RESPONSE_RECEIVED' | 'FAILED',
    _signal: AbortSignal,
    request?: EphemeralProcessingRequest,
    stage?: 'extraction' | 'relation',
    accounting: Readonly<{ usage?: LLMUsage; failureCategory?: string }> = {},
  ): Promise<void> {
    await this.database.transaction().execute(async (tx) => {
      await tx
        .insertInto('llm_shadow_call_outcomes')
        .values({ call_key: this.callKey(key), outcome, recorded_at: new Date().toISOString() })
        .execute();
      if (this.attemptLifecycle) {
        if (!request || !stage) throw new Error('LLM_PROVIDER_ATTEMPT_LIFECYCLE_INVALID');
        await this.attemptLifecycle.afterProviderCall(tx, {
          runId: this.runId,
          stage,
          request,
          outcome,
          ...accounting,
        });
      }
    });
  }
  async appendRouteGrant(
    sourceId: string,
    articleId: string | null,
    policyId: string,
    route: ProcessingRoute,
    rightsReceiptHash: string,
    rights: EphemeralProcessingRequest['policy']['rights'],
  ): Promise<void> {
    const providerType = this.providerType;
    await this.database
      .insertInto('llm_processing_route_grants')
      .values({
        id: generateUlid({ now: Date.now }),
        source_id: parseUlid(sourceId),
        article_id: articleId === null ? null : parseUlid(articleId),
        policy_id: policyId,
        provider_type: providerType,
        processing_route: route,
        fulltext_acquisition: rights.fulltextAcquisition,
        machine_processing: rights.fulltextMachineProcessing,
        derived_persistence: rights.derivedSemanticPersistence,
        fulltext_persistence: rights.fulltextPersistence,
        evidence_fragments: rights.minimalEvidenceFragment,
        rights_receipt_sha256: rightsReceiptHash,
        recorded_at: sql<Date>`date_trunc('milliseconds', clock_timestamp())`,
      })
      .execute();
  }
}
