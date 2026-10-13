import type { FrozenBatchResult } from './ephemeral.frozen-batch';
import { generateUlid, parseUlid, type Database, type Ulid } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import { assertNativeDiagnosticReceipt, canonicalDiagnosticJson } from './ephemeral.diagnostics';
import type {
  SemanticEnvelope,
  SemanticProcessingState,
  SemanticProcessingFailureReceipt,
  FrozenFieldIdentity,
  ObservedArticleMetadata,
} from './ephemeral.contracts';
import {
  assertOriginalMetadata,
  decodeOriginalUtf8,
  normalizeFrozenFields,
} from './ephemeral.normalization';
import { PROSPECTIVE_RUN_IDENTITY } from './ephemeral.prospective.repository';
import { bodyFreePersistenceError } from './ephemeral.persistence-errors';

export interface RetainedOriginalInputReceipt {
  readonly articleVersionId: string;
  readonly retainedInput: Readonly<{
    normalizedInputHash: string;
    titleInputHash: string;
    bodyCodepoints: number;
    titleCodepoints: number;
    normalizationVersion: string;
    offsetConvention: 'unicode_code_point_v1';
    exactCopyRetained: true;
  }>;
}

export interface EphemeralPersistenceContext {
  readonly inputProvenance: 'AUTHORED_STUB' | 'LIVE_REAL';
  readonly runIdentity: string;
}
function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('PERSISTENCE_FAILED');
}
function newId(): Ulid {
  return generateUlid({ now: Date.now });
}
/** Envelopes stay body-free; only the separately granted retained-input method accepts text. */
export class EphemeralEnvelopeRepository {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly context: EphemeralPersistenceContext,
  ) {}
  /** Owner-approved prospective path; it never converts an ephemeral grant into retention. */
  async persistOriginalFulltext(
    metadata: ObservedArticleMetadata,
    policyId: string,
    acquiredContentHash: string,
    originalBody: Uint8Array,
    signal: AbortSignal,
  ): Promise<RetainedOriginalInputReceipt> {
    try {
      checkSignal(signal);
      if (
        this.context.inputProvenance !== 'LIVE_REAL' ||
        this.context.runIdentity !== PROSPECTIVE_RUN_IDENTITY ||
        !/^[0-9a-f]{64}$/.test(acquiredContentHash)
      )
        throw new Error('PERSISTENCE_FAILED');
      assertOriginalMetadata(metadata, 1);
      const body = decodeOriginalUtf8(originalBody);
      const fields = normalizeFrozenFields(metadata.title, body);
      const articleId = parseUlid(metadata.articleId);
      const sourceId = parseUlid(metadata.sourceId);
      const recordedAt = new Date().toISOString();
      const articleVersionId = await this.database.transaction().execute(async (transaction) => {
        await sql`select set_config('statement_timeout','5000',true)`.execute(transaction);
        await sql`select pg_advisory_xact_lock(hashtextextended(${articleId},18))`.execute(
          transaction,
        );
        checkSignal(signal);
        // Policy appends update this MVCC row; an old snapshot must fail closed.
        await transaction
          .selectFrom('prospective_content_rights_write_guards')
          .select('source_id')
          .where('source_id', '=', sourceId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const policy = await transaction
          .selectFrom('content_access_policies')
          .selectAll()
          .where('source_id', '=', sourceId)
          .where('recorded_at', '<=', sql<Date>`statement_timestamp()`)
          .orderBy('recorded_at', 'desc')
          .orderBy('id', 'desc')
          .executeTakeFirstOrThrow();
        const article = await transaction
          .selectFrom('articles')
          .select(['origin', 'source_id', 'url_canonical'])
          .where('id', '=', articleId)
          .executeTakeFirstOrThrow();
        if (
          policy.id !== policyId ||
          policy.content_access_mode !== 'FULLTEXT_PERSISTED' ||
          !policy.metadata_storage ||
          !policy.fulltext_acquisition ||
          !policy.fulltext_machine_processing ||
          !policy.fulltext_persistence ||
          !policy.derived_semantic_persistence ||
          article.origin !== 'LIVE_REAL' ||
          article.source_id !== sourceId ||
          article.url_canonical !== metadata.canonicalUrl
        )
          throw new Error('RIGHTS_DENIED');
        const prior = await transaction
          .selectFrom('observed_article_content_versions')
          .selectAll()
          .where('article_id', '=', articleId)
          .orderBy('version_number', 'desc')
          .executeTakeFirst();
        if (
          prior &&
          prior.normalized_input_hash === fields.inputHash &&
          prior.title_input_hash === fields.titleHash &&
          prior.policy_id === policyId &&
          prior.acquired_content_hash === acquiredContentHash
        ) {
          if (
            prior.persisted_body !== body ||
            prior.original_title !== metadata.title ||
            prior.normalization_version !== fields.normalizationVersion ||
            prior.input_codepoint_length !== fields.bodyCodepoints ||
            prior.title_codepoint_length !== fields.titleCodepoints ||
            prior.source_id !== sourceId ||
            prior.canonical_url !== metadata.canonicalUrl ||
            prior.publisher_item_id !== metadata.publisherItemId ||
            prior.published_at.getTime() !== Date.parse(metadata.publishedAt) ||
            prior.available_at.getTime() !== Date.parse(metadata.availableAt) ||
            (prior.modified_at?.getTime() ?? null) !==
              (metadata.modifiedAt === null ? null : Date.parse(metadata.modifiedAt)) ||
            prior.acquired_at.getTime() !== Date.parse(metadata.acquiredAt) ||
            prior.language !== metadata.language ||
            prior.content_encoding !== (metadata.contentEncoding as string)
          )
            throw new Error('PERSISTENCE_FAILED');
          checkSignal(signal);
          return prior.id;
        }
        const versionId = parseUlid(metadata.articleVersionId);
        await transaction
          .insertInto('observed_article_content_versions')
          .values({
            id: versionId,
            article_id: articleId,
            source_id: sourceId,
            policy_id: policyId,
            previous_version_id: prior?.id ?? null,
            version_number: (prior?.version_number ?? 0) + 1,
            canonical_url: metadata.canonicalUrl,
            publisher_item_id: metadata.publisherItemId,
            original_title: metadata.title,
            published_at: metadata.publishedAt,
            available_at: metadata.availableAt,
            modified_at: metadata.modifiedAt,
            acquired_at: metadata.acquiredAt,
            language: metadata.language,
            content_encoding: metadata.contentEncoding,
            acquired_content_hash: acquiredContentHash,
            normalized_input_hash: fields.inputHash,
            title_input_hash: fields.titleHash,
            normalization_version: fields.normalizationVersion,
            input_codepoint_length: fields.bodyCodepoints,
            title_codepoint_length: fields.titleCodepoints,
            persisted_body: body,
            recorded_at: recordedAt,
          })
          .execute();
        checkSignal(signal);
        return versionId;
      });
      return this.retainedReceipt(articleVersionId, fields);
    } catch (error) {
      throw bodyFreePersistenceError(error, 'PERSISTENCE_FAILED');
    }
  }
  private retainedReceipt(
    articleVersionId: string,
    fields: FrozenFieldIdentity,
  ): RetainedOriginalInputReceipt {
    return Object.freeze({
      articleVersionId,
      retainedInput: Object.freeze({
        normalizedInputHash: fields.inputHash,
        titleInputHash: fields.titleHash,
        bodyCodepoints: fields.bodyCodepoints,
        titleCodepoints: fields.titleCodepoints,
        normalizationVersion: fields.normalizationVersion,
        offsetConvention: fields.offsetConvention,
        exactCopyRetained: true,
      }),
    });
  }
  async resolveVersionId(envelope: SemanticEnvelope, signal: AbortSignal): Promise<string> {
    checkSignal(signal);
    const prior = await this.database
      .selectFrom('observed_article_content_versions')
      .selectAll()
      .where('article_id', '=', parseUlid(envelope.metadata.articleId))
      .orderBy('version_number', 'desc')
      .executeTakeFirst();
    checkSignal(signal);
    return prior &&
      prior.normalized_input_hash === envelope.normalizedInput.inputHash &&
      prior.title_input_hash === envelope.normalizedInput.titleHash &&
      prior.policy_id === envelope.policyId &&
      prior.acquired_content_hash === envelope.acquiredContentHash
      ? prior.id
      : envelope.metadata.articleVersionId;
  }
  async persistFailure(
    receipt: SemanticProcessingFailureReceipt,
    signal: AbortSignal,
  ): Promise<void> {
    checkSignal(signal);
    await this.database.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout', '5000', true)`.execute(transaction);
      checkSignal(signal);
      await transaction
        .insertInto('semantic_processing_failures')
        .values({
          id: newId(),
          article_id: parseUlid(receipt.articleId),
          source_id: parseUlid(receipt.sourceId),
          policy_id: receipt.policyId,
          provider_type: receipt.provider.providerType,
          provider_version: receipt.provider.providerVersion,
          run_identity: this.context.runIdentity,
          input_provenance: this.context.inputProvenance,
          error_code: receipt.errorCode,
          acquired_content_hash: receipt.acquiredContentHash,
          normalized_input_hash: receipt.normalizedInputHash,
          title_input_hash: receipt.titleInputHash,
          failed_at: receipt.failedAt,
        })
        .execute();
      checkSignal(signal);
    });
  }
  async persist(envelope: SemanticEnvelope, signal: AbortSignal): Promise<void> {
    checkSignal(signal);
    const articleId = parseUlid(envelope.metadata.articleId);
    const versionId = parseUlid(envelope.metadata.articleVersionId);
    const sourceId = parseUlid(envelope.metadata.sourceId);
    const providerRunId = parseUlid(envelope.providerRunId);
    const prospective = this.context.runIdentity === PROSPECTIVE_RUN_IDENTITY;
    if (
      (envelope as unknown as Record<string, unknown>).authority !== 'SHADOW_NOT_AUTHORITATIVE' ||
      envelope.reproducibilityClass !==
        (prospective ? 'FULL_REPLAYABLE' : 'HASH_VERIFIABLE_REFETCH_REQUIRED') ||
      (prospective &&
        (this.context.inputProvenance !== 'LIVE_REAL' ||
          envelope.accessMode !== 'FULLTEXT_PERSISTED' ||
          envelope.provider.providerType !== 'v10_11')) ||
      (this.context.inputProvenance === 'AUTHORED_STUB') !==
        (envelope.provider.providerType === 'authored_stub')
    )
      throw new Error('PERSISTENCE_FAILED');
    await this.database.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout', '5000', true)`.execute(transaction);
      await sql`select pg_advisory_xact_lock(hashtextextended(${articleId}, 18))`.execute(
        transaction,
      );
      checkSignal(signal);
      const prior = await transaction
        .selectFrom('observed_article_content_versions')
        .selectAll()
        .where('article_id', '=', articleId)
        .orderBy('version_number', 'desc')
        .executeTakeFirst();
      if (
        prospective &&
        (prior?.id !== versionId ||
          prior.persisted_body === null ||
          prior.original_title !== envelope.metadata.title ||
          prior.normalized_input_hash !== envelope.normalizedInput.inputHash ||
          prior.title_input_hash !== envelope.normalizedInput.titleHash ||
          prior.policy_id !== envelope.policyId ||
          prior.acquired_content_hash !== envelope.acquiredContentHash ||
          prior.normalization_version !== envelope.normalizedInput.normalizationVersion ||
          prior.input_codepoint_length !== envelope.normalizedInput.bodyCodepoints ||
          prior.title_codepoint_length !== envelope.normalizedInput.titleCodepoints)
      )
        throw new Error('PERSISTENCE_FAILED');
      if (
        prior &&
        prior.normalized_input_hash === envelope.normalizedInput.inputHash &&
        prior.title_input_hash === envelope.normalizedInput.titleHash &&
        prior.policy_id === envelope.policyId &&
        prior.acquired_content_hash === envelope.acquiredContentHash
      ) {
        if (prior.id !== versionId) throw new Error('PERSISTENCE_FAILED');
      } else {
        await transaction
          .insertInto('observed_article_content_versions')
          .values({
            id: versionId,
            article_id: articleId,
            source_id: sourceId,
            policy_id: envelope.policyId,
            previous_version_id: prior?.id ?? null,
            version_number: (prior?.version_number ?? 0) + 1,
            canonical_url: envelope.metadata.canonicalUrl,
            publisher_item_id: envelope.metadata.publisherItemId,
            original_title: envelope.metadata.title,
            published_at: envelope.metadata.publishedAt,
            available_at: envelope.metadata.availableAt,
            modified_at: envelope.metadata.modifiedAt,
            acquired_at: envelope.metadata.acquiredAt,
            language: envelope.metadata.language,
            content_encoding: envelope.metadata.contentEncoding,
            acquired_content_hash: envelope.acquiredContentHash,
            normalized_input_hash: envelope.normalizedInput.inputHash,
            title_input_hash: envelope.normalizedInput.titleHash,
            normalization_version: envelope.normalizedInput.normalizationVersion,
            input_codepoint_length: envelope.normalizedInput.bodyCodepoints,
            title_codepoint_length: envelope.normalizedInput.titleCodepoints,
            persisted_body: null,
            recorded_at: envelope.processedAt,
          })
          .execute();
      }
      checkSignal(signal);
      const existingRun = await transaction
        .selectFrom('semantic_provider_runs')
        .selectAll()
        .where('id', '=', providerRunId)
        .executeTakeFirst();
      if (existingRun) {
        if (
          existingRun.provider_type !== envelope.provider.providerType ||
          existingRun.provider_version !== envelope.provider.providerVersion ||
          existingRun.input_provenance !== this.context.inputProvenance ||
          existingRun.run_identity !== this.context.runIdentity ||
          existingRun.candidate_commit !== envelope.provider.candidateCommit ||
          existingRun.runtime_python !== (envelope.provider.runtime?.python ?? null) ||
          existingRun.runtime_model !== (envelope.provider.runtime?.model ?? null)
        )
          throw new Error('PERSISTENCE_FAILED');
      } else {
        await transaction
          .insertInto('semantic_provider_runs')
          .values({
            id: providerRunId,
            provider_type: envelope.provider.providerType,
            provider_version: envelope.provider.providerVersion,
            candidate_commit: envelope.provider.candidateCommit,
            runtime_python: envelope.provider.runtime?.python ?? null,
            runtime_model: envelope.provider.runtime?.model ?? null,
            run_identity: this.context.runIdentity,
            input_provenance: this.context.inputProvenance,
            created_at: envelope.processedAt,
          })
          .execute();
      }
      let previousRecordId: Ulid | null = null;
      let sequenceNumber = 0;
      const append = async (state: SemanticProcessingState): Promise<void> => {
        checkSignal(signal);
        const id = newId();
        await transaction
          .insertInto('semantic_processing_records')
          .values({
            id,
            article_version_id: versionId,
            provider_run_id: providerRunId,
            previous_record_id: previousRecordId,
            sequence_number: ++sequenceNumber,
            processing_state: state,
            error_code: null,
            recorded_at: envelope.processedAt,
          })
          .execute();
        previousRecordId = id;
      };
      await append('ELIGIBLE_UNPROCESSED');
      await append('PROCESSING');
      const envelopeId = newId();
      await transaction
        .insertInto('semantic_envelopes')
        .values({
          id: envelopeId,
          article_version_id: versionId,
          normalized_input_hash: envelope.normalizedInput.inputHash,
          normalization_version: envelope.normalizedInput.normalizationVersion,
          provider_type: envelope.provider.providerType,
          provider_version: envelope.provider.providerVersion,
          provider_run_id: providerRunId,
          reproducibility_class: envelope.reproducibilityClass,
          authority: envelope.authority,
          processed_at: envelope.processedAt,
        })
        .execute();
      for (const locator of envelope.evidence) {
        checkSignal(signal);
        if (
          locator.articleVersionId !== versionId ||
          locator.providerRunId !== providerRunId ||
          locator.normalizedInputHash !== envelope.normalizedInput.inputHash ||
          locator.acquiredContentHash !== envelope.acquiredContentHash ||
          locator.retainedQuote !== null
        )
          throw new Error('PERSISTENCE_FAILED');
        await transaction
          .insertInto('evidence_fingerprints')
          .values({
            id: newId(),
            envelope_id: envelopeId,
            article_version_id: versionId,
            provider_run_id: providerRunId,
            input_hash: locator.acquiredContentHash,
            normalized_input_hash: locator.normalizedInputHash,
            normalization_version: locator.normalizationVersion,
            field: locator.field,
            field_hash: locator.sourceSha256,
            span_start: locator.start,
            span_end: locator.end,
            span_hash: locator.spanSha256,
            context_hash: null,
            retained_quote: null,
          })
          .execute();
      }
      for (const observation of envelope.observations) {
        checkSignal(signal);
        await transaction
          .insertInto('derived_semantic_observations')
          .values({
            id: newId(),
            envelope_id: envelopeId,
            observation_key: observation.observationKey,
            decision: observation.decision,
            applicability: observation.applicability,
            proposed_occurrence_key: observation.proposedOccurrenceKey,
            proposed_thread_key: observation.proposedThreadKey,
          })
          .execute();
      }
      for (const proposal of envelope.articleProposals ?? []) {
        checkSignal(signal);
        await transaction
          .insertInto('semantic_article_proposals')
          .values({
            id: newId(),
            envelope_id: envelopeId,
            article_version_id: versionId,
            provider_run_id: providerRunId,
            action: proposal.action,
            reason_code: proposal.reasonCode,
            proposed_occurrence_key: proposal.proposedOccurrenceKey,
            proposed_thread_key: proposal.proposedThreadKey,
            partial_occurrence_creation: proposal.partialOccurrenceCreation,
          })
          .execute();
      }
      for (const applicability of envelope.candidateApplicability ?? []) {
        checkSignal(signal);
        await transaction
          .insertInto('semantic_candidate_applicability')
          .values({
            id: newId(),
            envelope_id: envelopeId,
            article_version_id: versionId,
            provider_run_id: providerRunId,
            scope: applicability.scope,
            target_key: applicability.targetKey,
            outcome: applicability.outcome,
          })
          .execute();
      }
      if (envelope.llm) {
        await transaction
          .insertInto('llm_shadow_observations')
          .values({
            envelope_id: envelopeId,
            cache_key: envelope.llm.cacheKey,
            config_hash: envelope.llm.config.configHash,
            structured_output: envelope.llm,
            recorded_at: envelope.processedAt,
          })
          .execute();
      }
      await append('PROCESSED_SHADOW');
      checkSignal(signal);
    });
  }
  /** Persists only a validated, body-free native graph after its envelopes exist. */
  async persistGraph(
    graph: Pick<FrozenBatchResult, 'occurrences' | 'threads' | 'streamHashes'> &
      Partial<Pick<FrozenBatchResult, 'nativeDiagnosticReceipt'>>,
    envelopes: readonly SemanticEnvelope[],
    signal: AbortSignal,
  ): Promise<string> {
    checkSignal(signal);
    const first = envelopes[0];
    const articleLimit = this.context.runIdentity === PROSPECTIVE_RUN_IDENTITY ? 150 : 40;
    if (
      !first ||
      envelopes.length > articleLimit ||
      new Set(envelopes.map((envelope) => envelope.metadata.articleId)).size !== envelopes.length ||
      envelopes.some(
        (envelope) =>
          envelope.providerRunId !== first.providerRunId ||
          (envelope as unknown as Record<string, unknown>).authority !== 'SHADOW_NOT_AUTHORITATIVE',
      )
    )
      throw new Error('PERSISTENCE_FAILED');
    const providerRunId = parseUlid(first.providerRunId);
    const snapshotId = newId();
    const recordedAt = new Date().toISOString();
    await this.database.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout', '5000', true)`.execute(transaction);
      await sql`select pg_advisory_xact_lock(hashtextextended(${providerRunId}, 19))`.execute(
        transaction,
      );
      checkSignal(signal);
      const run = await transaction
        .selectFrom('semantic_provider_runs')
        .selectAll()
        .where('id', '=', providerRunId)
        .executeTakeFirstOrThrow();
      if (
        run.input_provenance !== this.context.inputProvenance ||
        run.run_identity !== this.context.runIdentity ||
        (run.provider_type === 'v10_11' && !graph.nativeDiagnosticReceipt)
      )
        throw new Error('PERSISTENCE_FAILED');
      await transaction
        .insertInto('semantic_shadow_graph_snapshots')
        .values({
          id: snapshotId,
          provider_run_id: providerRunId,
          authority: 'SHADOW_NOT_AUTHORITATIVE',
          article_decisions_hash: graph.streamHashes.article_decisions ?? '',
          occurrence_memberships_hash: graph.streamHashes.occurrence_memberships ?? '',
          thread_memberships_hash: graph.streamHashes.thread_memberships ?? '',
          occurrence_generations_hash: graph.streamHashes.occurrence_generations ?? '',
          thread_generations_hash: graph.streamHashes.thread_generations ?? '',
          candidate_applicability_hash: graph.streamHashes.candidate_applicability ?? '',
          recorded_at: recordedAt,
        })
        .execute();
      for (const envelope of envelopes) {
        checkSignal(signal);
        const persisted = await transaction
          .selectFrom('semantic_envelopes')
          .selectAll()
          .where('article_version_id', '=', parseUlid(envelope.metadata.articleVersionId))
          .where('provider_run_id', '=', providerRunId)
          .executeTakeFirstOrThrow();
        if (persisted.normalized_input_hash !== envelope.normalizedInput.inputHash)
          throw new Error('PERSISTENCE_FAILED');
        await transaction
          .insertInto('semantic_shadow_graph_inputs')
          .values({
            snapshot_id: snapshotId,
            article_version_id: parseUlid(envelope.metadata.articleVersionId),
            envelope_id: persisted.id,
          })
          .execute();
      }
      for (const occurrence of graph.occurrences) {
        checkSignal(signal);
        await transaction
          .insertInto('semantic_shadow_graph_occurrences')
          .values({
            snapshot_id: snapshotId,
            occurrence_key: occurrence.key,
            thread_key: occurrence.threadKey,
            article_ids: occurrence.articleIds.map(parseUlid),
            generation_hash: occurrence.generationHash,
          })
          .execute();
      }
      for (const thread of graph.threads) {
        checkSignal(signal);
        await transaction
          .insertInto('semantic_shadow_graph_threads')
          .values({
            snapshot_id: snapshotId,
            thread_key: thread.key,
            occurrence_keys: [...thread.occurrenceKeys],
            article_ids: thread.articleIds.map(parseUlid),
            generation_hash: thread.generationHash,
          })
          .execute();
      }
      if (graph.nativeDiagnosticReceipt) {
        assertNativeDiagnosticReceipt(graph.nativeDiagnosticReceipt);
        const { canonicalSha256, ...receipt } = graph.nativeDiagnosticReceipt;
        await transaction
          .insertInto('semantic_native_diagnostic_receipts')
          .values({
            provider_run_id: providerRunId,
            snapshot_id: snapshotId,
            canonical_receipt: canonicalDiagnosticJson(receipt),
            canonical_sha256: canonicalSha256,
            native_output_sha256: receipt.nativeOutputSha256,
            projection_sha256: receipt.projectionSha256,
            recorded_at: recordedAt,
          })
          .execute();
      }
      checkSignal(signal);
      await transaction
        .insertInto('semantic_shadow_graph_seals')
        .values({ snapshot_id: snapshotId, sealed_at: recordedAt })
        .execute();
      checkSignal(signal);
    });
    return snapshotId;
  }
}
