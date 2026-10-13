import { generateUlid, type Database } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import type { EventAnalystValidation } from './llm.event-analyst.js';
import {
  TITLE_ONLY_CLOUDFLARE_PROVIDER,
  TITLE_ONLY_GPT_OSS_MODEL,
  titleOnlyPersistenceValues,
  type TitleOnlyProjectionAuthorization,
  type TitleOnlyProjectionContext,
  type TitleOnlyProjectionPersistence,
  type TitleOnlySemanticEnvelope,
} from './llm.title-only-projection.js';

export class CloudflareTitleOnlyProjectionRepository
  implements TitleOnlyProjectionAuthorization, TitleOnlyProjectionPersistence
{
  constructor(
    private readonly database: Kysely<Database>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async isAllowed(
    scope: 'EXTERNAL_INFERENCE' | 'DERIVED_SHADOW_PERSISTENCE',
    context: TitleOnlyProjectionContext,
  ): Promise<boolean> {
    const fn =
      scope === 'EXTERNAL_INFERENCE'
        ? sql<{
            allowed: boolean;
          }>`select dialektik_cloudflare_official_api_hash_only_route_allowed(
            ${context.sourceId}, ${context.articleId}, ${context.articleVersionId},
            ${context.projectionVersionId}, ${context.policyId}, ${context.acquiredContentSha256},
            ${context.projectionPolicyVersion}, ${context.projectionSha256},
            ${TITLE_ONLY_CLOUDFLARE_PROVIDER}, ${TITLE_ONLY_GPT_OSS_MODEL}
          ) as allowed`
        : sql<{
            allowed: boolean;
          }>`select dialektik_cloudflare_official_api_hash_only_persistence_allowed(
            ${context.sourceId}, ${context.articleId}, ${context.articleVersionId},
            ${context.projectionVersionId}, ${context.policyId}, ${context.acquiredContentSha256},
            ${context.projectionPolicyVersion}, ${context.projectionSha256},
            ${TITLE_ONLY_CLOUDFLARE_PROVIDER}, ${TITLE_ONLY_GPT_OSS_MODEL}
          ) as allowed`;
    const result = await fn.execute(this.database);
    return result.rows[0]?.allowed === true;
  }

  async reserveAttempt(context: TitleOnlyProjectionContext, runId: string): Promise<boolean> {
    const reservationId = generateUlid({ now: Date.now });
    const result = await sql<{ reservation_id: string | null }>`
      select dialektik_reserve_cloudflare_title_only_attempt(
        ${reservationId}, ${runId}, ${context.sourceId}, ${context.articleId},
        ${context.articleVersionId}, ${context.projectionVersionId}, ${context.policyId},
        ${context.acquiredContentSha256}, ${context.projectionPolicyVersion},
        ${context.projectionSha256}, ${TITLE_ONLY_CLOUDFLARE_PROVIDER}, ${TITLE_ONLY_GPT_OSS_MODEL}
      ) as reservation_id
    `.execute(this.database);
    return result.rows[0]?.reservation_id === reservationId;
  }

  async recordAttemptOutcome(
    _context: TitleOnlyProjectionContext,
    runId: string,
    outcome: Readonly<{
      state: 'RESPONSE_RECEIVED' | 'UNKNOWN_SENT';
      httpStatus: number | null;
      latencyMs: number;
      errorCategory: string | null;
    }>,
  ): Promise<void> {
    const reservation = await this.database
      .selectFrom('llm_cloudflare_title_only_attempt_reservations')
      .select('id')
      .where('run_id', '=', runId)
      .executeTakeFirst();
    if (!reservation) throw new Error('TITLE_ONLY_ATTEMPT_RESERVATION_NOT_FOUND');
    const result = await sql<{ recorded: boolean }>`
      select dialektik_record_cloudflare_title_only_attempt_outcome(
        ${reservation.id}, ${outcome.state}, ${outcome.httpStatus}, ${outcome.latencyMs},
        ${outcome.errorCategory}, date_trunc('milliseconds', clock_timestamp())
      ) as recorded
    `.execute(this.database);
    if (result.rows[0]?.recorded !== true)
      throw new Error('TITLE_ONLY_ATTEMPT_OUTCOME_RECORD_FAILED');
  }

  async persist(
    envelope: TitleOnlySemanticEnvelope,
    validated: EventAnalystValidation,
  ): Promise<void> {
    const context: TitleOnlyProjectionContext = {
      sourceId: envelope.metadata.sourceId,
      articleId: envelope.metadata.articleId,
      articleVersionId: envelope.metadata.articleVersionId,
      projectionVersionId: envelope.projectionVersionId,
      policyId: envelope.policyId,
      acquiredContentSha256: envelope.acquiredContentHash,
      normalizedBodySha256: envelope.normalizedInput.inputHash,
      titleSha256: envelope.normalizedInput.titleHash,
      projectionPolicyVersion: 'rsh-institutional-event-only-v1',
      projectionSha256: envelope.projectionSha256,
      normalizationVersion: envelope.normalizedInput.normalizationVersion,
      inputCodepointLength: envelope.normalizedInput.bodyCodepoints,
      titleCodepointLength: envelope.normalizedInput.titleCodepoints,
      attributionSha256: envelope.attributionSha256,
      schemaSha256: envelope.schemaSha256,
      skillSha256: envelope.skillSha256,
      acquiredAt: envelope.metadata.acquiredAt,
      processedAt: envelope.processedAt,
      metadata: {
        canonicalUrl: envelope.metadata.canonicalUrl,
        publisherItemId: envelope.metadata.publisherItemId,
        publishedAt: envelope.metadata.publishedAt,
        availableAt: envelope.metadata.availableAt,
        modifiedAt: envelope.metadata.modifiedAt,
        language: envelope.metadata.language,
      },
    };
    if (!(await this.isAllowed('DERIVED_SHADOW_PERSISTENCE', context)))
      throw new Error('TITLE_ONLY_DERIVED_PERSISTENCE_GRANT_REQUIRED');
    const row = titleOnlyPersistenceValues({
      envelope,
      validation: validated,
      id: generateUlid({ now: Date.now }),
      recordedAt: this.now(),
      schemaSha256: envelope.schemaSha256,
      skillSha256: envelope.skillSha256,
    });
    await this.database
      .insertInto('event_analyst_title_only_shadow_envelopes')
      .values(row)
      .execute();
  }
}
