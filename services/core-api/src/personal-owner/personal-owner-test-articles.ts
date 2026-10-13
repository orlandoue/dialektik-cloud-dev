import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  generateUlid,
  parseUlid,
  registerTitleOnlyArticleVersion,
  TITLE_ONLY_ARTICLE_ID,
  TITLE_ONLY_ARTICLE_VERSION_ID,
  TITLE_ONLY_MODEL_ID,
  TITLE_ONLY_SOURCE_ID,
} from '@dialektik/database';
import { sql } from 'kysely';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CORE_API_CONFIG } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { EVENT_ANALYST_SCHEMA } from '../llm-shadow/llm.event-analyst.js';
import {
  GOVUK_ATTRIBUTION,
  GOVUK_CONTENT_API_URL,
  GOVUK_FIRST_ARTICLE_URL,
  parseGovUkContentItem,
  hashBytes,
  type ParsedGovUkContentItem,
} from '../live/govuk-content-api-parser.js';
import type { PersonalOwnerTestJobRequest } from './personal-owner-test-workflow.js';

export const PERSONAL_OWNER_TEST_FIXTURE_ID = 'synthetic-govuk-title-only-v1' as const;
export const PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID = '00000000-0000-4000-8000-000000000001';
export const PERSONAL_OWNER_TEST_FIXTURE_TITLE =
  'Synthetic housing regulator issues an institutional compliance notice';
export const PERSONAL_OWNER_TEST_FIXTURE_BODY =
  'Synthetic fixture body: the housing regulator issued an institutional compliance notice on 7 October 2026.';
const FIXTURE_REGISTRY_KEY = 'PERSONAL_OWNER_SYNTHETIC_GOVUK_FIXTURE_V1';
const PROJECTION_POLICY_VERSION = 'rsh-institutional-event-only-v1';
const NORMALIZATION_VERSION = 'govuk-content-api-normalization-v1';
const MAX_API_BYTES = 4 * 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface PersonalOwnerTestArticleSummary {
  readonly fixtureId: typeof PERSONAL_OWNER_TEST_FIXTURE_ID;
  readonly sourceId: string;
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly projectionVersionId: string;
  readonly projectionSha256: string;
  readonly titleSha256: string;
  readonly title: string;
  readonly publisher: 'Regulator of Social Housing';
  readonly publishedAt: string;
  readonly acquisitionMode: 'SYNTHETIC_LOOPBACK_FIXTURE';
}

export interface PersonalOwnerTestArticleInput {
  readonly context: Readonly<{
    sourceId: string;
    articleId: string;
    articleVersionId: string;
    projectionVersionId: string;
    policyId: string;
    acquiredContentSha256: string;
    normalizedBodySha256: string;
    titleSha256: string;
    projectionPolicyVersion: string;
    projectionSha256: string;
    normalizationVersion: string;
    inputCodepointLength: number;
    titleCodepointLength: number;
    attributionSha256: string;
    schemaSha256: string;
    skillSha256: string;
    acquiredAt: string;
    processedAt: string;
    metadata: Readonly<{
      canonicalUrl: string;
      publisherItemId: string;
      publishedAt: string;
      availableAt: string;
      modifiedAt: string | null;
      language: string | null;
    }>;
  }>;
  readonly projection: Readonly<{ title: string; language: string | null }>;
  readonly skillInstruction: string;
}

export interface PersonalOwnerTestAuthorizationSummary {
  readonly id: string;
  readonly operation: 'MOCKED_TITLE_ONLY_INFERENCE' | 'MOCKED_DERIVED_SHADOW_PERSISTENCE';
  readonly validFrom: string;
  readonly expiresAt: string;
}

export interface PersonalOwnerTestAuthorizationList {
  readonly ownerIdentity: string;
  readonly sourceId: string;
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly projectionVersionId: string;
  readonly projectionSha256: string;
  readonly provider: 'llm_cloudflare_workers_ai';
  readonly model: '@cf/openai/gpt-oss-20b';
  readonly authorizations: readonly PersonalOwnerTestAuthorizationSummary[];
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredDatabaseClock(value: Date | undefined): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error('PERSONAL_TEST_DATABASE_CLOCK_UNAVAILABLE');
  return value;
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('PERSONAL_TEST_SOURCE_BODY_MISSING');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      length += chunk.length;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error('PERSONAL_TEST_SOURCE_RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  } finally {
    reader.releaseLock();
  }
}

function assertFixtureItem(item: ParsedGovUkContentItem): void {
  const body = item.body.toString('utf8');
  if (
    item.contentId !== PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID ||
    item.title !== PERSONAL_OWNER_TEST_FIXTURE_TITLE ||
    item.publisher !== 'Regulator of Social Housing' ||
    item.basePath !== new URL(GOVUK_FIRST_ARTICLE_URL).pathname ||
    body !== PERSONAL_OWNER_TEST_FIXTURE_BODY
  )
    throw new Error('PERSONAL_TEST_GOVUK_FIXTURE_IDENTITY_MISMATCH');
}

function isExpectedFixtureId(value: string): boolean {
  return value === PERSONAL_OWNER_TEST_FIXTURE_ID;
}

@Injectable()
export class PersonalOwnerTestArticlesService {
  constructor(
    @Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>,
    @Inject(CoreDatabaseService) private readonly database: CoreDatabaseService,
  ) {}

  private assertEnabled(): void {
    let databaseUrl: URL;
    try {
      databaseUrl = new URL(this.config.databaseUrl);
    } catch {
      throw new ServiceUnavailableException('PERSONAL_OWNER_TEST_MODE_DISABLED');
    }
    if (
      !['test', 'development'].includes(this.config.nodeEnvironment) ||
      this.config.ownershipMode !== 'personal' ||
      this.config.semanticMode !== 'unassigned' ||
      !LOOPBACK.has(this.config.host) ||
      !LOOPBACK.has(databaseUrl.hostname) ||
      !/^\/dialektik_test_[a-z0-9_]+$/u.test(databaseUrl.pathname) ||
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_MODE !== '1' ||
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_PROVIDER_MODE !== 'mock'
    )
      throw new ServiceUnavailableException('PERSONAL_OWNER_TEST_MODE_DISABLED');
  }

  private sourceFixtureUrl(): URL {
    const raw = process.env.DIALEKTIK_PERSONAL_OWNER_TEST_SOURCE_URL;
    if (!raw) throw new Error('PERSONAL_TEST_SOURCE_FIXTURE_UNAVAILABLE');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('PERSONAL_TEST_SOURCE_FIXTURE_URL_INVALID');
    }
    if (
      url.protocol !== 'http:' ||
      !LOOPBACK.has(url.hostname) ||
      url.pathname !== '/api/content' + new URL(GOVUK_FIRST_ARTICLE_URL).pathname ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('PERSONAL_TEST_SOURCE_FIXTURE_URL_INVALID');
    return url;
  }

  private async acquireFixture(): Promise<{
    readonly bytes: Buffer;
    readonly item: ParsedGovUkContentItem;
    readonly acquiredAt: Date;
    readonly sourceReceiptSha256: string;
  }> {
    const endpoint = this.sourceFixtureUrl();
    const response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (response.status !== 200 || contentType !== 'application/json')
      throw new Error('PERSONAL_TEST_SOURCE_FIXTURE_RESPONSE_INVALID');
    const bytes = await readBoundedResponse(response, MAX_API_BYTES);
    try {
      const item = parseGovUkContentItem(bytes, GOVUK_FIRST_ARTICLE_URL);
      assertFixtureItem(item);
      const acquiredAt = await this.databaseNow();
      return {
        bytes,
        item,
        acquiredAt,
        sourceReceiptSha256: sha256(
          JSON.stringify({
            endpoint: GOVUK_CONTENT_API_URL,
            fixtureEndpoint: endpoint.pathname,
            status: response.status,
            contentType,
            responseBytesSha256: hashBytes(bytes),
            fixturePolicy: 'loopback-only-test-fixture-v1',
          }),
        ),
      };
    } catch (error) {
      bytes.fill(0);
      throw error;
    }
  }

  private async databaseNow(): Promise<Date> {
    const result = await sql<{ now: Date }>`
      select date_trunc('milliseconds', clock_timestamp()) as now
    `.execute(this.database.database);
    return requiredDatabaseClock(result.rows[0]?.now);
  }

  async ingest(): Promise<PersonalOwnerTestArticleSummary> {
    this.assertEnabled();
    const acquired = await this.acquireFixture();
    const database = this.database.database;
    const dbNow = acquired.acquiredAt;
    try {
      const item = acquired.item;
      const publishedAt = new Date(item.firstPublishedAt);
      const firstAvailableAt = publishedAt;
      const bodyText = item.body.toString('utf8');
      const normalizedBodySha256 = hashBytes(item.body);
      const titleSha256 = sha256(item.title);
      const acquiredContentSha256 = hashBytes(acquired.bytes);
      const attributionSha256 = sha256(GOVUK_ATTRIBUTION);
      const policyId = sha256('personal-owner-test-content-policy:' + String(TITLE_ONLY_SOURCE_ID));
      const sourcePolicyId = sha256(
        'personal-owner-test-source-policy:' + String(TITLE_ONLY_SOURCE_ID),
      );
      const identityExclusionId = sha256(FIXTURE_REGISTRY_KEY + ':url:' + GOVUK_FIRST_ARTICLE_URL);
      const sourceItemExclusionId = sha256(
        FIXTURE_REGISTRY_KEY + ':publisher-id:' + PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID,
      );
      const contentExclusionId = sha256(FIXTURE_REGISTRY_KEY + ':body:' + normalizedBodySha256);
      const titleExclusionId = sha256(FIXTURE_REGISTRY_KEY + ':title:' + titleSha256);
      const existing = await database
        .selectFrom('official_api_hash_only_projection_versions')
        .selectAll()
        .where('article_id', '=', TITLE_ONLY_ARTICLE_ID)
        .executeTakeFirst();
      if (existing) {
        if (
          existing.acquired_content_sha256 !== acquiredContentSha256 ||
          existing.normalized_body_sha256 !== normalizedBodySha256 ||
          existing.title_sha256 !== titleSha256
        )
          throw new Error('PERSONAL_TEST_FIXTURE_VERSION_CONFLICT');
        return await this.readSummary(existing.id, item, existing.projection_sha256);
      }

      await database
        .insertInto('sources')
        .values({
          id: TITLE_ONLY_SOURCE_ID,
          name: 'Synthetic GOV.UK Content API fixture source',
          source_type: 'other',
          canonical_domain: 'www.gov.uk',
          is_issuing_entity: false,
          created_at: dbNow,
          origin: 'LIVE_REAL',
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      await database
        .insertInto('live_source_policies')
        .values({
          id: sourcePolicyId,
          source_id: TITLE_ONLY_SOURCE_ID,
          registry_key: FIXTURE_REGISTRY_KEY,
          rights_class: 'LIVE_READY',
          storage_policy: 'METADATA_ONLY',
          active: true,
          rights_evidence_url: 'https://synthetic.invalid/test-fixture-source-policy',
          rights_verified_at: dbNow,
          policy: { fixtureOnly: true, source: 'synthetic-loopback' },
          recorded_at: dbNow,
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      await database
        .insertInto('content_access_policies')
        .values({
          id: policyId,
          source_id: TITLE_ONLY_SOURCE_ID,
          content_access_mode: 'FULLTEXT_EPHEMERAL',
          metadata_storage: true,
          excerpt_storage: false,
          fulltext_acquisition: true,
          fulltext_machine_processing: true,
          fulltext_persistence: false,
          derived_semantic_persistence: false,
          minimal_evidence_fragment: false,
          redisplay: false,
          external_source_link: true,
          evidence_quote_max_codepoints: 0,
          rights_evidence_url: 'https://synthetic.invalid/test-fixture-article-policy',
          rights_verified_at: dbNow,
          recorded_at: dbNow,
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      await database
        .insertInto('live_exposure_exclusions')
        .values([
          {
            id: identityExclusionId,
            registry_key: FIXTURE_REGISTRY_KEY,
            publisher_name: 'Synthetic GOV.UK API fixture publisher',
            canonical_url: GOVUK_FIRST_ARTICLE_URL,
            source_item_id: null,
            published_at: publishedAt,
            first_seen_at: firstAvailableAt,
            discovery_url: null,
            reason: 'Synthetic acquisition fixture permanently excluded from Final V2.',
            content_hash: null,
            near_duplicate_signature: null,
            exclusion_status: 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
          },
          {
            id: sourceItemExclusionId,
            registry_key: FIXTURE_REGISTRY_KEY,
            publisher_name: 'Synthetic GOV.UK API fixture publisher',
            canonical_url: null,
            source_item_id: PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID,
            published_at: publishedAt,
            first_seen_at: firstAvailableAt,
            discovery_url: null,
            reason: 'Synthetic publisher identifier permanently excluded from Final V2.',
            content_hash: null,
            near_duplicate_signature: null,
            exclusion_status: 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
          },
          {
            id: contentExclusionId,
            registry_key: FIXTURE_REGISTRY_KEY,
            publisher_name: 'Synthetic GOV.UK API fixture publisher',
            canonical_url: GOVUK_FIRST_ARTICLE_URL,
            source_item_id: PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID,
            published_at: publishedAt,
            first_seen_at: firstAvailableAt,
            discovery_url: null,
            reason: 'Synthetic exact content permanently excluded from Final V2.',
            content_hash: normalizedBodySha256,
            near_duplicate_signature: null,
            exclusion_status: 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
          },
          {
            id: titleExclusionId,
            registry_key: FIXTURE_REGISTRY_KEY,
            publisher_name: 'Synthetic GOV.UK API fixture publisher',
            canonical_url: GOVUK_FIRST_ARTICLE_URL,
            source_item_id: PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID,
            published_at: publishedAt,
            first_seen_at: firstAvailableAt,
            discovery_url: null,
            reason: 'Synthetic exact title permanently excluded from Final V2.',
            content_hash: titleSha256,
            near_duplicate_signature: null,
            exclusion_status: 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
          },
        ])
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      const receiptId = generateUlid({ now: () => dbNow.getTime() });
      const projectionVersionId = generateUlid({ now: () => dbNow.getTime() + 1 });
      const evidenceManifestSha256 = sha256(
        JSON.stringify({
          fixtureId: PERSONAL_OWNER_TEST_FIXTURE_ID,
          blockId: 'B001',
          field: 'title',
          titleSha256,
        }),
      );
      const acquisitionManifestSha256 = sha256(
        JSON.stringify({
          endpoint: GOVUK_CONTENT_API_URL,
          parser: 'govuk-content-api-parser-v1',
          acquiredContentSha256,
          sourceBodySha256: item.sourceBodySha256,
          normalizedBodySha256,
          titleSha256,
        }),
      );
      const rightsReceiptSha256 = sha256(
        'Synthetic-only permission fixture; no publisher rights or real content is represented.',
      );
      const localAuthorizationReceiptSha256 = sha256(
        'Local disposable V6-R fixture authorization only; external grants are synthetic test artifacts.',
      );
      await database
        .insertInto('official_api_hash_only_acquisition_receipts')
        .values({
          id: receiptId,
          source_id: TITLE_ONLY_SOURCE_ID,
          article_id: TITLE_ONLY_ARTICLE_ID,
          source_policy_id: sourcePolicyId,
          content_policy_id: policyId,
          exclusion_id: identityExclusionId,
          source_item_exclusion_id: sourceItemExclusionId,
          content_exclusion_id: contentExclusionId,
          title_exclusion_id: titleExclusionId,
          discovery_channel: 'official_api',
          discovery_url: GOVUK_CONTENT_API_URL,
          canonical_url: GOVUK_FIRST_ARTICLE_URL,
          source_item_id: PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID,
          published_at: publishedAt,
          modified_at: item.publicUpdatedAt === null ? null : new Date(item.publicUpdatedAt),
          first_available_at: firstAvailableAt,
          acquired_at: dbNow,
          acquired_content_sha256: acquiredContentSha256,
          source_body_sha256: item.sourceBodySha256,
          normalized_body_sha256: normalizedBodySha256,
          title_sha256: titleSha256,
          source_receipt_sha256: acquired.sourceReceiptSha256,
          acquisition_manifest_sha256: acquisitionManifestSha256,
          evidence_manifest_sha256: evidenceManifestSha256,
          rights_receipt_sha256: rightsReceiptSha256,
          local_authorization_receipt_sha256: localAuthorizationReceiptSha256,
          attribution_sha256: attributionSha256,
          robots_sha256: sha256('loopback fixture only; no publisher request or robots claim'),
        })
        .execute();

      const projectionSha256 = sha256(
        JSON.stringify({
          projectionPolicyVersion: PROJECTION_POLICY_VERSION,
          titleSha256,
          language: item.locale,
          attributionSha256,
        }),
      );
      const registration = {
        projection: {
          id: projectionVersionId,
          source_id: TITLE_ONLY_SOURCE_ID,
          article_id: TITLE_ONLY_ARTICLE_ID,
          policy_id: policyId,
          previous_version_id: null,
          version_number: 1,
          acquired_content_sha256: acquiredContentSha256,
          source_body_sha256: item.sourceBodySha256,
          normalized_body_sha256: normalizedBodySha256,
          title_sha256: titleSha256,
          normalization_version: NORMALIZATION_VERSION,
          projection_policy_version: PROJECTION_POLICY_VERSION,
          projection_sha256: projectionSha256,
          evidence_manifest_sha256: evidenceManifestSha256,
          acquisition_receipt_sha256: acquisitionManifestSha256,
          rights_receipt_sha256: rightsReceiptSha256,
          local_authorization_receipt_sha256: localAuthorizationReceiptSha256,
          attribution_sha256: attributionSha256,
          recorded_at: dbNow,
        },
        metadata: {
          id: TITLE_ONLY_ARTICLE_VERSION_ID,
          receiptId,
          publisherItemId: PERSONAL_OWNER_TEST_FIXTURE_CONTENT_ID,
          publishedAt,
          firstAvailableAt,
          modifiedAt: item.publicUpdatedAt === null ? null : new Date(item.publicUpdatedAt),
          acquiredAt: dbNow,
          canonicalUrl: GOVUK_FIRST_ARTICLE_URL,
          language: item.locale,
          sourceBodySha256: item.sourceBodySha256,
          normalizedBodySha256,
          acquisitionReceiptManifestSha256: acquisitionManifestSha256,
          projectionSha256,
          inputCodepointLength: Array.from(bodyText).length,
          titleCodepointLength: Array.from(item.title).length,
        },
      } as const;
      await registerTitleOnlyArticleVersion(database, registration);
      return await this.readSummary(projectionVersionId, item, projectionSha256);
    } finally {
      acquired.bytes.fill(0);
      acquired.item.body.fill(0);
    }
  }

  async list(): Promise<readonly PersonalOwnerTestArticleSummary[]> {
    this.assertEnabled();
    const projection = await this.database.database
      .selectFrom('official_api_hash_only_projection_versions')
      .select(['id', 'projection_sha256'])
      .where('article_id', '=', TITLE_ONLY_ARTICLE_ID)
      .executeTakeFirst();
    if (!projection) return [];
    const acquired = await this.acquireFixture();
    try {
      const row = await this.database.database
        .selectFrom('official_api_hash_only_article_versions')
        .select(['acquired_content_sha256', 'normalized_body_sha256', 'title_sha256'])
        .where('id', '=', TITLE_ONLY_ARTICLE_VERSION_ID)
        .executeTakeFirstOrThrow();
      if (
        row.acquired_content_sha256 !== hashBytes(acquired.bytes) ||
        row.normalized_body_sha256 !== hashBytes(acquired.item.body) ||
        row.title_sha256 !== sha256(acquired.item.title)
      )
        throw new Error('PERSONAL_TEST_FIXTURE_VERSION_CONFLICT');
      return [await this.readSummary(projection.id, acquired.item, projection.projection_sha256)];
    } finally {
      acquired.bytes.fill(0);
      acquired.item.body.fill(0);
    }
  }

  async listAuthorizations(): Promise<PersonalOwnerTestAuthorizationList> {
    this.assertEnabled();
    const projection = await this.database.database
      .selectFrom('official_api_hash_only_projection_versions')
      .select(['id', 'projection_sha256'])
      .where('article_id', '=', TITLE_ONLY_ARTICLE_ID)
      .executeTakeFirst();
    if (!projection) throw new Error('PERSONAL_TEST_ARTICLE_NOT_REGISTERED');
    const now = await this.databaseNow();
    const rows = await this.database.database
      .selectFrom('personal_owner_test_authorizations')
      .select(['id', 'operation', 'valid_from', 'expires_at'])
      .where('owner_identity', '=', this.config.personalOwnerId ?? '')
      .where('source_id', '=', TITLE_ONLY_SOURCE_ID)
      .where('article_id', '=', TITLE_ONLY_ARTICLE_ID)
      .where('article_version_id', '=', TITLE_ONLY_ARTICLE_VERSION_ID)
      .where('projection_version_id', '=', projection.id)
      .where('provider_type', '=', 'llm_cloudflare_workers_ai')
      .where('model_id', '=', TITLE_ONLY_MODEL_ID)
      .where('environment_scope', '=', 'ISOLATED_TEST_ONLY')
      .where('decision_status', '=', 'APPROVED')
      .where('revoked_at', 'is', null)
      .where('valid_from', '<=', now)
      .where('expires_at', '>', now)
      .orderBy('recorded_at', 'desc')
      .execute();
    return {
      ownerIdentity: this.config.personalOwnerId ?? '',
      sourceId: String(TITLE_ONLY_SOURCE_ID),
      articleId: String(TITLE_ONLY_ARTICLE_ID),
      articleVersionId: String(TITLE_ONLY_ARTICLE_VERSION_ID),
      projectionVersionId: String(projection.id),
      projectionSha256: projection.projection_sha256,
      provider: 'llm_cloudflare_workers_ai',
      model: '@cf/openai/gpt-oss-20b',
      authorizations: rows.map((row) => ({
        id: String(row.id),
        operation: row.operation,
        validFrom: row.valid_from.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      })),
    };
  }

  async loadVerifiedInput(
    request: PersonalOwnerTestJobRequest,
  ): Promise<PersonalOwnerTestArticleInput> {
    this.assertEnabled();
    if (
      !isExpectedFixtureId(request.fixtureId) ||
      request.sourceId !== String(TITLE_ONLY_SOURCE_ID) ||
      request.articleId !== String(TITLE_ONLY_ARTICLE_ID) ||
      request.articleVersionId !== String(TITLE_ONLY_ARTICLE_VERSION_ID)
    )
      throw new Error('PERSONAL_TEST_JOB_SCOPE_INVALID');
    const projection = await this.database.database
      .selectFrom('official_api_hash_only_projection_versions')
      .innerJoin(
        'official_api_hash_only_article_versions',
        'official_api_hash_only_article_versions.id',
        'official_api_hash_only_projection_versions.article_version_id',
      )
      .innerJoin(
        'official_api_hash_only_acquisition_receipts',
        'official_api_hash_only_acquisition_receipts.id',
        'official_api_hash_only_projection_versions.receipt_id',
      )
      .select([
        'official_api_hash_only_projection_versions.id as projection_id',
        'official_api_hash_only_projection_versions.policy_id',
        'official_api_hash_only_projection_versions.projection_policy_version',
        'official_api_hash_only_projection_versions.projection_sha256',
        'official_api_hash_only_projection_versions.acquired_content_sha256',
        'official_api_hash_only_projection_versions.source_body_sha256',
        'official_api_hash_only_projection_versions.normalized_body_sha256',
        'official_api_hash_only_projection_versions.title_sha256',
        'official_api_hash_only_projection_versions.normalization_version',
        'official_api_hash_only_projection_versions.attribution_sha256',
        'official_api_hash_only_article_versions.input_codepoint_length',
        'official_api_hash_only_article_versions.title_codepoint_length',
        'official_api_hash_only_article_versions.language',
        'official_api_hash_only_article_versions.acquired_at',
        'official_api_hash_only_article_versions.published_at',
        'official_api_hash_only_article_versions.first_available_at',
        'official_api_hash_only_article_versions.modified_at',
        'official_api_hash_only_acquisition_receipts.canonical_url',
        'official_api_hash_only_acquisition_receipts.source_item_id',
      ])
      .where(
        'official_api_hash_only_projection_versions.id',
        '=',
        parseUlid(request.projectionVersionId),
      )
      .where('official_api_hash_only_projection_versions.article_id', '=', TITLE_ONLY_ARTICLE_ID)
      .executeTakeFirst();
    if (!projection || projection.projection_sha256 !== request.projectionSha256)
      throw new Error('PERSONAL_TEST_JOB_SCOPE_INVALID');

    const acquired = await this.acquireFixture();
    try {
      const currentBodySha256 = hashBytes(acquired.item.body);
      const currentTitleSha256 = sha256(acquired.item.title);
      if (
        hashBytes(acquired.bytes) !== projection.acquired_content_sha256 ||
        acquired.item.sourceBodySha256 !== projection.source_body_sha256 ||
        currentBodySha256 !== projection.normalized_body_sha256 ||
        currentTitleSha256 !== projection.title_sha256 ||
        acquired.item.title !== PERSONAL_OWNER_TEST_FIXTURE_TITLE
      )
        throw new Error('PERSONAL_TEST_FIXTURE_VERSION_CONFLICT');
      const skillInstruction = await readFile(
        resolve(process.cwd(), 'skills/dialektik-event-analyst/v1/SKILL.md'),
        'utf8',
      );
      const processedAt = await this.databaseNow();
      return {
        context: {
          sourceId: String(TITLE_ONLY_SOURCE_ID),
          articleId: String(TITLE_ONLY_ARTICLE_ID),
          articleVersionId: String(TITLE_ONLY_ARTICLE_VERSION_ID),
          projectionVersionId: String(projection.projection_id),
          policyId: projection.policy_id,
          acquiredContentSha256: projection.acquired_content_sha256,
          normalizedBodySha256: projection.normalized_body_sha256,
          titleSha256: projection.title_sha256,
          projectionPolicyVersion: projection.projection_policy_version,
          projectionSha256: projection.projection_sha256,
          normalizationVersion: projection.normalization_version,
          inputCodepointLength: projection.input_codepoint_length,
          titleCodepointLength: projection.title_codepoint_length,
          attributionSha256: projection.attribution_sha256,
          schemaSha256: sha256(JSON.stringify(EVENT_ANALYST_SCHEMA)),
          skillSha256: sha256(skillInstruction),
          acquiredAt: projection.acquired_at.toISOString(),
          processedAt: processedAt.toISOString(),
          metadata: {
            canonicalUrl: projection.canonical_url,
            publisherItemId: projection.source_item_id,
            publishedAt: projection.published_at.toISOString(),
            availableAt: projection.first_available_at.toISOString(),
            modifiedAt: projection.modified_at?.toISOString() ?? null,
            language: projection.language,
          },
        },
        projection: { title: acquired.item.title, language: acquired.item.locale },
        skillInstruction,
      };
    } finally {
      acquired.bytes.fill(0);
      acquired.item.body.fill(0);
    }
  }

  private async readSummary(
    projectionVersionId: string,
    item: ParsedGovUkContentItem,
    projectionSha256: string,
  ): Promise<PersonalOwnerTestArticleSummary> {
    const row = await this.database.database
      .selectFrom('official_api_hash_only_article_versions')
      .select(['title_sha256', 'published_at'])
      .where('id', '=', TITLE_ONLY_ARTICLE_VERSION_ID)
      .executeTakeFirstOrThrow();
    return {
      fixtureId: PERSONAL_OWNER_TEST_FIXTURE_ID,
      sourceId: String(TITLE_ONLY_SOURCE_ID),
      articleId: String(TITLE_ONLY_ARTICLE_ID),
      articleVersionId: String(TITLE_ONLY_ARTICLE_VERSION_ID),
      projectionVersionId,
      projectionSha256,
      titleSha256: row.title_sha256,
      title: item.title,
      publisher: 'Regulator of Social Housing',
      publishedAt: row.published_at.toISOString(),
      acquisitionMode: 'SYNTHETIC_LOOPBACK_FIXTURE',
    };
  }
}
