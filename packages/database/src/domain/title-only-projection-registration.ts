import { sql, type Insertable, type Kysely } from 'kysely';
import type { Database } from '../database.types';
import type { OfficialApiHashOnlyProjectionVersionTable } from './llm-shadow.types';
import { parseUlid, type Ulid } from './ids';

export const TITLE_ONLY_SOURCE_ID = parseUlid('01M4CQTXP483R30JDW6EJQ6ADQ');
export const TITLE_ONLY_ARTICLE_ID = parseUlid('01M4CRBAXJPQEMJVXPKH1EY1N6');
export const TITLE_ONLY_ARTICLE_VERSION_ID = parseUlid('01M4CRBAXJX973BQ21979KQJ8W');
export const TITLE_ONLY_MODEL_ID = '@cf/openai/gpt-oss-20b' as const;

export interface TitleOnlyArticleVersionMetadata {
  readonly id: Ulid;
  readonly receiptId: Ulid;
  readonly publisherItemId: string;
  readonly publishedAt: Date | string;
  readonly firstAvailableAt: Date | string;
  readonly modifiedAt: Date | string | null;
  readonly acquiredAt: Date | string;
  readonly canonicalUrl: string;
  readonly language: string | null;
  readonly sourceBodySha256: string;
  readonly normalizedBodySha256: string;
  readonly acquisitionReceiptManifestSha256: string;
  readonly projectionSha256: string;
  readonly inputCodepointLength: number;
  readonly titleCodepointLength: number;
}

export interface RegisterTitleOnlyArticleVersionInput {
  readonly projection: Omit<
    Insertable<OfficialApiHashOnlyProjectionVersionTable>,
    'article_version_id' | 'receipt_id'
  >;
  readonly metadata: TitleOnlyArticleVersionMetadata;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('TITLE_ONLY_VERSION_METADATA_INVALID');
  return date.toISOString();
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date || expected instanceof Date)
    return iso(actual as Date | string) === iso(expected as Date | string);
  if (typeof actual === 'string' && expected instanceof Date) return iso(actual) === iso(expected);
  if (actual instanceof Date && typeof expected === 'string') return iso(actual) === iso(expected);
  return actual === expected;
}

function equalRow(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => sameValue(actual[key], value));
}

/**
 * Registers only exact hash provenance for the frozen GOV.UK Article.
 * It never writes a title, projection, prompt, or source body. It does not grant
 * inference or semantic persistence permission.
 */
export async function registerTitleOnlyArticleVersion(
  database: Kysely<Database>,
  input: RegisterTitleOnlyArticleVersionInput,
): Promise<Readonly<{ articleVersionId: Ulid; projectionVersionId: Ulid; inserted: boolean }>> {
  const { projection, metadata } = input;
  const acquiredAt =
    metadata.acquiredAt instanceof Date ? metadata.acquiredAt : new Date(metadata.acquiredAt);
  const firstAvailableAt =
    metadata.firstAvailableAt instanceof Date
      ? metadata.firstAvailableAt
      : new Date(metadata.firstAvailableAt);
  if (
    projection.source_id !== TITLE_ONLY_SOURCE_ID ||
    projection.article_id !== TITLE_ONLY_ARTICLE_ID ||
    projection.version_number !== 1 ||
    projection.previous_version_id !== null ||
    projection.projection_policy_version !== 'rsh-institutional-event-only-v1' ||
    !isHash(projection.acquired_content_sha256) ||
    !isHash(projection.source_body_sha256) ||
    !isHash(projection.normalized_body_sha256) ||
    !isHash(projection.title_sha256) ||
    !isHash(projection.projection_sha256) ||
    !isHash(metadata.sourceBodySha256) ||
    !isHash(metadata.normalizedBodySha256) ||
    !isHash(metadata.acquisitionReceiptManifestSha256) ||
    !isHash(metadata.projectionSha256) ||
    !metadata.canonicalUrl.startsWith('https://') ||
    !metadata.publisherItemId ||
    projection.source_body_sha256 !== metadata.sourceBodySha256 ||
    projection.normalized_body_sha256 !== metadata.normalizedBodySha256 ||
    projection.acquisition_receipt_sha256 !== metadata.acquisitionReceiptManifestSha256 ||
    projection.projection_sha256 !== metadata.projectionSha256 ||
    metadata.id !== TITLE_ONLY_ARTICLE_VERSION_ID ||
    !Number.isFinite(acquiredAt.getTime()) ||
    !Number.isFinite(firstAvailableAt.getTime()) ||
    firstAvailableAt.getTime() > acquiredAt.getTime() ||
    !Number.isSafeInteger(metadata.inputCodepointLength) ||
    metadata.inputCodepointLength <= 0 ||
    !Number.isSafeInteger(metadata.titleCodepointLength) ||
    metadata.titleCodepointLength <= 0
  ) {
    throw new Error('TITLE_ONLY_VERSION_METADATA_INVALID');
  }

  return database.transaction().execute(async (trx) => {
    const canonicalArticle = await trx
      .selectFrom('articles')
      .select('id')
      .where('id', '=', TITLE_ONLY_ARTICLE_ID)
      .executeTakeFirst();
    const policy = await trx
      .selectFrom('content_access_policies')
      .selectAll()
      .where('id', '=', projection.policy_id)
      .where('source_id', '=', TITLE_ONLY_SOURCE_ID)
      .where('recorded_at', '<=', acquiredAt)
      .orderBy('recorded_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const receipt = await trx
      .selectFrom('official_api_hash_only_acquisition_receipts as r')
      .innerJoin('live_source_policies as sourcePolicy', (join) =>
        join
          .onRef('sourcePolicy.id', '=', 'r.source_policy_id')
          .onRef('sourcePolicy.source_id', '=', 'r.source_id'),
      )
      .innerJoin(
        'live_exposure_exclusions as receiptExclusion',
        'receiptExclusion.id',
        'r.exclusion_id',
      )
      .innerJoin('sources as source', 'source.id', 'r.source_id')
      .select([
        'r.id',
        'r.source_id',
        'r.source_policy_id',
        'r.content_policy_id',
        'r.exclusion_id',
        'r.source_item_exclusion_id',
        'r.discovery_channel',
        'r.canonical_url',
        'r.source_item_id',
        'r.published_at',
        'r.modified_at',
        'r.first_available_at',
        'r.acquired_at',
        'r.acquired_content_sha256',
        'r.source_body_sha256',
        'r.normalized_body_sha256',
        'r.title_sha256',
        'r.acquisition_manifest_sha256',
        'source.origin as source_origin',
        'sourcePolicy.active as source_policy_active',
        'sourcePolicy.rights_class as source_policy_rights_class',
        'sourcePolicy.registry_key as source_policy_registry_key',
        'receiptExclusion.registry_key as receipt_exclusion_registry_key',
        'receiptExclusion.canonical_url as receipt_exclusion_url',
        'receiptExclusion.source_item_id as receipt_exclusion_item_id',
      ])
      .where('r.id', '=', metadata.receiptId)
      .executeTakeFirst();
    if (
      canonicalArticle !== undefined ||
      policy?.content_access_mode !== 'FULLTEXT_EPHEMERAL' ||
      !policy.metadata_storage ||
      !policy.fulltext_acquisition ||
      !policy.fulltext_machine_processing ||
      policy.fulltext_persistence ||
      policy.derived_semantic_persistence ||
      receipt?.source_id !== TITLE_ONLY_SOURCE_ID ||
      receipt.content_policy_id !== projection.policy_id ||
      receipt.source_item_id !== metadata.publisherItemId ||
      receipt.canonical_url !== metadata.canonicalUrl ||
      receipt.receipt_exclusion_url !== metadata.canonicalUrl ||
      (receipt.receipt_exclusion_item_id !== null &&
        receipt.receipt_exclusion_item_id !== receipt.source_item_id) ||
      receipt.source_origin !== 'LIVE_REAL' ||
      !receipt.source_policy_active ||
      receipt.source_policy_rights_class !== 'LIVE_READY' ||
      receipt.source_policy_registry_key !== receipt.receipt_exclusion_registry_key ||
      receipt.acquired_content_sha256 !== projection.acquired_content_sha256 ||
      receipt.source_body_sha256 !== projection.source_body_sha256 ||
      receipt.normalized_body_sha256 !== projection.normalized_body_sha256 ||
      receipt.title_sha256 !== projection.title_sha256 ||
      receipt.acquisition_manifest_sha256 !== projection.acquisition_receipt_sha256 ||
      iso(metadata.publishedAt) !== iso(receipt.published_at) ||
      iso(metadata.modifiedAt) !== iso(receipt.modified_at) ||
      iso(metadata.firstAvailableAt) !== iso(receipt.first_available_at) ||
      iso(metadata.acquiredAt) !== iso(receipt.acquired_at) ||
      iso(metadata.acquiredAt) === null ||
      acquiredAt.getTime() < firstAvailableAt.getTime()
    ) {
      throw new Error('TITLE_ONLY_LOCAL_REGISTRATION_RIGHTS_OR_VERSION_MISMATCH');
    }

    const exclusions = await sql<{ content_hash: string }>`
      select e.content_hash from live_exposure_exclusions e
      join live_exposure_exclusions identity_exclusion on identity_exclusion.id = ${receipt.exclusion_id}
      where e.canonical_url = ${metadata.canonicalUrl}
        and e.registry_key = identity_exclusion.registry_key
        and e.content_hash in (${projection.normalized_body_sha256}, ${projection.title_sha256})
        and e.exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'
    `.execute(trx);
    if (
      exclusions.rows.length !== 2 ||
      !exclusions.rows.some((row) => row.content_hash === projection.normalized_body_sha256) ||
      !exclusions.rows.some((row) => row.content_hash === projection.title_sha256)
    )
      throw new Error('TITLE_ONLY_EXACT_FINAL_V2_EXCLUSION_REQUIRED');
    const sourceItemExclusion = await trx
      .selectFrom('live_exposure_exclusions')
      .select('id')
      .where('id', '=', receipt.source_item_exclusion_id)
      .where('registry_key', '=', receipt.receipt_exclusion_registry_key)
      .where('canonical_url', 'is', null)
      .where('source_item_id', '=', metadata.publisherItemId)
      .where('exclusion_status', '=', 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')
      .executeTakeFirst();
    if (!sourceItemExclusion) throw new Error('TITLE_ONLY_PUBLISHER_ID_EXCLUSION_REQUIRED');

    const articleExpected = {
      article_id: TITLE_ONLY_ARTICLE_ID,
      source_id: TITLE_ONLY_SOURCE_ID,
      receipt_id: metadata.receiptId,
      exclusion_id: receipt.exclusion_id,
      content_policy_id: projection.policy_id,
      recorded_at: projection.recorded_at,
    };
    const existingArticle = await trx
      .selectFrom('official_api_hash_only_articles')
      .selectAll()
      .where('article_id', '=', TITLE_ONLY_ARTICLE_ID)
      .executeTakeFirst();
    let inserted = false;
    if (existingArticle) {
      if (!equalRow(existingArticle as unknown as Record<string, unknown>, articleExpected))
        throw new Error('TITLE_ONLY_HASH_REGISTRATION_CONFLICT');
    } else {
      await trx.insertInto('official_api_hash_only_articles').values(articleExpected).execute();
      inserted = true;
    }

    const expectedVersion: Insertable<Database['official_api_hash_only_article_versions']> = {
      id: metadata.id,
      article_id: TITLE_ONLY_ARTICLE_ID,
      source_id: TITLE_ONLY_SOURCE_ID,
      receipt_id: metadata.receiptId,
      content_policy_id: projection.policy_id,
      previous_version_id: null,
      version_number: 1,
      published_at: metadata.publishedAt,
      first_available_at: metadata.firstAvailableAt,
      modified_at: metadata.modifiedAt,
      acquired_at: metadata.acquiredAt,
      language: metadata.language,
      content_encoding: 'utf-8',
      acquired_content_sha256: projection.acquired_content_sha256,
      source_body_sha256: metadata.sourceBodySha256,
      normalized_body_sha256: metadata.normalizedBodySha256,
      title_sha256: projection.title_sha256,
      normalization_version: projection.normalization_version,
      input_codepoint_length: metadata.inputCodepointLength,
      title_codepoint_length: metadata.titleCodepointLength,
      recorded_at: projection.recorded_at,
    };
    const existingVersion = await trx
      .selectFrom('official_api_hash_only_article_versions')
      .selectAll()
      .where('id', '=', metadata.id)
      .executeTakeFirst();
    if (existingVersion) {
      if (!equalRow(existingVersion as unknown as Record<string, unknown>, expectedVersion))
        throw new Error('TITLE_ONLY_ARTICLE_VERSION_CONFLICT');
    } else {
      const prior = await trx
        .selectFrom('official_api_hash_only_article_versions')
        .select('id')
        .where('article_id', '=', TITLE_ONLY_ARTICLE_ID)
        .executeTakeFirst();
      if (prior) throw new Error('TITLE_ONLY_ARTICLE_VERSION_HISTORY_CONFLICT');
      await trx
        .insertInto('official_api_hash_only_article_versions')
        .values(expectedVersion)
        .execute();
      inserted = true;
    }

    const registeredProjection: Insertable<OfficialApiHashOnlyProjectionVersionTable> = {
      ...projection,
      article_version_id: metadata.id,
      receipt_id: metadata.receiptId,
    };
    const projectionFields = [
      'id',
      'source_id',
      'article_id',
      'article_version_id',
      'receipt_id',
      'policy_id',
      'previous_version_id',
      'version_number',
      'acquired_content_sha256',
      'source_body_sha256',
      'normalized_body_sha256',
      'title_sha256',
      'normalization_version',
      'projection_policy_version',
      'projection_sha256',
      'evidence_manifest_sha256',
      'acquisition_receipt_sha256',
      'rights_receipt_sha256',
      'local_authorization_receipt_sha256',
      'attribution_sha256',
      'recorded_at',
    ] as const;
    const existingProjection = await trx
      .selectFrom('official_api_hash_only_projection_versions')
      .select(projectionFields)
      .where('id', '=', projection.id)
      .executeTakeFirst();
    const projectionExpected = registeredProjection as unknown as Record<string, unknown>;
    if (existingProjection) {
      if (!equalRow(existingProjection, projectionExpected))
        throw new Error('TITLE_ONLY_PROJECTION_VERSION_CONFLICT');
    } else {
      const prior = await trx
        .selectFrom('official_api_hash_only_projection_versions')
        .select('id')
        .where('article_id', '=', TITLE_ONLY_ARTICLE_ID)
        .executeTakeFirst();
      if (prior) throw new Error('TITLE_ONLY_PROJECTION_VERSION_HISTORY_CONFLICT');
      await trx
        .insertInto('official_api_hash_only_projection_versions')
        .values(registeredProjection)
        .execute();
      inserted = true;
    }
    const audit = await sql<{ inferred: boolean; persisted: boolean }>`
      select
        dialektik_cloudflare_official_api_hash_only_route_allowed(
          ${TITLE_ONLY_SOURCE_ID}, ${TITLE_ONLY_ARTICLE_ID}, ${metadata.id}, ${projection.id},
          ${projection.policy_id}, ${projection.acquired_content_sha256}, ${projection.projection_policy_version},
          ${projection.projection_sha256}, 'llm_cloudflare_workers_ai', ${TITLE_ONLY_MODEL_ID}
        ) as inferred,
        dialektik_cloudflare_official_api_hash_only_persistence_allowed(
          ${TITLE_ONLY_SOURCE_ID}, ${TITLE_ONLY_ARTICLE_ID}, ${metadata.id}, ${projection.id},
          ${projection.policy_id}, ${projection.acquired_content_sha256}, ${projection.projection_policy_version},
          ${projection.projection_sha256}, 'llm_cloudflare_workers_ai', ${TITLE_ONLY_MODEL_ID}
        ) as persisted
    `.execute(trx);
    const grantState = audit.rows[0];
    if (!grantState) throw new Error('TITLE_ONLY_SEMANTIC_GRANT_STATE_UNAVAILABLE');
    if (grantState.inferred || grantState.persisted)
      throw new Error('TITLE_ONLY_VERSION_REGISTRATION_ACTIVATED_SEMANTIC_GRANT');
    return Object.freeze({
      articleVersionId: metadata.id,
      projectionVersionId: projection.id,
      inserted,
    });
  });
}
