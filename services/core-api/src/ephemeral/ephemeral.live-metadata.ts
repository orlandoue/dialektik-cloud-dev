import {
  generateUlid,
  parseUlid,
  type Database,
  type SourceType,
  type Ulid,
} from '@dialektik/database';
import { sql, type Kysely } from 'kysely';

import type { CoreApiConfig } from '../config/core-api-config.js';
import {
  canonicalizeLiveUrl,
  liveHash,
  nearDuplicateSignature,
  parseLiveTimestamp,
} from '../live/live.adapter.js';
import { assertLiveDatabase } from '../live/live.sync.js';
import { assertUnicodeScalars } from './ephemeral.normalization';

export const OFFICIAL_API_METADATA_ADAPTER = 'product-official-api-metadata-v1';
export const PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY = 'product-live-shadow-exclusions-v1';

/** This boundary accepts the six selected metadata fields, never a full API response. */
export interface OfficialApiMetadataItem {
  readonly title: string;
  readonly url: string;
  readonly uuid: string;
  readonly date: string;
  readonly created: string;
  readonly changed: string;
}

export interface OfficialApiMetadataSourcePolicy {
  readonly sourceId: Ulid;
  readonly registryKey: typeof PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY;
  readonly publisherName: string;
  readonly canonicalDomain: string;
  readonly allowedArticleDomains: readonly string[];
  readonly endpoint: string;
  readonly rightsEvidenceUrl: string;
  readonly rightsVerifiedAt: string;
  readonly attribution: string;
  readonly language: string;
  readonly metadataStorageGranted: boolean;
  readonly externalSourceLinkGranted: boolean;
}

export interface OfficialApiMetadataArticle {
  readonly articleId: Ulid;
  readonly sourceId: Ulid;
  readonly canonicalUrl: string;
  readonly publisherItemId: string;
  readonly headline: string;
  readonly publishedAt: string;
  readonly modifiedAt: string;
  readonly publisherCreatedAt: string;
  readonly firstAvailableAt: string;
  readonly status: 'new' | 'updated' | 'unchanged';
}

const newId = (now: Date): Ulid => generateUlid({ now: () => now.getTime() });
const exclusionId = (identity: string): string =>
  liveHash(`${PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY}\n${identity}`);
const hashPattern = /^[0-9a-f]{64}$/u;

function assertRegistry(
  value: unknown,
  errorCode: 'OFFICIAL_METADATA_POLICY_DENIED' | 'OFFICIAL_INPUT_EXCLUSION_INVALID',
): void {
  if (value !== PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY) throw new Error(errorCode);
}
function assertMetadataGrant(value: unknown): void {
  if (value !== true) throw new Error('OFFICIAL_METADATA_POLICY_DENIED');
}

function strictKeys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('OFFICIAL_METADATA_FIELDS_INVALID');
}

function unixTimestamp(raw: string): Date {
  if (typeof raw !== 'string' || !/^\d{1,12}$/u.test(raw))
    throw new Error('OFFICIAL_METADATA_DATE_INVALID');
  const seconds = Number(raw);
  const value = new Date(seconds * 1000);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(value.getTime()))
    throw new Error('OFFICIAL_METADATA_DATE_INVALID');
  return value;
}

function apiTimeElement(raw: string): Date {
  if (typeof raw !== 'string') throw new Error('OFFICIAL_METADATA_DATE_INVALID');
  const match = /^<time datetime="([^"<>]{1,64})">(\d{1,12})<\/time>\s*$/u.exec(raw);
  if (!match) throw new Error('OFFICIAL_METADATA_DATE_INVALID');
  const declared = parseLiveTimestamp(match[1] ?? '');
  const seconds = unixTimestamp(match[2] ?? '');
  if (declared === null || declared.getTime() !== seconds.getTime())
    throw new Error('OFFICIAL_METADATA_DATE_INVALID');
  return seconds;
}

function validatePolicy(
  policy: OfficialApiMetadataSourcePolicy,
  config: Readonly<CoreApiConfig>,
  recordedAt: Date,
): void {
  assertLiveDatabase(config);
  assertRegistry(policy.registryKey, 'OFFICIAL_METADATA_POLICY_DENIED');
  assertMetadataGrant(policy.metadataStorageGranted);
  assertMetadataGrant(policy.externalSourceLinkGranted);
  if (
    typeof policy.publisherName !== 'string' ||
    policy.publisherName.trim().length === 0 ||
    policy.publisherName.length > 256 ||
    typeof policy.attribution !== 'string' ||
    policy.attribution.trim().length === 0 ||
    policy.attribution.length > 1024 ||
    !/^[A-Za-z][A-Za-z0-9-]{0,34}$/u.test(policy.language) ||
    !Array.isArray(policy.allowedArticleDomains) ||
    policy.allowedArticleDomains.length === 0
  ) {
    throw new Error('OFFICIAL_METADATA_POLICY_DENIED');
  }
  const verified = parseLiveTimestamp(policy.rightsVerifiedAt);
  if (verified === null || verified > recordedAt)
    throw new Error('OFFICIAL_METADATA_POLICY_DENIED');
  for (const url of [policy.endpoint, policy.rightsEvidenceUrl]) {
    const value = new URL(url);
    if (value.protocol !== 'https:' || value.username || value.password || url.length > 2048)
      throw new Error('OFFICIAL_METADATA_POLICY_DENIED');
  }
  const endpoint = new URL(policy.endpoint);
  const fields = endpoint.searchParams.get('fields')?.split(',').sort();
  if (
    !fields ||
    fields.join(',') !== 'changed,created,date,title,url,uuid' ||
    !policy.allowedArticleDomains.includes(endpoint.hostname) ||
    !policy.allowedArticleDomains.includes(policy.canonicalDomain)
  )
    throw new Error('OFFICIAL_METADATA_POLICY_DENIED');
  if (
    policy.canonicalDomain.endsWith('.invalid') &&
    !new URL(config.databaseUrl).pathname.startsWith('/dialektik_test_')
  ) {
    throw new Error('OFFICIAL_METADATA_AUTHORED_TARGET_DENIED');
  }
}

function parseItem(item: OfficialApiMetadataItem, policy: OfficialApiMetadataSourcePolicy) {
  strictKeys(item, ['title', 'url', 'uuid', 'date', 'created', 'changed']);
  if (
    typeof item.title !== 'string' ||
    item.title.trim().length === 0 ||
    Array.from(item.title).length > 1024 ||
    item.title.includes('\u0000') ||
    typeof item.uuid !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(item.uuid)
  ) {
    throw new Error('OFFICIAL_METADATA_FIELDS_INVALID');
  }
  const canonicalUrl = canonicalizeLiveUrl(item.url);
  const url = new URL(canonicalUrl);
  if (
    url.protocol !== 'https:' ||
    !policy.allowedArticleDomains.includes(url.hostname) ||
    canonicalUrl.length > 2048
  ) {
    throw new Error('OFFICIAL_METADATA_URL_INVALID');
  }
  const publishedAt = unixTimestamp(item.date);
  const publisherCreatedAt = apiTimeElement(item.created);
  const modifiedAt = apiTimeElement(item.changed);
  if (modifiedAt < publisherCreatedAt) throw new Error('OFFICIAL_METADATA_DATE_INVALID');
  // Do not trim, NFC-normalize, rewrite whitespace or decode the original title.
  const contentHash = liveHash(item.title);
  const signature = nearDuplicateSignature(item.title);
  const metadataHash = liveHash(
    JSON.stringify({
      title: item.title,
      url: canonicalUrl,
      uuid: item.uuid,
      date: item.date,
      created: item.created,
      changed: item.changed,
    }),
  );
  return {
    item,
    canonicalUrl,
    publishedAt,
    publisherCreatedAt,
    modifiedAt,
    contentHash,
    signature,
    metadataHash,
  };
}

async function excludeMetadata(
  database: Kysely<Database>,
  policy: OfficialApiMetadataSourcePolicy,
  value: ReturnType<typeof parseItem>,
  discoveredAt: Date,
): Promise<string> {
  const identity = exclusionId(value.canonicalUrl);
  await database
    .insertInto('live_exposure_exclusions')
    .values(
      [
        { id: identity, content_hash: null, near_duplicate_signature: null },
        {
          id: exclusionId(`${value.canonicalUrl}\n${value.contentHash}`),
          content_hash: value.contentHash,
          near_duplicate_signature: value.signature,
        },
        {
          id: exclusionId(`source-item:${value.item.uuid}`),
          content_hash: value.contentHash,
          near_duplicate_signature: value.signature,
        },
      ].map((row) => ({
        ...row,
        registry_key: PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY,
        publisher_name: policy.publisherName,
        canonical_url:
          row.id === exclusionId(`source-item:${value.item.uuid}`) ? null : value.canonicalUrl,
        source_item_id: value.item.uuid,
        published_at: value.publishedAt,
        first_seen_at: discoveredAt,
        discovery_url: policy.endpoint,
        reason: 'official_api_metadata_discovery',
      })),
    )
    .onConflict((conflict) => conflict.column('id').doNothing())
    .execute();
  return identity;
}

/** Caller authenticates current rights and freezes the metadata selection. This function does no networking. */
export async function importOfficialApiMetadata(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  policy: OfficialApiMetadataSourcePolicy,
  items: readonly OfficialApiMetadataItem[],
  options: { readonly discoveredAt: Date; readonly recordedAt?: Date },
): Promise<{
  readonly sourceId: Ulid;
  readonly policyId: string;
  readonly articles: readonly OfficialApiMetadataArticle[];
}> {
  const recordedAt = options.recordedAt ?? new Date();
  if (
    !Number.isFinite(recordedAt.getTime()) ||
    !Number.isFinite(options.discoveredAt.getTime()) ||
    options.discoveredAt > recordedAt ||
    items.length < 1 ||
    items.length > 40
  )
    throw new Error('OFFICIAL_METADATA_BATCH_INVALID');
  validatePolicy(policy, config, recordedAt);
  const parsed = items.map((item) => parseItem(item, policy));
  if (
    new Set(parsed.map((item) => item.canonicalUrl)).size !== parsed.length ||
    new Set(parsed.map((item) => item.item.uuid)).size !== parsed.length
  )
    throw new Error('OFFICIAL_METADATA_DUPLICATE_IDENTITY');
  // Every valid discovered identity is permanently excluded before Source/Article writes.
  const exclusions: string[] = [];
  for (const value of parsed)
    exclusions.push(await excludeMetadata(database, policy, value, options.discoveredAt));
  const policyJson = {
    sourceId: policy.sourceId,
    registryKey: policy.registryKey,
    publisherName: policy.publisherName,
    canonicalDomain: policy.canonicalDomain,
    sourceType: 'other',
    publisherFamily: policy.publisherName,
    category: null,
    discoveryChannel: 'official_api',
    endpoint: policy.endpoint,
    rightsClass: 'LIVE_READY',
    storagePolicy: 'METADATA_ONLY',
    active: true,
    rightsEvidenceUrl: policy.rightsEvidenceUrl,
    rightsVerifiedAt: policy.rightsVerifiedAt,
    attribution: policy.attribution,
    language: policy.language,
    allowedArticleDomains: [...policy.allowedArticleDomains].sort(),
    metadataStorageGranted: true,
    externalSourceLinkGranted: true,
    fulltextAcquisition: false,
    fulltextMachineProcessing: false,
    fulltextPersistence: false,
  };
  const policyId = liveHash(JSON.stringify(policyJson));
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto('sources')
      .values({
        id: policy.sourceId,
        name: policy.publisherName,
        source_type: 'other',
        canonical_domain: policy.canonicalDomain,
        is_issuing_entity: false,
        origin: 'LIVE_REAL',
        created_at: recordedAt,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
    const existing = await transaction
      .selectFrom('sources')
      .selectAll()
      .where('id', '=', policy.sourceId)
      .executeTakeFirstOrThrow();
    if (
      existing.origin !== 'LIVE_REAL' ||
      existing.canonical_domain !== policy.canonicalDomain ||
      existing.name !== policy.publisherName ||
      existing.source_type !== 'other' ||
      existing.is_issuing_entity
    )
      throw new Error('OFFICIAL_METADATA_SOURCE_CONFLICT');
    await transaction
      .insertInto('live_source_policies')
      .values({
        id: policyId,
        source_id: policy.sourceId,
        registry_key: policy.registryKey,
        rights_class: 'LIVE_READY',
        storage_policy: 'METADATA_ONLY',
        active: true,
        rights_evidence_url: policy.rightsEvidenceUrl,
        rights_verified_at: policy.rightsVerifiedAt,
        policy: policyJson,
        recorded_at: recordedAt,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
  });
  const articles: OfficialApiMetadataArticle[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const value = parsed[index];
    const permanentExclusion = exclusions[index];
    if (!value || !permanentExclusion) throw new Error('OFFICIAL_METADATA_BATCH_INVALID');
    const article = await database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`official-api-source:${policy.sourceId}`},0))`.execute(
        transaction,
      );
      const byUrl = await transaction
        .selectFrom('articles')
        .selectAll()
        .where('url_canonical', '=', value.canonicalUrl)
        .executeTakeFirst();
      const byItem = await transaction
        .selectFrom('articles as a')
        .innerJoin('live_acquisition_receipts as r', 'r.exclusion_id', 'a.live_exposure_id')
        .selectAll('a')
        .where('r.source_id', '=', policy.sourceId)
        .where('r.source_item_id', '=', value.item.uuid)
        .executeTakeFirst();
      const existing = byUrl ?? byItem;
      if (
        (byUrl && byItem && byUrl.id !== byItem.id) ||
        (existing &&
          (existing.origin !== 'LIVE_REAL' ||
            existing.source_id !== policy.sourceId ||
            existing.url_canonical !== value.canonicalUrl))
      )
        throw new Error('OFFICIAL_METADATA_ARTICLE_IDENTITY_CONFLICT');
      if (byUrl) {
        const foreignGuid = await transaction
          .selectFrom('live_acquisition_receipts')
          .select('source_item_id')
          .where('exclusion_id', '=', byUrl.live_exposure_id)
          .where('source_item_id', 'is not', null)
          .execute();
        if (foreignGuid.some((row) => row.source_item_id !== value.item.uuid))
          throw new Error('OFFICIAL_METADATA_ARTICLE_IDENTITY_CONFLICT');
      }
      const articleId = existing?.id ?? newId(recordedAt);
      const linkedExclusion = existing?.live_exposure_id ?? permanentExclusion;
      const receiptId = newId(recordedAt);
      await transaction
        .insertInto('live_acquisition_receipts')
        .values({
          id: receiptId,
          source_id: policy.sourceId,
          policy_id: policyId,
          exclusion_id: linkedExclusion,
          discovery_channel: 'official_api',
          discovery_url: policy.endpoint,
          discovered_url: value.item.url,
          canonical_url: value.canonicalUrl,
          source_item_id: value.item.uuid,
          published_at: value.publishedAt,
          modified_at: value.modifiedAt,
          original_published_at: value.item.date,
          original_modified_at: value.item.changed,
          seen_at: options.discoveredAt,
          raw_payload_hash: value.metadataHash,
          adapter_version: OFFICIAL_API_METADATA_ADAPTER,
          disposition: 'PERSISTED',
          error_code: null,
        })
        .execute();
      if (!existing) {
        await transaction
          .insertInto('articles')
          .values({
            id: articleId,
            source_id: policy.sourceId,
            event_id: null,
            url_canonical: value.canonicalUrl,
            text_original: value.item.title,
            text_normalized: value.item.title,
            lang: policy.language,
            published_at: value.publishedAt,
            captured_at: options.discoveredAt,
            updated_at_source: value.modifiedAt,
            declares_wire: null,
            syndication_of: null,
            syndication_confidence: null,
            clustering_score: null,
            processing_error: null,
            origin: 'LIVE_REAL',
            live_exposure_id: linkedExclusion,
          })
          .execute();
      }
      const latest = await transaction
        .selectFrom('live_article_versions')
        .selectAll()
        .where('article_id', '=', articleId)
        .orderBy('version_number', 'desc')
        .executeTakeFirst();
      let status: OfficialApiMetadataArticle['status'] = 'unchanged';
      if (!latest || latest.metadata_hash !== value.metadataHash) {
        await transaction
          .insertInto('live_article_versions')
          .values({
            id: newId(recordedAt),
            article_id: articleId,
            receipt_id: receiptId,
            version_number: (latest?.version_number ?? 0) + 1,
            metadata_hash: value.metadataHash,
            headline: value.item.title,
            excerpt: null,
            author: null,
            published_at: value.publishedAt,
            modified_at: value.modifiedAt,
            declared_upstream: null,
            content_hash: value.contentHash,
            near_duplicate_signature: value.signature,
            recorded_at: recordedAt,
          })
          .execute();
        status = existing ? 'updated' : 'new';
      }
      return {
        articleId,
        sourceId: policy.sourceId,
        canonicalUrl: value.canonicalUrl,
        publisherItemId: value.item.uuid,
        headline: value.item.title,
        publishedAt: value.publishedAt.toISOString(),
        modifiedAt: value.modifiedAt.toISOString(),
        publisherCreatedAt: value.publisherCreatedAt.toISOString(),
        firstAvailableAt: (existing?.captured_at ?? options.discoveredAt).toISOString(),
        status,
      };
    });
    articles.push(article);
  }
  return { sourceId: policy.sourceId, policyId, articles };
}

/** Hashes only. Invoke after authorized memory normalization and before observed-version/provider use. */
export async function appendOfficialApiNormalizedInputExclusion(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  input: {
    readonly articleId: Ulid;
    readonly normalizedInputHash: string;
    readonly observedAt: Date;
    readonly registryKey: typeof PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY;
  },
): Promise<string> {
  assertLiveDatabase(config);
  strictKeys(input, ['articleId', 'normalizedInputHash', 'observedAt', 'registryKey']);
  assertRegistry(input.registryKey, 'OFFICIAL_INPUT_EXCLUSION_INVALID');
  if (!hashPattern.test(input.normalizedInputHash) || !Number.isFinite(input.observedAt.getTime()))
    throw new Error('OFFICIAL_INPUT_EXCLUSION_INVALID');
  const article = await database
    .selectFrom('articles as a')
    .innerJoin('sources as s', 's.id', 'a.source_id')
    .innerJoin('live_exposure_exclusions as e', 'e.id', 'a.live_exposure_id')
    .select([
      'a.id',
      'a.origin',
      'a.event_id',
      'a.url_canonical',
      'a.source_id',
      'a.published_at',
      's.name',
      'e.registry_key',
    ])
    .where('a.id', '=', input.articleId)
    .executeTakeFirstOrThrow();
  const acquisition = await database
    .selectFrom('live_acquisition_receipts')
    .select(['source_item_id', 'discovery_url'])
    .where('source_id', '=', article.source_id)
    .where('canonical_url', '=', article.url_canonical)
    .where('discovery_channel', '=', 'official_api')
    .where('disposition', '=', 'PERSISTED')
    .orderBy('seen_at', 'desc')
    .executeTakeFirst();
  const rights = await database
    .selectFrom('content_access_policies')
    .selectAll()
    .where('source_id', '=', article.source_id)
    .where('recorded_at', '<=', input.observedAt)
    .orderBy('recorded_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (
    article.origin !== 'LIVE_REAL' ||
    article.event_id !== null ||
    article.registry_key !== input.registryKey ||
    !acquisition
  ) {
    throw new Error('OFFICIAL_INPUT_EXCLUSION_IDENTITY_INVALID');
  }
  if (
    !rights ||
    rights.content_access_mode === 'METADATA_ONLY' ||
    !rights.metadata_storage ||
    !rights.fulltext_acquisition ||
    !rights.fulltext_machine_processing ||
    !rights.derived_semantic_persistence
  )
    throw new Error('OFFICIAL_INPUT_EXCLUSION_RIGHTS_DENIED');
  const id = exclusionId(`${article.url_canonical}\nnormalized:${input.normalizedInputHash}`);
  await database
    .insertInto('live_exposure_exclusions')
    .values({
      id,
      registry_key: input.registryKey,
      publisher_name: article.name,
      canonical_url: article.url_canonical,
      source_item_id: acquisition.source_item_id,
      published_at: article.published_at,
      first_seen_at: input.observedAt,
      discovery_url: acquisition.discovery_url,
      reason: 'authorized_ephemeral_normalized_input_before_provider',
      content_hash: input.normalizedInputHash,
      near_duplicate_signature: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .execute();
  return id;
}

export const GENERIC_OFFICIAL_METADATA_ADAPTER = 'product-generic-official-metadata-v1';
/** Caller maps an authenticated publisher schema; no dates or identities are manufactured. */
export interface GenericOfficialMetadataItem {
  readonly publisherItemId: string | null;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly modifiedAt: string | null;
  readonly originalPublishedAt: string;
  readonly originalModifiedAt: string | null;
  readonly firstObservedAt: string;
  /** Acquisition of metadata, independently of later acquisition of complete content. */
  readonly acquiredAt: string;
  readonly availableAt: string;
  readonly declaredUpstream: string | null;
}
export interface GenericOfficialMetadataSourcePolicy {
  readonly sourceId: Ulid;
  readonly registryKey: typeof PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY;
  readonly publisherName: string;
  readonly canonicalDomain: string;
  readonly allowedArticleDomains: readonly string[];
  readonly sourceType: SourceType;
  readonly publisherFamily: string | null;
  readonly declaredUpstream: string | null;
  readonly discoveryChannel: 'official_api' | 'rss_atom';
  readonly endpoint: string;
  readonly rightsEvidenceUrl: string;
  readonly rightsVerifiedAt: string;
  readonly attribution: string;
  readonly language: string;
  readonly metadataStorageGranted: boolean;
  readonly externalSourceLinkGranted: boolean;
}
export interface GenericOfficialMetadataArticle {
  readonly articleId: Ulid;
  readonly sourceId: Ulid;
  readonly canonicalUrl: string;
  readonly publisherItemId: string | null;
  readonly headline: string;
  readonly publishedAt: string;
  readonly modifiedAt: string | null;
  readonly firstObservedAt: string;
  readonly acquiredAt: string;
  readonly firstAvailableAt: string;
  readonly status: 'new' | 'updated' | 'unchanged';
}
const genericItemKeys = [
  'publisherItemId',
  'canonicalUrl',
  'title',
  'publishedAt',
  'modifiedAt',
  'originalPublishedAt',
  'originalModifiedAt',
  'firstObservedAt',
  'acquiredAt',
  'availableAt',
  'declaredUpstream',
] as const;
function genericString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Array.from(value).length <= maximum &&
    !value.includes('\u0000')
  );
}
function genericNullableString(value: unknown, maximum: number): value is string | null {
  return value === null || genericString(value, maximum);
}
function genericTimestamp(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  )
    throw new Error('GENERIC_METADATA_DATE_INVALID');
  const date = parseLiveTimestamp(value);
  if (!date) throw new Error('GENERIC_METADATA_DATE_INVALID');
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8, 10));
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    throw new Error('GENERIC_METADATA_DATE_INVALID');
  return date;
}
function genericPublicUrl(value: unknown): string | null {
  if (!genericString(value, 2048)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? canonicalizeLiveUrl(value)
      : null;
  } catch {
    return null;
  }
}
function validateGenericPolicy(
  policy: GenericOfficialMetadataSourcePolicy,
  config: Readonly<CoreApiConfig>,
  recordedAt: Date,
): void {
  assertLiveDatabase(config);
  strictKeys(policy, [
    'sourceId',
    'registryKey',
    'publisherName',
    'canonicalDomain',
    'allowedArticleDomains',
    'sourceType',
    'publisherFamily',
    'declaredUpstream',
    'discoveryChannel',
    'endpoint',
    'rightsEvidenceUrl',
    'rightsVerifiedAt',
    'attribution',
    'language',
    'metadataStorageGranted',
    'externalSourceLinkGranted',
  ]);
  parseUlid(policy.sourceId);
  assertRegistry(policy.registryKey, 'OFFICIAL_METADATA_POLICY_DENIED');
  const domains: readonly unknown[] = Array.isArray(policy.allowedArticleDomains)
    ? (policy.allowedArticleDomains as readonly unknown[])
    : [];
  if (
    !genericString(policy.publisherName, 256) ||
    !genericString(policy.attribution, 1024) ||
    !genericNullableString(policy.publisherFamily, 256) ||
    !genericNullableString(policy.declaredUpstream, 256) ||
    ![
      'official_statistics',
      'wire_agency',
      'daily_newspaper',
      'digital_native',
      'radio',
      'tv',
      'other',
    ].includes(policy.sourceType) ||
    !['official_api', 'rss_atom'].includes(policy.discoveryChannel) ||
    !/^[A-Za-z][A-Za-z0-9-]{0,34}$/u.test(policy.language) ||
    domains.length < 1 ||
    domains.length > 16 ||
    !domains.includes(policy.canonicalDomain) ||
    domains.some(
      (domain) => typeof domain !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(domain),
    ) ||
    !genericPublicUrl(policy.endpoint) ||
    !genericPublicUrl(policy.rightsEvidenceUrl) ||
    !domains.includes(new URL(policy.endpoint).hostname) ||
    typeof policy.metadataStorageGranted !== 'boolean' ||
    typeof policy.externalSourceLinkGranted !== 'boolean' ||
    genericTimestamp(policy.rightsVerifiedAt) > recordedAt ||
    (domains.some((domain) => typeof domain === 'string' && domain.endsWith('.invalid')) &&
      !new URL(config.databaseUrl).pathname.startsWith('/dialektik_test_'))
  )
    throw new Error('GENERIC_METADATA_POLICY_DENIED');
}
/** Identities only, including rejected items; never accepts or retains body/excerpt fields. */
export async function excludeGenericOfficialMetadataIdentities(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  policy: GenericOfficialMetadataSourcePolicy,
  items: readonly unknown[],
  options: { readonly observedAt: Date; readonly recordedAt?: Date },
): Promise<void> {
  const recordedAt = options.recordedAt ?? new Date();
  if (
    !Number.isFinite(options.observedAt.getTime()) ||
    !Number.isFinite(recordedAt.getTime()) ||
    options.observedAt > recordedAt ||
    items.length < 1 ||
    items.length > 40
  )
    throw new Error('GENERIC_METADATA_BATCH_INVALID');
  validateGenericPolicy(policy, config, recordedAt);
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const canonicalUrl = genericPublicUrl(row.canonicalUrl);
    const publisherItemId = genericNullableString(row.publisherItemId, 512)
      ? row.publisherItemId
      : null;
    if (!canonicalUrl && !publisherItemId) continue;
    let firstSeenAt = options.observedAt;
    try {
      const observed = genericTimestamp(row.firstObservedAt);
      if (observed <= options.observedAt) firstSeenAt = observed;
    } catch {
      /* A malformed date cannot prevent safe identity exclusion. */
    }
    const identities = [
      ...(canonicalUrl ? [{ identity: canonicalUrl, canonicalUrl }] : []),
      ...(publisherItemId
        ? [{ identity: `source-item:${policy.sourceId}:${publisherItemId}`, canonicalUrl: null }]
        : []),
    ];
    await database
      .insertInto('live_exposure_exclusions')
      .values(
        identities.map((identity) => ({
          id: exclusionId(identity.identity),
          registry_key: policy.registryKey,
          publisher_name: policy.publisherName,
          canonical_url: identity.canonicalUrl,
          source_item_id: publisherItemId,
          published_at: null,
          first_seen_at: firstSeenAt,
          discovery_url: policy.endpoint,
          reason: 'generic_official_metadata_identity_discovery',
          content_hash: null,
          near_duplicate_signature: null,
        })),
      )
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
  }
}
function parseGenericItem(
  item: GenericOfficialMetadataItem,
  policy: GenericOfficialMetadataSourcePolicy,
  recordedAt: Date,
) {
  if (
    !(item as unknown) ||
    typeof item !== 'object' ||
    Array.isArray(item) ||
    Object.keys(item).sort().join(',') !== [...genericItemKeys].sort().join(',')
  )
    throw new Error('GENERIC_METADATA_FIELDS_INVALID');
  if (
    !genericString(item.title, 1024) ||
    !genericNullableString(item.publisherItemId, 512) ||
    !genericNullableString(item.declaredUpstream, 256) ||
    !genericString(item.originalPublishedAt, 256) ||
    !genericNullableString(item.originalModifiedAt, 256)
  )
    throw new Error('GENERIC_METADATA_FIELDS_INVALID');
  assertUnicodeScalars(item.title);
  const canonicalUrl = genericPublicUrl(item.canonicalUrl);
  if (!canonicalUrl || !policy.allowedArticleDomains.includes(new URL(canonicalUrl).hostname))
    throw new Error('GENERIC_METADATA_URL_INVALID');
  const publishedAt = genericTimestamp(item.publishedAt),
    modifiedAt = item.modifiedAt === null ? null : genericTimestamp(item.modifiedAt),
    firstObservedAt = genericTimestamp(item.firstObservedAt),
    acquiredAt = genericTimestamp(item.acquiredAt),
    availableAt = genericTimestamp(item.availableAt);
  if (
    firstObservedAt > acquiredAt ||
    acquiredAt > recordedAt ||
    availableAt.getTime() !== firstObservedAt.getTime() ||
    (modifiedAt !== null && modifiedAt < publishedAt) ||
    (modifiedAt === null) !== (item.originalModifiedAt === null)
  )
    throw new Error('GENERIC_METADATA_DATE_INVALID');
  const contentHash = liveHash(item.title),
    signature = nearDuplicateSignature(item.title);
  const metadataHash = liveHash(
    JSON.stringify({
      publisherItemId: item.publisherItemId,
      canonicalUrl,
      title: item.title,
      publishedAt: item.publishedAt,
      modifiedAt: item.modifiedAt,
      originalPublishedAt: item.originalPublishedAt,
      originalModifiedAt: item.originalModifiedAt,
      declaredUpstream: item.declaredUpstream,
    }),
  );
  return {
    item,
    canonicalUrl,
    publishedAt,
    modifiedAt,
    firstObservedAt,
    acquiredAt,
    availableAt,
    contentHash,
    signature,
    metadataHash,
  };
}
/** Metadata imports are <=40 per call; they never activate or split a semantic batch. */
export async function importGenericOfficialMetadata(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  policy: GenericOfficialMetadataSourcePolicy,
  items: readonly GenericOfficialMetadataItem[],
  options: { readonly recordedAt?: Date } = {},
): Promise<{
  readonly sourceId: Ulid;
  readonly policyId: string;
  readonly articles: readonly GenericOfficialMetadataArticle[];
}> {
  const recordedAt = options.recordedAt ?? new Date();
  if (!Number.isFinite(recordedAt.getTime()) || items.length < 1 || items.length > 40)
    throw new Error('GENERIC_METADATA_BATCH_INVALID');
  // Before parsing, rights-denied or malformed metadata still excludes any safe exposed identity.
  await excludeGenericOfficialMetadataIdentities(database, config, policy, items, {
    observedAt: recordedAt,
    recordedAt,
  });
  if (!policy.metadataStorageGranted || !policy.externalSourceLinkGranted)
    throw new Error('GENERIC_METADATA_POLICY_DENIED');
  const parsed = items.map((item) => parseGenericItem(item, policy, recordedAt));
  const ids = parsed.map((value) => value.item.publisherItemId).filter((value) => value !== null);
  if (
    new Set(parsed.map((value) => value.canonicalUrl)).size !== parsed.length ||
    new Set(ids).size !== ids.length
  )
    throw new Error('GENERIC_METADATA_DUPLICATE_IDENTITY');
  for (const value of parsed)
    await database
      .insertInto('live_exposure_exclusions')
      .values({
        id: exclusionId(`${value.canonicalUrl}\n${value.contentHash}`),
        registry_key: policy.registryKey,
        publisher_name: policy.publisherName,
        canonical_url: value.canonicalUrl,
        source_item_id: value.item.publisherItemId,
        published_at: value.publishedAt,
        first_seen_at: value.firstObservedAt,
        discovery_url: policy.endpoint,
        reason: 'generic_official_metadata_hash_discovery',
        content_hash: value.contentHash,
        near_duplicate_signature: value.signature,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
  const policyId = await registerGenericOfficialMetadataSource(database, config, policy, {
    recordedAt,
  });
  const articles: GenericOfficialMetadataArticle[] = [];
  for (const value of parsed)
    articles.push(
      await database.transaction().execute(async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`official-api-source:${policy.sourceId}`},0))`.execute(
          transaction,
        );
        const byUrl = await transaction
          .selectFrom('articles')
          .selectAll()
          .where('url_canonical', '=', value.canonicalUrl)
          .executeTakeFirst();
        const byItem =
          value.item.publisherItemId === null
            ? undefined
            : await transaction
                .selectFrom('articles as a')
                .innerJoin('live_acquisition_receipts as r', 'r.exclusion_id', 'a.live_exposure_id')
                .selectAll('a')
                .where('r.source_id', '=', policy.sourceId)
                .where('r.source_item_id', '=', value.item.publisherItemId)
                .executeTakeFirst();
        const existing = byUrl ?? byItem;
        if (
          (byUrl && byItem && byUrl.id !== byItem.id) ||
          (existing &&
            (existing.origin !== 'LIVE_REAL' ||
              existing.source_id !== policy.sourceId ||
              existing.url_canonical !== value.canonicalUrl))
        )
          throw new Error('GENERIC_METADATA_ARTICLE_IDENTITY_CONFLICT');
        if (byUrl && value.item.publisherItemId !== null) {
          const priorIds = await transaction
            .selectFrom('live_acquisition_receipts')
            .select('source_item_id')
            .where('source_id', '=', policy.sourceId)
            .where('exclusion_id', '=', byUrl.live_exposure_id)
            .where('source_item_id', 'is not', null)
            .execute();
          if (priorIds.some((row) => row.source_item_id !== value.item.publisherItemId))
            throw new Error('GENERIC_METADATA_ARTICLE_IDENTITY_CONFLICT');
        }
        const articleId = existing?.id ?? newId(recordedAt),
          linkedExclusion = existing?.live_exposure_id ?? exclusionId(value.canonicalUrl),
          receiptId = newId(recordedAt);
        await transaction
          .insertInto('live_acquisition_receipts')
          .values({
            id: receiptId,
            source_id: policy.sourceId,
            policy_id: policyId,
            exclusion_id: linkedExclusion,
            discovery_channel: policy.discoveryChannel,
            discovery_url: policy.endpoint,
            discovered_url: value.item.canonicalUrl,
            canonical_url: value.canonicalUrl,
            source_item_id: value.item.publisherItemId,
            published_at: value.publishedAt,
            modified_at: value.modifiedAt,
            original_published_at: value.item.originalPublishedAt,
            original_modified_at: value.item.originalModifiedAt,
            seen_at: value.acquiredAt,
            raw_payload_hash: value.metadataHash,
            adapter_version: GENERIC_OFFICIAL_METADATA_ADAPTER,
            disposition: 'PERSISTED',
            error_code: null,
          })
          .execute();
        if (!existing)
          await transaction
            .insertInto('articles')
            .values({
              id: articleId,
              source_id: policy.sourceId,
              event_id: null,
              url_canonical: value.canonicalUrl,
              text_original: value.item.title,
              text_normalized: value.item.title,
              lang: policy.language,
              published_at: value.publishedAt,
              captured_at: value.availableAt,
              updated_at_source: value.modifiedAt,
              declares_wire: value.item.declaredUpstream,
              syndication_of: null,
              syndication_confidence: null,
              clustering_score: null,
              processing_error: null,
              origin: 'LIVE_REAL',
              live_exposure_id: linkedExclusion,
            })
            .execute();
        const latest = await transaction
          .selectFrom('live_article_versions')
          .selectAll()
          .where('article_id', '=', articleId)
          .orderBy('version_number', 'desc')
          .executeTakeFirst();
        let status: GenericOfficialMetadataArticle['status'] = 'unchanged';
        if (!latest || latest.metadata_hash !== value.metadataHash) {
          await transaction
            .insertInto('live_article_versions')
            .values({
              id: newId(recordedAt),
              article_id: articleId,
              receipt_id: receiptId,
              version_number: (latest?.version_number ?? 0) + 1,
              metadata_hash: value.metadataHash,
              headline: value.item.title,
              excerpt: null,
              author: null,
              published_at: value.publishedAt,
              modified_at: value.modifiedAt,
              declared_upstream: value.item.declaredUpstream,
              content_hash: value.contentHash,
              near_duplicate_signature: value.signature,
              recorded_at: recordedAt,
            })
            .execute();
          status = existing ? 'updated' : 'new';
        }
        return {
          articleId,
          sourceId: policy.sourceId,
          canonicalUrl: value.canonicalUrl,
          publisherItemId: value.item.publisherItemId,
          headline: value.item.title,
          publishedAt: value.publishedAt.toISOString(),
          modifiedAt: value.modifiedAt?.toISOString() ?? null,
          firstObservedAt: value.firstObservedAt.toISOString(),
          acquiredAt: value.acquiredAt.toISOString(),
          firstAvailableAt: (existing?.captured_at ?? value.availableAt).toISOString(),
          status,
        };
      }),
    );
  return { sourceId: policy.sourceId, policyId, articles };
}

/** Register only independently qualified metadata rights before any collector lease. */
export async function registerGenericOfficialMetadataSource(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  policy: GenericOfficialMetadataSourcePolicy,
  options: { readonly recordedAt?: Date } = {},
): Promise<string> {
  const recordedAt = options.recordedAt ?? new Date();
  if (!Number.isFinite(recordedAt.getTime())) throw new Error('GENERIC_METADATA_DATE_INVALID');
  validateGenericPolicy(policy, config, recordedAt);
  if (!policy.metadataStorageGranted || !policy.externalSourceLinkGranted)
    throw new Error('GENERIC_METADATA_POLICY_DENIED');
  const policyJson = {
    sourceId: policy.sourceId,
    registryKey: policy.registryKey,
    publisherName: policy.publisherName,
    canonicalDomain: policy.canonicalDomain,
    sourceType: policy.sourceType,
    publisherFamily: policy.publisherFamily,
    declaredUpstream: policy.declaredUpstream,
    category: null,
    discoveryChannel: policy.discoveryChannel,
    endpoint: policy.endpoint,
    rightsClass: 'LIVE_READY',
    storagePolicy: 'METADATA_ONLY',
    active: true,
    rightsEvidenceUrl: policy.rightsEvidenceUrl,
    rightsVerifiedAt: policy.rightsVerifiedAt,
    attribution: policy.attribution,
    language: policy.language,
    allowedArticleDomains: [...policy.allowedArticleDomains].sort(),
    metadataStorageGranted: true,
    externalSourceLinkGranted: true,
    fulltextAcquisition: false,
    fulltextMachineProcessing: false,
    fulltextPersistence: false,
  };
  const policyId = liveHash(JSON.stringify(policyJson));
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto('sources')
      .values({
        id: policy.sourceId,
        name: policy.publisherName,
        source_type: policy.sourceType,
        canonical_domain: policy.canonicalDomain,
        is_issuing_entity: false,
        origin: 'LIVE_REAL',
        created_at: recordedAt,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
    const existing = await transaction
      .selectFrom('sources')
      .selectAll()
      .where('id', '=', policy.sourceId)
      .executeTakeFirstOrThrow();
    if (
      existing.origin !== 'LIVE_REAL' ||
      existing.canonical_domain !== policy.canonicalDomain ||
      existing.name !== policy.publisherName ||
      existing.source_type !== policy.sourceType ||
      existing.is_issuing_entity
    )
      throw new Error('GENERIC_METADATA_SOURCE_CONFLICT');
    await transaction
      .insertInto('live_source_policies')
      .values({
        id: policyId,
        source_id: policy.sourceId,
        registry_key: policy.registryKey,
        rights_class: 'LIVE_READY',
        storage_policy: 'METADATA_ONLY',
        active: true,
        rights_evidence_url: policy.rightsEvidenceUrl,
        rights_verified_at: policy.rightsVerifiedAt,
        policy: policyJson,
        recorded_at: recordedAt,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
  });
  return policyId;
}

/** Generic input exclusion uses only immutable Article/receipt identity and a hash. */
export async function appendGenericOfficialNormalizedInputExclusion(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  input: {
    readonly articleId: Ulid;
    readonly normalizedInputHash: string;
    readonly observedAt: Date;
    readonly registryKey: typeof PRODUCT_EPHEMERAL_EXCLUSION_REGISTRY;
  },
): Promise<string> {
  assertLiveDatabase(config);
  strictKeys(input, ['articleId', 'normalizedInputHash', 'observedAt', 'registryKey']);
  assertRegistry(input.registryKey, 'OFFICIAL_INPUT_EXCLUSION_INVALID');
  if (!hashPattern.test(input.normalizedInputHash) || !Number.isFinite(input.observedAt.getTime()))
    throw new Error('OFFICIAL_INPUT_EXCLUSION_INVALID');
  const article = await database
    .selectFrom('articles as a')
    .innerJoin('sources as s', 's.id', 'a.source_id')
    .innerJoin('live_exposure_exclusions as e', 'e.id', 'a.live_exposure_id')
    .select([
      'a.id',
      'a.origin',
      'a.event_id',
      'a.url_canonical',
      'a.source_id',
      'a.published_at',
      's.name',
      'e.registry_key',
    ])
    .where('a.id', '=', input.articleId)
    .executeTakeFirstOrThrow();
  const acquisition = await database
    .selectFrom('live_acquisition_receipts')
    .select(['source_item_id', 'discovery_url'])
    .where('source_id', '=', article.source_id)
    .where('canonical_url', '=', article.url_canonical)
    .where('adapter_version', '=', GENERIC_OFFICIAL_METADATA_ADAPTER)
    .where('disposition', '=', 'PERSISTED')
    .orderBy('seen_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const rights = await database
    .selectFrom('content_access_policies')
    .selectAll()
    .where('source_id', '=', article.source_id)
    .where('recorded_at', '<=', input.observedAt)
    .orderBy('recorded_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (
    article.origin !== 'LIVE_REAL' ||
    article.event_id !== null ||
    article.registry_key !== input.registryKey ||
    !acquisition
  )
    throw new Error('OFFICIAL_INPUT_EXCLUSION_IDENTITY_INVALID');
  if (
    !rights ||
    rights.content_access_mode === 'METADATA_ONLY' ||
    !rights.metadata_storage ||
    !rights.fulltext_acquisition ||
    !rights.fulltext_machine_processing ||
    !rights.derived_semantic_persistence
  )
    throw new Error('OFFICIAL_INPUT_EXCLUSION_RIGHTS_DENIED');
  const id = exclusionId(`${article.url_canonical}\nnormalized:${input.normalizedInputHash}`);
  await database
    .insertInto('live_exposure_exclusions')
    .values({
      id,
      registry_key: input.registryKey,
      publisher_name: article.name,
      canonical_url: article.url_canonical,
      source_item_id: acquisition.source_item_id,
      published_at: article.published_at,
      first_seen_at: input.observedAt,
      discovery_url: acquisition.discovery_url,
      reason: 'authorized_generic_normalized_input_before_provider',
      content_hash: input.normalizedInputHash,
      near_duplicate_signature: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .execute();
  return id;
}
