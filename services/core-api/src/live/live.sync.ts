import { generateUlid, type Database, type Ulid } from '@dialektik/database';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { CoreApiConfig } from '../config/core-api-config.js';
import {
  canonicalizeLiveUrl,
  discoverMalformedFeedIdentities,
  liveHash,
  LIVE_ADAPTER_VERSION,
  nearDuplicateSignature,
  parseLiveFeedBatches,
  type LiveDiscoveredItem,
} from './live.adapter.js';
import { assertLiveSourceReady, type LiveSourcePolicy } from './live.registry.js';
import { fetchMetaDescription } from './meta-description.js';

export interface LivePreflightExposure {
  readonly canonicalUrl: string | null;
  readonly sourceItemId?: string | null;
  readonly sourceRegistryKey: string;
  readonly publisherName: string;
  readonly firstSeenAt: string;
  readonly reason: string;
  readonly discoveryUrl?: string;
}

export interface LiveSyncSummary {
  sourcesPolled: number;
  successfulSources: number;
  failedSources: number;
  itemsDiscovered: number;
  newArticles: number;
  updatedArticles: number;
  unchangedArticles: number;
  duplicateArticles: number;
  failedItems: number;
  excludedItems: number;
  quarantinedItems: number;
  sourceResults: {
    registryKey: string;
    status: 'succeeded' | 'failed';
    errorCode: string | null;
  }[];
}

export const emptyLiveSyncSummary = (): LiveSyncSummary => ({
  sourcesPolled: 0,
  successfulSources: 0,
  failedSources: 0,
  itemsDiscovered: 0,
  newArticles: 0,
  updatedArticles: 0,
  unchangedArticles: 0,
  duplicateArticles: 0,
  failedItems: 0,
  excludedItems: 0,
  quarantinedItems: 0,
  sourceResults: [],
});
const nextId = (now: Date): Ulid => generateUlid({ now: () => now.getTime() });
const exposureId = (key: string, identity: string): string => liveHash(`${key}\n${identity}`);

export function assertLiveDatabase(config: Readonly<CoreApiConfig>): void {
  const target = new URL(config.databaseUrl);
  if (
    config.nodeEnvironment === 'production' ||
    config.semanticMode !== 'unassigned' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    !['127.0.0.1', 'localhost', '::1'].includes(config.host) ||
    !/^\/dialektik_(?:product_live_shadow_v1|personal_owner_local|test_[a-z0-9_]+)$/.test(
      target.pathname,
    )
  ) {
    throw new Error('Live ingestion requires its isolated local unassigned profile.');
  }
}

function policyJson(policy: LiveSourcePolicy) {
  // Stable property order makes the registry version independent of caller object construction.
  return {
    sourceId: policy.sourceId,
    registryKey: policy.registryKey,
    publisherName: policy.publisherName,
    canonicalDomain: policy.canonicalDomain,
    sourceType: policy.sourceType,
    publisherFamily: policy.publisherFamily,
    category: policy.category,
    discoveryChannel: policy.discoveryChannel,
    endpoint: policy.endpoint,
    rightsClass: policy.rightsClass,
    storagePolicy: policy.storagePolicy,
    active: policy.active,
    rightsEvidenceUrl: policy.rightsEvidenceUrl,
    rightsVerifiedAt: policy.rightsVerifiedAt,
    attribution: policy.attribution,
    language: policy.language,
    allowedArticleDomains: [...policy.allowedArticleDomains].sort(),
    canonicalPathAliases: Object.fromEntries(
      Object.entries(policy.canonicalPathAliases ?? {}).sort(),
    ),
  };
}

async function registerSource(
  database: Kysely<Database>,
  policy: LiveSourcePolicy,
  now: Date,
): Promise<string> {
  assertLiveSourceReady(policy);
  const normalized = policyJson(policy);
  const id = liveHash(JSON.stringify(normalized));
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto('sources')
      .values({
        id: policy.sourceId,
        name: policy.publisherName,
        canonical_domain: policy.canonicalDomain,
        source_type: policy.sourceType,
        origin: 'LIVE_REAL',
        is_issuing_entity: false,
        created_at: now,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
    const stored = await transaction
      .selectFrom('sources')
      .selectAll()
      .where('id', '=', policy.sourceId)
      .executeTakeFirstOrThrow();
    if (
      stored.origin !== 'LIVE_REAL' ||
      stored.name !== policy.publisherName ||
      stored.canonical_domain !== policy.canonicalDomain ||
      stored.source_type !== policy.sourceType
    ) {
      throw new Error('LIVE_SOURCE_IDENTITY_CONFLICT');
    }
    await transaction
      .insertInto('live_source_policies')
      .values({
        id,
        source_id: policy.sourceId,
        registry_key: policy.registryKey,
        rights_class: policy.rightsClass,
        storage_policy: policy.storagePolicy,
        active: policy.active,
        rights_evidence_url: policy.rightsEvidenceUrl,
        rights_verified_at: policy.rightsVerifiedAt,
        policy: normalized,
        recorded_at: now,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
  });
  return id;
}

export async function importLivePreflightExposures(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  records: readonly LivePreflightExposure[],
): Promise<number> {
  assertLiveDatabase(config);
  let inserted = 0;
  for (const item of records) {
    const canonical = item.canonicalUrl === null ? null : canonicalizeLiveUrl(item.canonicalUrl);
    const firstSeen = new Date(item.firstSeenAt);
    if (
      !Number.isFinite(firstSeen.getTime()) ||
      item.reason.trim().length === 0 ||
      item.publisherName.trim().length === 0 ||
      item.sourceRegistryKey.trim().length === 0 ||
      (canonical === null && !item.sourceItemId)
    ) {
      throw new Error('INVALID_PREFLIGHT_EXPOSURE');
    }
    const result = await database
      .insertInto('live_exposure_exclusions')
      .values({
        id: exposureId(
          item.sourceRegistryKey,
          canonical ?? `source-item:${item.sourceItemId ?? ''}`,
        ),
        registry_key: item.sourceRegistryKey,
        publisher_name: item.publisherName,
        canonical_url: canonical,
        source_item_id: item.sourceItemId ?? null,
        published_at: null,
        first_seen_at: firstSeen,
        discovery_url: item.discoveryUrl ?? null,
        reason: item.reason,
        content_hash: null,
        near_duplicate_signature: null,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .executeTakeFirst();
    inserted += Number(result.numInsertedOrUpdatedRows ?? 0n);
  }
  return inserted;
}

async function excludeItem(
  database: Kysely<Database>,
  policy: LiveSourcePolicy,
  item: LiveDiscoveredItem,
  now: Date,
  discoveryUrl: string,
): Promise<string> {
  const identity = item.canonicalUrl ?? `source-item:${item.sourceItemId}`;
  const id = exposureId(policy.registryKey, identity);
  const legalText =
    item.errorCode === 'THIRD_PARTY_OR_COPYRIGHT_MARKER'
      ? ''
      : [item.headline, item.excerpt].filter((value) => value !== null).join('\n');
  const hash = legalText.length > 0 ? liveHash(legalText.normalize('NFC')) : null;
  const signature = legalText.length > 0 ? nearDuplicateSignature(legalText) : null;
  // The permanent identity and every observed authorized content variant are both frozen.
  const rows = [
    id,
    ...(hash === null ? [] : [exposureId(policy.registryKey, `${identity}\n${hash}`)]),
  ];
  await database
    .insertInto('live_exposure_exclusions')
    .values(
      rows.map((rowId) => ({
        id: rowId,
        registry_key: policy.registryKey,
        publisher_name: policy.publisherName,
        canonical_url: item.canonicalUrl,
        source_item_id: item.sourceItemId,
        published_at: item.publishedAt,
        first_seen_at: now,
        discovery_url: discoveryUrl,
        reason:
          item.errorCode === null
            ? 'live_feed_discovery'
            : `live_feed_quarantine:${item.errorCode}`,
        content_hash: hash,
        near_duplicate_signature: signature,
      })),
    )
    .onConflict((conflict) => conflict.column('id').doNothing())
    .execute();
  // A later URL alias must remain excludable by the publisher's stable GUID too,
  // even when an earlier URL-only preflight row already exists and cannot be enriched.
  await database
    .insertInto('live_exposure_exclusions')
    .values({
      id: exposureId(policy.registryKey, `source-item:${item.sourceItemId}`),
      registry_key: policy.registryKey,
      publisher_name: policy.publisherName,
      canonical_url: null,
      source_item_id: item.sourceItemId,
      published_at: item.publishedAt,
      first_seen_at: now,
      discovery_url: discoveryUrl,
      reason: 'live_feed_source_item_identity',
      content_hash: hash,
      near_duplicate_signature: signature,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .execute();
  return id;
}

function receipt(
  policy: LiveSourcePolicy,
  policyId: string,
  item: LiveDiscoveredItem,
  exclusionId: string,
  now: Date,
  discoveryUrl: string,
  error: string | null,
) {
  return {
    id: nextId(now),
    source_id: policy.sourceId,
    policy_id: policyId,
    exclusion_id: exclusionId,
    discovery_channel: policy.discoveryChannel === 'news_sitemap' ? 'rss_atom' : policy.discoveryChannel,
    discovery_channel_detail: policy.discoveryChannel,
    discovery_url: discoveryUrl,
    discovered_url: item.discoveredUrl,
    canonical_url: item.canonicalUrl,
    source_item_id: item.sourceItemId,
    published_at: item.publishedAt,
    modified_at: item.modifiedAt,
    original_published_at: item.originalPublishedAt,
    original_modified_at: item.originalModifiedAt,
    seen_at: now,
    raw_payload_hash: item.rawPayloadHash,
    adapter_version: LIVE_ADAPTER_VERSION,
    disposition: error === null ? ('PERSISTED' as const) : ('QUARANTINED' as const),
    error_code: error,
  };
}

async function refreshLiveArticleTextProjection(
  transaction: Transaction<Database>,
  articleId: Ulid,
  versionId: Ulid,
  language: string,
  headline: string,
  excerpt: string | null,
): Promise<boolean> {
  const article = await transaction
    .selectFrom('articles')
    .select(['lang', 'text_original', 'text_normalized'])
    .where('id', '=', articleId)
    .executeTakeFirst();
  if (article === undefined) throw new Error('LIVE_ARTICLE_MISSING');

  const update: { lang?: string; text_original?: string; text_normalized?: string } = {};
  if (article.lang !== language) update.lang = language;
  if (excerpt !== null) {
    const originalText = `${headline}. ${excerpt}`;
    const normalizedText = originalText.normalize('NFKC').toLowerCase();
    if (article.text_original !== originalText || article.text_normalized !== normalizedText) {
      const semanticHistory = await sql<{ present: boolean }>`
        select exists(select 1 from public.claim_spans where article_id=${articleId})
          or exists(select 1 from public.assertion_extraction_generations
            where article_id=${articleId} and state='active') as present
      `.execute(transaction);
      if (semanticHistory.rows[0]?.present !== true) {
        await sql`
          select set_config('dialektik.allow_live_excerpt_projection','on',true),
            set_config('dialektik.live_excerpt_version_id',${versionId},true)
        `.execute(transaction);
        update.text_original = originalText;
        update.text_normalized = normalizedText;
      }
    }
  }
  if (Object.keys(update).length === 0) return false;
  await transaction.updateTable('articles').set(update).where('id', '=', articleId).execute();
  return true;
}

async function persistItem(
  transaction: Transaction<Database>,
  policy: LiveSourcePolicy,
  policyId: string,
  item: LiveDiscoveredItem,
  exclusionId: string,
  now: Date,
  discoveryUrl: string,
): Promise<'new' | 'updated' | 'unchanged'> {
  if (item.canonicalUrl === null || item.headline === null || item.publishedAt === null)
    throw new Error('INVALID_ITEM');
  await sql`select pg_advisory_xact_lock(hashtextextended(${`live-source:${policy.sourceId}`}, 0))`.execute(
    transaction,
  );
  const byUrl = await transaction
    .selectFrom('articles')
    .selectAll()
    .where('url_canonical', '=', item.canonicalUrl)
    .executeTakeFirst();
  const bySourceItem =
    byUrl === undefined
      ? await transaction
          .selectFrom('articles as a')
          .innerJoin('live_acquisition_receipts as r', 'r.exclusion_id', 'a.live_exposure_id')
          .selectAll('a')
          .where('r.source_id', '=', policy.sourceId)
          .where('r.source_item_id', '=', item.sourceItemId)
          .orderBy('r.seen_at', 'asc')
          .executeTakeFirst()
      : undefined;
  const existing = byUrl ?? bySourceItem;
  if (
    existing !== undefined &&
    (existing.origin !== 'LIVE_REAL' || existing.source_id !== policy.sourceId)
  ) {
    throw new Error('ARTICLE_IDENTITY_CONFLICT');
  }
  const articleId = existing?.id ?? nextId(now);
  const linkedExclusion = existing?.live_exposure_id ?? exclusionId;
  const acquisition = receipt(policy, policyId, item, linkedExclusion, now, discoveryUrl, null);
  await transaction.insertInto('live_acquisition_receipts').values(acquisition).execute();
  const originalText = [item.headline, item.excerpt]
    .filter((part): part is string => part !== null)
    .join('. ');
  const normalizedText = originalText.normalize('NFKC').toLowerCase();
  if (existing === undefined) {
    await transaction
      .insertInto('articles')
      .values({
        id: articleId,
        source_id: policy.sourceId,
        event_id: null,
        url_canonical: item.canonicalUrl,
        text_original: originalText,
        text_normalized: normalizedText,
        lang: item.language,
        published_at: item.publishedAt,
        captured_at: now,
        updated_at_source: item.modifiedAt,
        declares_wire: item.declaredUpstream,
        syndication_of: null,
        syndication_confidence: null,
        clustering_score: null,
        processing_error: null,
        origin: 'LIVE_REAL',
        live_exposure_id: linkedExclusion,
      })
      .execute();
  }
  const metadata = {
    headline: item.headline,
    excerpt: item.excerpt,
    author: item.author,
    publishedAt: item.publishedAt.toISOString(),
    modifiedAt: item.modifiedAt?.toISOString() ?? null,
    canonicalUrl: item.canonicalUrl,
    declaredUpstream: item.declaredUpstream,
  };
  const hash = liveHash(JSON.stringify(metadata));
  const latest = await transaction
    .selectFrom('live_article_versions as v')
    .innerJoin('live_acquisition_receipts as r', 'r.id', 'v.receipt_id')
    .selectAll('v')
    .select('r.canonical_url as version_canonical_url')
    .where('v.article_id', '=', articleId)
    .orderBy('v.version_number', 'desc')
    .executeTakeFirst();
  // Historical hashes may include the acquisition policy ID. Compare only
  // publisher metadata so a clarified rights document never becomes an Article update.
  if (
    latest !== undefined &&
    latest.headline === item.headline &&
    latest.excerpt === item.excerpt &&
    latest.author === item.author &&
    latest.published_at.getTime() === item.publishedAt.getTime() &&
    (latest.modified_at?.getTime() ?? null) === (item.modifiedAt?.getTime() ?? null) &&
    latest.declared_upstream === item.declaredUpstream &&
    latest.version_canonical_url === item.canonicalUrl
  )
    return existing !== undefined &&
      (await refreshLiveArticleTextProjection(
        transaction,
        articleId,
        latest.id,
        item.language,
        item.headline,
        item.excerpt,
      ))
      ? 'updated'
      : 'unchanged';
  const legalText = [item.headline, item.excerpt].filter((part) => part !== null).join('\n');
  const versionId = nextId(now);
  await transaction
    .insertInto('live_article_versions')
    .values({
      id: versionId,
      article_id: articleId,
      receipt_id: acquisition.id,
      version_number: (latest?.version_number ?? 0) + 1,
      metadata_hash: hash,
      headline: item.headline,
      excerpt: item.excerpt,
      author: item.author,
      published_at: item.publishedAt,
      modified_at: item.modifiedAt,
      declared_upstream: item.declaredUpstream,
      content_hash: liveHash(legalText.normalize('NFC')),
      near_duplicate_signature: nearDuplicateSignature(legalText),
      recorded_at: now,
    })
    .execute();
  if (existing !== undefined) {
    await refreshLiveArticleTextProjection(
      transaction,
      articleId,
      versionId,
      item.language,
      item.headline,
      item.excerpt,
    );
  }
  return existing === undefined ? 'new' : 'updated';
}

export async function syncLivePayload(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  policy: LiveSourcePolicy,
  payload: string,
  options: {
    readonly discoveredAt: Date;
    readonly discoveryUrl?: string;
    readonly authorizePersistence?: (transaction: Transaction<Database>) => Promise<void>;
  },
): Promise<LiveSyncSummary> {
  assertLiveDatabase(config);
  const now = options.discoveredAt;
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_DISCOVERY_TIME');
  const discoveryUrl = options.discoveryUrl ?? policy.endpoint;
  if (
    policy.canonicalDomain.endsWith('.invalid') &&
    !new URL(config.databaseUrl).pathname.startsWith('/dialektik_test_')
  ) {
    throw new Error('Authored acquisition contracts require a disposable test database.');
  }
  const policyId = await registerSource(database, policy, now);
  const summary = emptyLiveSyncSummary();
  summary.sourcesPolled = 1;
  let parsed: ReturnType<typeof parseLiveFeedBatches>;
  try {
    parsed = parseLiveFeedBatches(payload, policy);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'FEED_PARSE_FAILED';
    const identities = discoverMalformedFeedIdentities(payload);
    summary.excludedItems = identities.length;
    summary.quarantinedItems = identities.length;
    summary.itemsDiscovered = identities.length;
    summary.failedSources = 1;
    await importLivePreflightExposures(
      database,
      config,
      identities.map((identity) => ({
        ...identity,
        sourceRegistryKey: policy.registryKey,
        publisherName: policy.publisherName,
        firstSeenAt: now.toISOString(),
        discoveryUrl,
        reason: `malformed_feed:${reason}`,
      })),
    );
    summary.sourceResults.push({
      registryKey: policy.registryKey,
      status: 'failed',
      errorCode: reason,
    });
    return summary;
  }
  summary.itemsDiscovered = parsed.itemCount;
  let metaDescriptionReads = 0;
  for (const batch of parsed.batches) {
    // Metadata-only grants never retain RSS summaries in Article or version rows.
    const items: LiveDiscoveredItem[] = [];
    for (const item of batch) {
      if (policy.storagePolicy === 'METADATA_ONLY') {
        items.push(Object.freeze({ ...item, excerpt: null }));
        continue;
      }
      if (
        item.excerpt === null &&
        item.canonicalUrl !== null &&
        options.authorizePersistence !== undefined &&
        metaDescriptionReads < 25
      ) {
        metaDescriptionReads += 1;
        try {
          await database.transaction().execute(async (transaction) => {
            await options.authorizePersistence?.(transaction);
          });
          const excerpt = await fetchMetaDescription(item.canonicalUrl, policy.allowedArticleDomains);
          items.push(excerpt === null ? item : Object.freeze({ ...item, excerpt }));
        } catch {
          // Optional page metadata must never replace or block the RSS record.
          items.push(item);
        }
      } else {
        items.push(item);
      }
    }
    for (const item of items) {
      const excluded = await excludeItem(database, policy, item, now, discoveryUrl);
      summary.excludedItems++;
      let error = item.errorCode;
      if (error === null) {
        try {
          const result = await database.transaction().execute(async (transaction) => {
            await options.authorizePersistence?.(transaction);
            return persistItem(transaction, policy, policyId, item, excluded, now, discoveryUrl);
          });
          if (result === 'new') summary.newArticles++;
          else if (result === 'updated') summary.updatedArticles++;
          else {
            summary.unchangedArticles++;
            summary.duplicateArticles++;
          }
        } catch {
          error = 'ARTICLE_PERSISTENCE_FAILED';
        }
      }
      if (error !== null) {
        summary.failedItems++;
        await database
          .insertInto('live_acquisition_receipts')
          .values(receipt(policy, policyId, item, excluded, now, discoveryUrl, error))
          .execute();
        summary.quarantinedItems++;
      }
    }
  }
  summary.successfulSources = 1;
  summary.sourceResults.push({
    registryKey: policy.registryKey,
    status: 'succeeded',
    errorCode: null,
  });
  return summary;
}

export type LiveAcquire = (
  policy: LiveSourcePolicy,
) => Promise<{ readonly payload: string; readonly discoveryUrl?: string }>;

export async function syncLiveSources(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  policies: readonly LiveSourcePolicy[],
  acquire: LiveAcquire,
): Promise<LiveSyncSummary> {
  assertLiveDatabase(config);
  const summary = emptyLiveSyncSummary();
  for (const policy of policies.filter(
    (candidate) => candidate.active && candidate.rightsClass === 'LIVE_READY',
  )) {
    try {
      assertLiveSourceReady(policy);
      const acquired = await acquire(policy);
      const result = await syncLivePayload(database, config, policy, acquired.payload, {
        discoveredAt: new Date(),
        ...(acquired.discoveryUrl === undefined ? {} : { discoveryUrl: acquired.discoveryUrl }),
      });
      for (const key of [
        'sourcesPolled',
        'successfulSources',
        'failedSources',
        'itemsDiscovered',
        'newArticles',
        'updatedArticles',
        'unchangedArticles',
        'duplicateArticles',
        'failedItems',
        'excludedItems',
        'quarantinedItems',
      ] as const)
        summary[key] += result[key];
      summary.sourceResults.push(...result.sourceResults);
    } catch {
      summary.sourcesPolled++;
      summary.failedSources++;
      summary.sourceResults.push({
        registryKey: policy.registryKey,
        status: 'failed',
        errorCode: 'SOURCE_ACQUISITION_FAILED',
      });
    }
  }
  return summary;
}
