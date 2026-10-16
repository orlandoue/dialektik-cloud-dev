import { generateUlid, parseUlid, type Database, type Ulid } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import {
  GOVUK_ATTRIBUTION,
  GOVUK_CONTENT_API_ORIGIN,
  GOVUK_FIRST_ARTICLE_URL,
  govUkContentApiUrl,
  parseGovUkContentMetadata,
  type ParsedGovUkContentMetadata,
} from './govuk-content-api-parser.js';
import { liveHash, nearDuplicateSignature } from './live.adapter.js';

export const GOVUK_RSH_REGISTRY_KEY = 'product-govuk-rsh-content-api-v1';
export const GOVUK_RSH_SOURCE_ID = parseUlid('01M4YDQK00WS344WW8RCPCEQHE');
export const GOVUK_RSH_PUBLISHER = 'Regulator of Social Housing';
export const GOVUK_RSH_CANONICAL_URL = GOVUK_FIRST_ARTICLE_URL;
export const GOVUK_RSH_CONTENT_API_URL = govUkContentApiUrl(GOVUK_RSH_CANONICAL_URL);
export const GOVUK_RSH_RIGHTS_EVIDENCE_URL =
  'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
export const GOVUK_RSH_RIGHTS_REVIEWED_AT = '2026-10-15T00:00:00.000Z';
export const GOVUK_RSH_CONTENT_ID = '86f4abba-9eaa-412f-b048-5ed30aa74201';
export const GOVUK_RSH_ADAPTER_VERSION = 'govuk-rsh-content-api-metadata-v1';
export const GOVUK_RSH_WRITER_ROLE = 'dialektik_govuk_metadata_writer';
const MAX_RIGHTS_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_API_BYTES = 5 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;

export interface GovUkRshMetadata {
  readonly sourceId: Ulid;
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly modifiedAt: string | null;
  readonly locale: string;
  readonly acquiredAt: string;
  readonly metadataHash: string;
  readonly contentHash: string;
  readonly nearDuplicateSignature: string;
  readonly attribution: string;
  readonly rightsEvidenceUrl: string;
  readonly rightsVerifiedAt: string;
}

export interface GovUkRshImportResult {
  readonly status: 'new' | 'updated' | 'unchanged';
  readonly sourceId: Ulid;
  readonly articleId: Ulid;
  readonly canonicalUrl: string;
  readonly sourceItemId: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly modifiedAt: string | null;
  readonly receiptWritten: boolean;
  readonly versionWritten: boolean;
}

interface RobotsRule {
  readonly allow: boolean;
  readonly pattern: string;
}
interface RobotsGroup {
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
}

function assertRightsCurrent(recordedAt: Date): void {
  const reviewed = Date.parse(GOVUK_RSH_RIGHTS_REVIEWED_AT);
  if (
    !Number.isFinite(recordedAt.getTime()) ||
    !Number.isFinite(reviewed) ||
    recordedAt.getTime() < reviewed ||
    recordedAt.getTime() - reviewed > MAX_RIGHTS_AGE_MS
  ) {
    throw new Error('GOVUK_RSH_RIGHTS_REVIEW_REQUIRED');
  }
}

function parseRobotsGroups(robots: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let sawRule = false;
  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
    sawRule = false;
  };
  for (const rawLine of robots.split(/\r?\n/u)) {
    const line = rawLine.split('#', 1)[0]?.trim();
    if (!line) {
      if (sawRule) flush();
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === 'user-agent') {
      if (sawRule) flush();
      agents.push(value.toLowerCase());
      continue;
    }
    if ((name === 'allow' || name === 'disallow') && agents.length > 0) {
      sawRule = true;
      if (value.length > 0) rules.push({ allow: name === 'allow', pattern: value });
    }
  }
  flush();
  return groups;
}

function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression =
    '^' +
    body
      .split('*')
      .map((part) => part.replace(/([\\^$.*+?()[\]{}|])/gu, '\\$1'))
      .join('.*') +
    (anchored ? '' : '.*') +
    '$';
  try {
    return new RegExp(expression, 'u').test(path);
  } catch {
    return false;
  }
}

/** Applies robots.txt user-agent and longest-match rules to the one exact GOV.UK API path. */
export function govUkRobotsAllowsPath(robots: string, path: string): boolean {
  if (typeof robots !== 'string' || robots.length === 0 || !path.startsWith('/')) return false;
  const groups = parseRobotsGroups(robots);
  const agentToken = 'dialektikproductmetadata';
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && agentToken.includes(agent)),
  );
  const applicable =
    specific.length > 0 ? specific : groups.filter((group) => group.agents.includes('*'));
  if (applicable.length === 0) return false;
  const matching = applicable.flatMap((group) =>
    group.rules.filter((rule) => robotsPatternMatches(rule.pattern, path)),
  );
  if (matching.length === 0) return true;
  const specificity = Math.max(...matching.map((rule) => rule.pattern.replace(/\*/gu, '').length));
  const strongest = matching.filter(
    (rule) => rule.pattern.replace(/\*/gu, '').length === specificity,
  );
  return strongest.some((rule) => rule.allow);
}

async function readBounded(response: Response, maxBytes: number, errorCode: string): Promise<Buffer> {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) throw new Error(errorCode);
  if (!response.body) throw new Error(errorCode);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(errorCode);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchExact(
  url: string,
  fetcher: typeof fetch,
  maxBytes: number,
  contentType: RegExp,
  errorCode: string,
): Promise<Buffer> {
  const response = await fetcher(url, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      Accept: contentType.source.includes('json') ? 'application/json' : 'text/plain',
      'User-Agent': 'DialektikProductMetadata/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (
    response.status !== 200 ||
    !contentType.test(response.headers.get('content-type') ?? '') ||
    (response.url !== '' && new URL(response.url).href !== url)
  ) {
    await response.body?.cancel();
    throw new Error(errorCode);
  }
  return readBounded(response, maxBytes, errorCode);
}

/** Makes exactly one robots check and one exact Content API request; it never follows links or polls. */
export async function acquireGovUkRshMetadataOnce(
  options: { readonly fetcher?: typeof fetch; readonly recordedAt?: Date } = {},
): Promise<GovUkRshMetadata> {
  const fetcher = options.fetcher ?? fetch;
  const recordedAt = options.recordedAt ?? new Date();
  assertRightsCurrent(recordedAt);
  const robotsUrl = GOVUK_CONTENT_API_ORIGIN + '/robots.txt';
  const robotsBytes = await fetchExact(
    robotsUrl,
    fetcher,
    MAX_ROBOTS_BYTES,
    /text\/plain/iu,
    'GOVUK_ROBOTS_UNAVAILABLE',
  );
  let robots: string;
  try {
    robots = new TextDecoder('utf-8', { fatal: true }).decode(robotsBytes);
  } catch {
    throw new Error('GOVUK_ROBOTS_INVALID');
  } finally {
    robotsBytes.fill(0);
  }
  const apiPath = new URL(GOVUK_RSH_CONTENT_API_URL).pathname;
  if (!govUkRobotsAllowsPath(robots, apiPath)) throw new Error('GOVUK_ROBOTS_DISALLOWS_API');
  const responseBytes = await fetchExact(
    GOVUK_RSH_CONTENT_API_URL,
    fetcher,
    MAX_API_BYTES,
    /application\/json/iu,
    'GOVUK_CONTENT_API_UNAVAILABLE',
  );
  let parsed: ParsedGovUkContentMetadata;
  try {
    parsed = parseGovUkContentMetadata(responseBytes, GOVUK_RSH_CANONICAL_URL);
  } finally {
    responseBytes.fill(0);
  }
  return projectGovUkRshMetadata(parsed, recordedAt);
}

/** Copies only approved metadata fields; the product parser does not expose an article body. */
export function projectGovUkRshMetadata(
  item: ParsedGovUkContentMetadata,
  recordedAt: Date,
): GovUkRshMetadata {
  assertRightsCurrent(recordedAt);
  if (
    item.contentId !== GOVUK_RSH_CONTENT_ID ||
    item.basePath !== new URL(GOVUK_RSH_CANONICAL_URL).pathname ||
    item.documentType !== 'press_release' ||
    item.schemaName !== 'news_article' ||
    item.publisher !== GOVUK_RSH_PUBLISHER ||
    typeof item.title !== 'string' ||
    item.title.trim().length === 0 ||
    Array.from(item.title).length > 1024 ||
    item.title.includes('\u0000') ||
    item.contentBodyPresent !== true ||
    (item.locale !== null && item.locale !== 'en')
  ) {
    throw new Error('GOVUK_RSH_ITEM_OUT_OF_SCOPE');
  }
  const publishedAt = new Date(item.firstPublishedAt);
  const modifiedAt = item.publicUpdatedAt === null ? null : new Date(item.publicUpdatedAt);
  if (
    !Number.isFinite(publishedAt.getTime()) ||
    publishedAt.toISOString() !== item.firstPublishedAt ||
    (modifiedAt !== null &&
      (!Number.isFinite(modifiedAt.getTime()) ||
        modifiedAt.toISOString() !== item.publicUpdatedAt ||
        modifiedAt < publishedAt)) ||
    publishedAt > recordedAt ||
    (modifiedAt !== null && modifiedAt > recordedAt)
  ) {
    throw new Error('GOVUK_RSH_DATES_INVALID');
  }
  const fields = {
    sourceItemId: item.contentId,
    canonicalUrl: GOVUK_RSH_CANONICAL_URL,
    title: item.title,
    publisher: item.publisher,
    publishedAt: item.firstPublishedAt,
    modifiedAt: item.publicUpdatedAt,
    locale: item.locale ?? 'en',
    rightsEvidenceUrl: GOVUK_RSH_RIGHTS_EVIDENCE_URL,
    rightsVerifiedAt: GOVUK_RSH_RIGHTS_REVIEWED_AT,
    attribution: GOVUK_ATTRIBUTION,
    discoveryChannel: 'official_api',
    discoveryUrl: GOVUK_RSH_CONTENT_API_URL,
  };
  return Object.freeze({
    sourceId: GOVUK_RSH_SOURCE_ID,
    sourceItemId: item.contentId,
    canonicalUrl: GOVUK_RSH_CANONICAL_URL,
    title: item.title,
    publishedAt: item.firstPublishedAt,
    modifiedAt: item.publicUpdatedAt,
    locale: item.locale ?? 'en',
    acquiredAt: recordedAt.toISOString(),
    metadataHash: liveHash(JSON.stringify(fields)),
    contentHash: liveHash(item.title),
    nearDuplicateSignature: nearDuplicateSignature(item.title),
    attribution: GOVUK_ATTRIBUTION,
    rightsEvidenceUrl: GOVUK_RSH_RIGHTS_EVIDENCE_URL,
    rightsVerifiedAt: GOVUK_RSH_RIGHTS_REVIEWED_AT,
  });
}

function policyJson() {
  return {
    sourceId: GOVUK_RSH_SOURCE_ID,
    registryKey: GOVUK_RSH_REGISTRY_KEY,
    publisherName: GOVUK_RSH_PUBLISHER,
    canonicalDomain: 'gov.uk',
    sourceType: 'other',
    publisherFamily: GOVUK_RSH_PUBLISHER,
    category: null,
    discoveryChannel: 'official_api',
    endpoint: GOVUK_RSH_CONTENT_API_URL,
    rightsClass: 'LIVE_READY',
    storagePolicy: 'METADATA_ONLY',
    active: true,
    rightsEvidenceUrl: GOVUK_RSH_RIGHTS_EVIDENCE_URL,
    rightsVerifiedAt: GOVUK_RSH_RIGHTS_REVIEWED_AT,
    attribution: GOVUK_ATTRIBUTION,
    language: 'en',
    allowedArticleDomains: ['www.gov.uk'],
    metadataStorageGranted: true,
    externalSourceLinkGranted: true,
    fulltextAcquisition: false,
    fulltextMachineProcessing: false,
    fulltextPersistence: false,
    derivedSemanticPersistence: false,
    thirdPartyContent: 'excluded',
    attachments: 'excluded',
    images: 'excluded',
    polling: 'disabled',
  };
}
function sourcePolicyId(): string {
  return liveHash(JSON.stringify(policyJson()));
}
function exclusionId(identity: string): string {
  return liveHash(GOVUK_RSH_REGISTRY_KEY + '\n' + identity);
}
function newId(recordedAt: Date): Ulid {
  return generateUlid({ now: () => recordedAt.getTime() });
}

function assertSourceRow(row: Record<string, unknown> | undefined): void {
  if (
    !row ||
    row.id !== GOVUK_RSH_SOURCE_ID ||
    row.name !== GOVUK_RSH_PUBLISHER ||
    row.canonical_domain !== 'gov.uk' ||
    row.source_type !== 'other' ||
    row.origin !== 'LIVE_REAL' ||
    row.is_issuing_entity !== false
  ) {
    throw new Error('GOVUK_RSH_SOURCE_CONFLICT');
  }
}

function assertPolicyRow(row: Record<string, unknown> | undefined, expectedId: string): void {
  const json = row?.policy as Record<string, unknown> | undefined;
  if (
    !row ||
    row.id !== expectedId ||
    row.source_id !== GOVUK_RSH_SOURCE_ID ||
    row.registry_key !== GOVUK_RSH_REGISTRY_KEY ||
    row.rights_class !== 'LIVE_READY' ||
    row.storage_policy !== 'METADATA_ONLY' ||
    row.active !== true ||
    row.rights_evidence_url !== GOVUK_RSH_RIGHTS_EVIDENCE_URL ||
    !json ||
    json.discoveryChannel !== 'official_api' ||
    json.endpoint !== GOVUK_RSH_CONTENT_API_URL ||
    json.attribution !== GOVUK_ATTRIBUTION ||
    json.fulltextMachineProcessing !== false ||
    json.fulltextPersistence !== false ||
    json.derivedSemanticPersistence !== false
  ) {
    throw new Error('GOVUK_RSH_POLICY_CONFLICT');
  }
}

async function insertAndVerifyExclusion(
  transaction: Kysely<Database>,
  metadata: GovUkRshMetadata,
  row: {
    readonly id: string;
    readonly canonical_url: string | null;
    readonly source_item_id: string | null;
    readonly content_hash: string | null;
    readonly near_duplicate_signature: string | null;
    readonly reason: string;
  },
): Promise<void> {
  await transaction
    .insertInto('live_exposure_exclusions')
    .values({
      ...row,
      registry_key: GOVUK_RSH_REGISTRY_KEY,
      publisher_name: GOVUK_RSH_PUBLISHER,
      published_at: new Date(metadata.publishedAt),
      first_seen_at: new Date(metadata.acquiredAt),
      discovery_url: GOVUK_RSH_CONTENT_API_URL,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .execute();
  const existing = await transaction
    .selectFrom('live_exposure_exclusions')
    .select([
      'id',
      'registry_key',
      'publisher_name',
      'canonical_url',
      'source_item_id',
      'discovery_url',
      'published_at',
      'reason',
      'content_hash',
      'near_duplicate_signature',
    ])
    .where('id', '=', row.id)
    .executeTakeFirst();
  if (
    !existing ||
    existing.registry_key !== GOVUK_RSH_REGISTRY_KEY ||
    existing.publisher_name !== GOVUK_RSH_PUBLISHER ||
    existing.canonical_url !== row.canonical_url ||
    existing.source_item_id !== row.source_item_id ||
    existing.discovery_url !== GOVUK_RSH_CONTENT_API_URL ||
    existing.published_at?.toISOString() !== metadata.publishedAt ||
    existing.reason !== row.reason ||
    existing.content_hash !== row.content_hash ||
    existing.near_duplicate_signature !== row.near_duplicate_signature
  ) {
    throw new Error('GOVUK_RSH_EXCLUSION_CONFLICT');
  }
}

function assertMetadataShape(metadata: GovUkRshMetadata, recordedAt: Date): void {
  const keys = Object.keys(metadata).sort().join(',');
  const expected = [
    'acquiredAt',
    'attribution',
    'canonicalUrl',
    'contentHash',
    'metadataHash',
    'modifiedAt',
    'nearDuplicateSignature',
    'publishedAt',
    'rightsEvidenceUrl',
    'rightsVerifiedAt',
    'sourceId',
    'sourceItemId',
    'title',
    'locale',
  ]
    .sort()
    .join(',');
  if (
    keys !== expected ||
    metadata.sourceId !== GOVUK_RSH_SOURCE_ID ||
    metadata.canonicalUrl !== GOVUK_RSH_CANONICAL_URL ||
    metadata.sourceItemId !== GOVUK_RSH_CONTENT_ID ||
    metadata.attribution !== GOVUK_ATTRIBUTION ||
    metadata.rightsEvidenceUrl !== GOVUK_RSH_RIGHTS_EVIDENCE_URL ||
    metadata.rightsVerifiedAt !== GOVUK_RSH_RIGHTS_REVIEWED_AT ||
    metadata.locale !== 'en' ||
    !/^[0-9a-f]{64}$/u.test(metadata.metadataHash) ||
    !/^[0-9a-f]{64}$/u.test(metadata.contentHash) ||
    !/^metadata-token-set-v1:[0-9a-f]{64}$/u.test(metadata.nearDuplicateSignature) ||
    typeof metadata.title !== 'string' ||
    metadata.title.trim().length === 0 ||
    Array.from(metadata.title).length > 1024 ||
    metadata.title.includes('\u0000') ||
    !Number.isFinite(Date.parse(metadata.publishedAt)) ||
    new Date(metadata.publishedAt).toISOString() !== metadata.publishedAt ||
    !Number.isFinite(Date.parse(metadata.acquiredAt)) ||
    new Date(metadata.acquiredAt).toISOString() !== metadata.acquiredAt ||
    metadata.contentHash !== liveHash(metadata.title) ||
    metadata.nearDuplicateSignature !== nearDuplicateSignature(metadata.title) ||
    metadata.metadataHash !== liveHash(
      JSON.stringify({
        sourceItemId: metadata.sourceItemId,
        canonicalUrl: metadata.canonicalUrl,
        title: metadata.title,
        publisher: GOVUK_RSH_PUBLISHER,
        publishedAt: metadata.publishedAt,
        modifiedAt: metadata.modifiedAt,
        locale: metadata.locale,
        rightsEvidenceUrl: metadata.rightsEvidenceUrl,
        rightsVerifiedAt: metadata.rightsVerifiedAt,
        attribution: metadata.attribution,
        discoveryChannel: 'official_api',
        discoveryUrl: GOVUK_RSH_CONTENT_API_URL,
      }),
    ) ||
    Date.parse(metadata.publishedAt) > recordedAt.getTime() ||
    Date.parse(metadata.acquiredAt) > recordedAt.getTime() ||
    (metadata.modifiedAt !== null &&
      (!Number.isFinite(Date.parse(metadata.modifiedAt)) ||
        Date.parse(metadata.modifiedAt) < Date.parse(metadata.publishedAt) ||
        Date.parse(metadata.modifiedAt) > recordedAt.getTime()))
  ) {
    throw new Error('GOVUK_RSH_METADATA_DENIED');
  }
}

/** One Article only. All writes and immutable provenance rows share one transaction. */
export async function persistGovUkRshMetadataOnce(
  database: Kysely<Database>,
  metadata: GovUkRshMetadata,
  options: { readonly recordedAt?: Date } = {},
): Promise<GovUkRshImportResult> {
  const recordedAt = options.recordedAt ?? new Date();
  assertRightsCurrent(recordedAt);
  assertMetadataShape(metadata, recordedAt);
  const policy = policyJson();
  const policyId = sourcePolicyId();
  const contentHash = liveHash(metadata.title);
  const signature = nearDuplicateSignature(metadata.title);
  if (metadata.contentHash !== contentHash || metadata.nearDuplicateSignature !== signature) {
    throw new Error('GOVUK_RSH_METADATA_HASH_MISMATCH');
  }

  return database.transaction().execute(async (transaction) => {
    await sql.raw(
      "select pg_advisory_xact_lock(hashtextextended('" + GOVUK_RSH_REGISTRY_KEY + "',0))",
    ).execute(transaction);
    await transaction
      .insertInto('sources')
      .values({
        id: GOVUK_RSH_SOURCE_ID,
        name: GOVUK_RSH_PUBLISHER,
        source_type: 'other',
        is_issuing_entity: false,
        canonical_domain: 'gov.uk',
        origin: 'LIVE_REAL',
        created_at: recordedAt,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
    const source = await transaction
      .selectFrom('sources')
      .select(['id', 'name', 'canonical_domain', 'source_type', 'origin', 'is_issuing_entity'])
      .where('id', '=', GOVUK_RSH_SOURCE_ID)
      .executeTakeFirst();
    assertSourceRow(source as Record<string, unknown> | undefined);

    const latestPolicy = await transaction
      .selectFrom('live_source_policies')
      .select([
        'id',
        'source_id',
        'registry_key',
        'rights_class',
        'storage_policy',
        'active',
        'rights_evidence_url',
        'policy',
      ])
      .where('source_id', '=', GOVUK_RSH_SOURCE_ID)
      .orderBy('recorded_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (latestPolicy && latestPolicy.id !== policyId)
      throw new Error('GOVUK_RSH_POLICY_CONFLICT');
    await transaction
      .insertInto('live_source_policies')
      .values({
        id: policyId,
        source_id: GOVUK_RSH_SOURCE_ID,
        registry_key: GOVUK_RSH_REGISTRY_KEY,
        rights_class: 'LIVE_READY',
        storage_policy: 'METADATA_ONLY',
        active: true,
        rights_evidence_url: GOVUK_RSH_RIGHTS_EVIDENCE_URL,
        rights_verified_at: new Date(GOVUK_RSH_RIGHTS_REVIEWED_AT),
        policy,
        recorded_at: recordedAt,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
    const policyRow = await transaction
      .selectFrom('live_source_policies')
      .select([
        'id',
        'source_id',
        'registry_key',
        'rights_class',
        'storage_policy',
        'active',
        'rights_evidence_url',
        'policy',
      ])
      .where('id', '=', policyId)
      .executeTakeFirst();
    assertPolicyRow(policyRow as Record<string, unknown> | undefined, policyId);

    const canonicalExclusionId = exclusionId('url:' + metadata.canonicalUrl);
    await insertAndVerifyExclusion(transaction, metadata, {
      id: canonicalExclusionId,
      canonical_url: metadata.canonicalUrl,
      source_item_id: metadata.sourceItemId,
      content_hash: null,
      near_duplicate_signature: null,
      reason: 'govuk_rsh_metadata_acquisition',
    });
    await insertAndVerifyExclusion(transaction, metadata, {
      id: exclusionId('content:' + metadata.canonicalUrl + ':' + contentHash),
      canonical_url: metadata.canonicalUrl,
      source_item_id: metadata.sourceItemId,
      content_hash: contentHash,
      near_duplicate_signature: signature,
      reason: 'govuk_rsh_metadata_title_hash',
    });
    await insertAndVerifyExclusion(transaction, metadata, {
      id: exclusionId('source-item:' + metadata.sourceItemId),
      canonical_url: null,
      source_item_id: metadata.sourceItemId,
      content_hash: null,
      near_duplicate_signature: null,
      reason: 'govuk_rsh_metadata_source_identity',
    });

    const byUrl = await transaction
      .selectFrom('articles')
      .select([
        'id',
        'source_id',
        'url_canonical',
        'origin',
        'event_id',
        'live_exposure_id',
        'captured_at',
      ])
      .where('url_canonical', '=', metadata.canonicalUrl)
      .executeTakeFirst();
    const byItem = await transaction
      .selectFrom('articles as a')
      .innerJoin('live_acquisition_receipts as r', 'r.exclusion_id', 'a.live_exposure_id')
      .select([
        'a.id',
        'a.source_id',
        'a.url_canonical',
        'a.origin',
        'a.event_id',
        'a.live_exposure_id',
        'a.captured_at',
      ])
      .where('r.source_id', '=', GOVUK_RSH_SOURCE_ID)
      .where('r.source_item_id', '=', metadata.sourceItemId)
      .executeTakeFirst();
    if (byUrl && byItem && byUrl.id !== byItem.id)
      throw new Error('GOVUK_RSH_ARTICLE_IDENTITY_CONFLICT');
    const existing = byUrl ?? byItem;
    if (
      existing &&
      (existing.origin !== 'LIVE_REAL' ||
        existing.event_id !== null ||
        existing.source_id !== GOVUK_RSH_SOURCE_ID ||
        existing.url_canonical !== metadata.canonicalUrl ||
        existing.live_exposure_id !== canonicalExclusionId)
    ) {
      throw new Error('GOVUK_RSH_ARTICLE_IDENTITY_CONFLICT');
    }
    if (existing) {
      const oldItemIds = await transaction
        .selectFrom('live_acquisition_receipts')
        .select('source_item_id')
        .where('source_id', '=', GOVUK_RSH_SOURCE_ID)
        .where('exclusion_id', '=', canonicalExclusionId)
        .where('source_item_id', 'is not', null)
        .execute();
      if (oldItemIds.some((row) => row.source_item_id !== metadata.sourceItemId))
        throw new Error('GOVUK_RSH_ARTICLE_IDENTITY_CONFLICT');
    }

    const articleId = existing?.id ?? newId(recordedAt);
    const latestVersion = await transaction
      .selectFrom('live_article_versions')
      .select(['version_number', 'metadata_hash'])
      .where('article_id', '=', articleId)
      .orderBy('version_number', 'desc')
      .executeTakeFirst();
    const sameVersion = latestVersion?.metadata_hash === metadata.metadataHash;
    const currentReceipt = sameVersion
      ? await transaction
          .selectFrom('live_acquisition_receipts')
          .select('id')
          .where('source_id', '=', GOVUK_RSH_SOURCE_ID)
          .where('exclusion_id', '=', canonicalExclusionId)
          .where('raw_payload_hash', '=', metadata.metadataHash)
          .where('adapter_version', '=', GOVUK_RSH_ADAPTER_VERSION)
          .where('disposition', '=', 'PERSISTED')
          .executeTakeFirst()
      : undefined;
    if (sameVersion && currentReceipt) {
      return {
        status: 'unchanged',
        sourceId: GOVUK_RSH_SOURCE_ID,
        articleId,
        canonicalUrl: metadata.canonicalUrl,
        sourceItemId: metadata.sourceItemId,
        title: metadata.title,
        publishedAt: metadata.publishedAt,
        modifiedAt: metadata.modifiedAt,
        receiptWritten: false,
        versionWritten: false,
      };
    }

    const receiptId = newId(recordedAt);
    await transaction
      .insertInto('live_acquisition_receipts')
      .values({
        id: receiptId,
        source_id: GOVUK_RSH_SOURCE_ID,
        policy_id: policyId,
        exclusion_id: canonicalExclusionId,
        discovery_channel: 'official_api',
        discovery_url: GOVUK_RSH_CONTENT_API_URL,
        discovered_url: metadata.canonicalUrl,
        canonical_url: metadata.canonicalUrl,
        source_item_id: metadata.sourceItemId,
        published_at: new Date(metadata.publishedAt),
        modified_at: metadata.modifiedAt === null ? null : new Date(metadata.modifiedAt),
        original_published_at: metadata.publishedAt,
        original_modified_at: metadata.modifiedAt,
        seen_at: new Date(metadata.acquiredAt),
        raw_payload_hash: metadata.metadataHash,
        adapter_version: GOVUK_RSH_ADAPTER_VERSION,
        disposition: 'PERSISTED',
        error_code: null,
      })
      .execute();
    if (!existing) {
      await transaction
        .insertInto('articles')
        .values({
          id: articleId,
          source_id: GOVUK_RSH_SOURCE_ID,
          event_id: null,
          url_canonical: metadata.canonicalUrl,
          text_original: metadata.title,
          text_normalized: metadata.title,
          lang: metadata.locale,
          published_at: new Date(metadata.publishedAt),
          captured_at: new Date(metadata.acquiredAt),
          updated_at_source: metadata.modifiedAt === null ? null : new Date(metadata.modifiedAt),
          origin: 'LIVE_REAL',
          live_exposure_id: canonicalExclusionId,
        })
        .execute();
    }
    const versionWritten = !sameVersion;
    if (versionWritten) {
      await transaction
        .insertInto('live_article_versions')
        .values({
          id: newId(recordedAt),
          article_id: articleId,
          receipt_id: receiptId,
          version_number: (latestVersion?.version_number ?? 0) + 1,
          metadata_hash: metadata.metadataHash,
          headline: metadata.title,
          published_at: new Date(metadata.publishedAt),
          modified_at: metadata.modifiedAt === null ? null : new Date(metadata.modifiedAt),
          content_hash: contentHash,
          near_duplicate_signature: signature,
          recorded_at: recordedAt,
        })
        .execute();
    }
    return {
      status: sameVersion ? 'unchanged' : existing ? 'updated' : 'new',
      sourceId: GOVUK_RSH_SOURCE_ID,
      articleId,
      canonicalUrl: metadata.canonicalUrl,
      sourceItemId: metadata.sourceItemId,
      title: metadata.title,
      publishedAt: metadata.publishedAt,
      modifiedAt: metadata.modifiedAt,
      receiptWritten: true,
      versionWritten,
    };
  });
}
