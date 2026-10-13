import {
  parseUlid,
  type Database,
  type ProspectiveSemanticExperimentTable,
  type ProspectiveSemanticOutcomeTable,
} from '@dialektik/database';
import { sql, type Insertable, type Kysely } from 'kysely';
import type { FrozenBatchManifest } from './ephemeral.frozen-batch';
import type { ObservedArticleMetadata } from './ephemeral.contracts';
import { assertOriginalMetadata, sha256Utf8 } from './ephemeral.normalization';
import { bodyFreePersistenceError } from './ephemeral.persistence-errors';

export const PROSPECTIVE_RUN_IDENTITY = 'PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1';
export const PROSPECTIVE_CORPUS_IDENTITY = 'PROSPECTIVE_MULTISOURCE_SHADOW_CORPUS_V1';

export interface ProspectiveRunRegistration {
  readonly corpusManifestSha256: string;
  readonly preregistrationSha256: string;
  readonly exposureRegistrySha256: string;
  readonly moduleClosureSha256: string;
  readonly inputVersionIds: readonly string[];
  readonly registeredAt: string;
}
function assertSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('PROSPECTIVE_RUN_ABORTED');
}

/** Durable once-only accounting. It never invokes a provider or accepts source bodies. */
export class ProspectiveSemanticRunRepository {
  constructor(private readonly database: Kysely<Database>) {}

  /** Call in authorize() before reserve(); never selects or returns source text. */
  async authenticateRetainedInputs(
    manifest: FrozenBatchManifest,
    observedMetadata: readonly ObservedArticleMetadata[],
    signal: AbortSignal,
  ): Promise<void> {
    try {
      assertSignal(signal);
      if (manifest.runIdentity !== PROSPECTIVE_RUN_IDENTITY)
        throw new Error('PROSPECTIVE_RETAINED_INPUT_MISMATCH');
      await this.database.transaction().execute(async (transaction) => {
        await sql`select set_config('statement_timeout','5000',true)`.execute(transaction);
        const registered = await transaction
          .selectFrom('prospective_semantic_experiments')
          .selectAll()
          .where('run_identity', '=', PROSPECTIVE_RUN_IDENTITY)
          .executeTakeFirstOrThrow();
        if (
          registered.module_closure_sha256 !== manifest.sourceClosureSha256 ||
          registered.input_count !== manifest.articles.length ||
          observedMetadata.length !== manifest.articles.length ||
          registered.input_version_ids.some(
            (versionId, index) => versionId !== manifest.articles[index]?.articleVersionId,
          )
        )
          throw new Error('PROSPECTIVE_RETAINED_INPUT_MISMATCH');
        await sql`select dialektik_validate_prospective_inputs(${registered.input_version_ids}::text[],statement_timestamp())`.execute(
          transaction,
        );
        for (const [index, input] of manifest.articles.entries()) {
          assertSignal(signal);
          const metadata = observedMetadata[index];
          if (!metadata) throw new Error('PROSPECTIVE_RETAINED_INPUT_MISMATCH');
          assertOriginalMetadata(metadata, index + 1);
          const version = await transaction
            .selectFrom('observed_article_content_versions')
            .select([
              'id',
              'article_id',
              'source_id',
              'policy_id',
              'acquired_content_hash',
              'normalized_input_hash',
              'title_input_hash',
              'normalization_version',
              'input_codepoint_length',
              'title_codepoint_length',
              'canonical_url',
              'publisher_item_id',
              'published_at',
              'available_at',
              'modified_at',
              'acquired_at',
              'language',
              'content_encoding',
            ])
            .select(
              sql<boolean>`coalesce(original_title is not null and persisted_body is not null
            and char_length(original_title)=title_codepoint_length and char_length(persisted_body)=input_codepoint_length
            and encode(digest(convert_to(original_title,'UTF8'),'sha256'),'hex')=title_input_hash
            and encode(digest(convert_to(persisted_body,'UTF8'),'sha256'),'hex')=normalized_input_hash,false)`.as(
                'exact_copy_retained',
              ),
            )
            .where('id', '=', parseUlid(input.articleVersionId))
            .executeTakeFirstOrThrow();
          const retained = input.retainedInput;
          if (
            input.accessMode !== 'FULLTEXT_PERSISTED' ||
            input.articleId !== version.article_id ||
            input.sourceId !== version.source_id ||
            input.policyId !== version.policy_id ||
            input.acquiredContentHash !== version.acquired_content_hash ||
            input.inputHash !== version.normalized_input_hash ||
            input.titleHash !== version.title_input_hash ||
            metadata.articleId !== version.article_id ||
            metadata.articleVersionId !== version.id ||
            metadata.sourceId !== version.source_id ||
            metadata.canonicalUrl !== version.canonical_url ||
            metadata.publisherItemId !== version.publisher_item_id ||
            Date.parse(metadata.publishedAt) !== version.published_at.getTime() ||
            Date.parse(metadata.availableAt) !== version.available_at.getTime() ||
            Date.parse(metadata.acquiredAt) !== version.acquired_at.getTime() ||
            (metadata.modifiedAt === null ? null : Date.parse(metadata.modifiedAt)) !==
              (version.modified_at?.getTime() ?? null) ||
            metadata.language !== version.language ||
            (metadata as unknown as Record<string, unknown>).contentEncoding !==
              version.content_encoding ||
            sha256Utf8(metadata.title) !== version.title_input_hash ||
            !version.exact_copy_retained ||
            retained?.exactCopyRetained !== true ||
            retained.normalizedInputHash !== version.normalized_input_hash ||
            retained.titleInputHash !== version.title_input_hash ||
            retained.bodyCodepoints !== version.input_codepoint_length ||
            retained.titleCodepoints !== version.title_codepoint_length ||
            retained.normalizationVersion !== version.normalization_version ||
            (retained as unknown as Record<string, unknown>).offsetConvention !==
              'unicode_code_point_v1'
          )
            throw new Error('PROSPECTIVE_RETAINED_INPUT_MISMATCH');
        }
        assertSignal(signal);
      });
    } catch (error) {
      throw bodyFreePersistenceError(error, 'PROSPECTIVE_RETAINED_INPUT_MISMATCH');
    }
  }

  async register(input: ProspectiveRunRegistration, signal: AbortSignal): Promise<void> {
    assertSignal(signal);
    const row: Insertable<ProspectiveSemanticExperimentTable> = {
      run_identity: PROSPECTIVE_RUN_IDENTITY,
      corpus_identity: PROSPECTIVE_CORPUS_IDENTITY,
      corpus_manifest_sha256: input.corpusManifestSha256,
      preregistration_sha256: input.preregistrationSha256,
      exposure_registry_sha256: input.exposureRegistrySha256,
      candidate_commit: 'ea47eb75e955b9a51d15dc0135c81145130553ca',
      module_closure_sha256: input.moduleClosureSha256,
      runtime_python: '3.11.9',
      runtime_model: 'none',
      input_count: input.inputVersionIds.length,
      input_version_ids: input.inputVersionIds.map(parseUlid),
      registered_at: input.registeredAt,
    };
    await this.database.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout','5000',true)`.execute(transaction);
      assertSignal(signal);
      await transaction.insertInto('prospective_semantic_experiments').values(row).execute();
      assertSignal(signal);
    });
  }

  /** Must resolve and commit before invocation. Any existing row forbids all retries. */
  async reserve(
    providerRunId: string,
    expected: Pick<
      ProspectiveRunRegistration,
      | 'corpusManifestSha256'
      | 'preregistrationSha256'
      | 'exposureRegistrySha256'
      | 'moduleClosureSha256'
      | 'inputVersionIds'
    >,
    startedAt: string,
    signal: AbortSignal,
  ): Promise<void> {
    assertSignal(signal);
    await this.database.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout','5000',true)`.execute(transaction);
      assertSignal(signal);
      const registered = await transaction
        .selectFrom('prospective_semantic_experiments')
        .selectAll()
        .where('run_identity', '=', PROSPECTIVE_RUN_IDENTITY)
        .executeTakeFirstOrThrow();
      if (
        registered.corpus_manifest_sha256 !== expected.corpusManifestSha256 ||
        registered.preregistration_sha256 !== expected.preregistrationSha256 ||
        registered.exposure_registry_sha256 !== expected.exposureRegistrySha256 ||
        registered.module_closure_sha256 !== expected.moduleClosureSha256 ||
        registered.input_version_ids.length !== expected.inputVersionIds.length ||
        registered.input_version_ids.some(
          (versionId, index) => versionId !== expected.inputVersionIds[index],
        )
      )
        throw new Error('PROSPECTIVE_RUN_REGISTRATION_MISMATCH');
      await transaction
        .insertInto('prospective_semantic_reservations')
        .values({
          run_identity: PROSPECTIVE_RUN_IDENTITY,
          provider_run_id: parseUlid(providerRunId),
          state: 'STARTED',
          started_at: startedAt,
        })
        .execute();
      assertSignal(signal);
    });
  }

  /** Final body-free artifacts are written only while current Source grants remain locked. */
  async withCurrentDerivedPersistenceRights(
    providerRunId: string,
    expected: Pick<
      ProspectiveRunRegistration,
      | 'corpusManifestSha256'
      | 'preregistrationSha256'
      | 'exposureRegistrySha256'
      | 'moduleClosureSha256'
      | 'inputVersionIds'
    >,
    signal: AbortSignal,
    persistBodyFreeArtifacts: () => Promise<void>,
  ): Promise<void> {
    try {
      assertSignal(signal);
      await this.database.transaction().execute(async (transaction) => {
        await sql`select set_config('statement_timeout','5000',true)`.execute(transaction);
        const registered = await transaction
          .selectFrom('prospective_semantic_experiments')
          .selectAll()
          .where('run_identity', '=', PROSPECTIVE_RUN_IDENTITY)
          .executeTakeFirstOrThrow();
        const reservation = await transaction
          .selectFrom('prospective_semantic_reservations')
          .selectAll()
          .where('run_identity', '=', PROSPECTIVE_RUN_IDENTITY)
          .executeTakeFirstOrThrow();
        const outcome = await transaction
          .selectFrom('prospective_semantic_outcomes')
          .select('state')
          .where('run_identity', '=', PROSPECTIVE_RUN_IDENTITY)
          .executeTakeFirstOrThrow();
        if (
          registered.corpus_manifest_sha256 !== expected.corpusManifestSha256 ||
          registered.preregistration_sha256 !== expected.preregistrationSha256 ||
          registered.exposure_registry_sha256 !== expected.exposureRegistrySha256 ||
          registered.module_closure_sha256 !== expected.moduleClosureSha256 ||
          registered.input_version_ids.length !== expected.inputVersionIds.length ||
          registered.input_version_ids.some(
            (versionId, index) => versionId !== expected.inputVersionIds[index],
          ) ||
          reservation.provider_run_id !== parseUlid(providerRunId) ||
          outcome.state !== 'COMPLETED'
        )
          throw new Error('PROSPECTIVE_RUN_REGISTRATION_MISMATCH');
        const sources = await transaction
          .selectFrom('observed_article_content_versions')
          .select('source_id')
          .distinct()
          .where('id', 'in', registered.input_version_ids.map(parseUlid))
          .orderBy('source_id')
          .execute();
        if (sources.length < 3) throw new Error('PROSPECTIVE_RETAINED_INPUT_MISMATCH');
        // A policy append updates the same MVCC row. Lock every Source in stable order.
        for (const source of sources) {
          assertSignal(signal);
          await transaction
            .selectFrom('prospective_content_rights_write_guards')
            .select('source_id')
            .where('source_id', '=', source.source_id)
            .forUpdate()
            .executeTakeFirstOrThrow();
        }
        // Capture the current time after every potentially blocking Source lock.
        await sql`select dialektik_validate_prospective_inputs(${registered.input_version_ids}::text[],clock_timestamp())`.execute(
          transaction,
        );
        assertSignal(signal);
        await persistBodyFreeArtifacts();
        assertSignal(signal);
      });
    } catch (error) {
      throw bodyFreePersistenceError(error, 'PERSISTENCE_FAILED');
    }
  }
  async recordOutcome(
    state: ProspectiveSemanticOutcomeTable['state'],
    recordedAt: string,
    signal: AbortSignal,
  ): Promise<void> {
    assertSignal(signal);
    await this.database.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout','5000',true)`.execute(transaction);
      assertSignal(signal);
      await transaction
        .insertInto('prospective_semantic_outcomes')
        .values({ run_identity: PROSPECTIVE_RUN_IDENTITY, state, recorded_at: recordedAt })
        .execute();
      assertSignal(signal);
    });
  }
}
