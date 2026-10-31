import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { parseUlid, type Database, type SourceType } from '@dialektik/database';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CorporateLiveAcquisitionDatabaseService } from './corporate-live-acquisition-database.service.js';
import { MAX_LIVE_FEED_BYTES } from './live.adapter.js';
import { fetchMetaDescription } from './meta-description.js';
import {
  assertLiveSourceReady,
  type LiveSourcePolicy,
} from './live.registry.js';
import { syncLivePayload } from './live.sync.js';
import {
  fetchYouTubeDataApiItems,
  YouTubeDataApiError,
  youtubeDataApiRssPayload,
} from './youtube-data-api.js';

const CORPORATE_EDITOR_OWNER = 'orlandoue';
const CORPORATE_ACQUISITION_TICK_MS = 5_000;
const CORPORATE_SOURCE_LEASE_MS = 15 * 60_000;
const MAX_ELMOSTRADOR_BACKFILL = 100;
const MAX_BACKFILL_BATCH = 25;
const MAX_BACKFILL_CONCURRENCY = 4;

interface CorporateFeedResponse {
  readonly status: number;
  readonly content: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

interface CorporateSourceRow {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly canonicalDomain: string;
  readonly sourceType: string;
  readonly connectionId: string;
  readonly decisionId: string;
  readonly endpoint: string;
  readonly channelUrl: string | null;
  readonly discoveryChannel: 'rss_atom' | 'news_sitemap' | 'youtube_data_api_v3';
  readonly allowedArticleDomains: string[];
  readonly rightsEvidenceUrl: string;
  readonly rightsEvidenceSha256: string;
  readonly authorizationReference: string | null;
  readonly attribution: string;
  readonly validFrom: Date;
  readonly expiresAt: Date | null;
  readonly scopes: Record<string, boolean>;
  readonly registryKey: string;
  readonly rightsClass: string;
  readonly storagePolicy: string;
  readonly policyActive: boolean;
  readonly policyEndpoint: string;
  readonly rightsReviewStatus: string | null;
  readonly language: string;
  readonly publisherFamily: string | null;
  readonly category: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly pollIntervalSeconds: number;
}

interface BackfillArticle {
  readonly articleId: string;
  readonly canonicalUrl: string;
  readonly headline: string;
  readonly author: string | null;
  readonly publishedAt: Date;
  readonly inputSha256: string;
}

export interface CorporateAcquisitionStartResult {
  readonly enabled: boolean;
  readonly scheduled: boolean;
  readonly disabledReason: string | null;
  readonly errorType: string | null;
  readonly driverCode: string | null;
  readonly sqlState: string | null;
}

function postgresDiagnostic(error: unknown): {
  readonly driverCode: string | null;
  readonly errorType: string | null;
  readonly sqlState: string | null;
} {
  const queue: unknown[] = [error];
  const seen = new Set<object>();
  let driverCode: string | null = null;
  let errorType: string | null = null;
  for (let depth = 0; depth < 8 && queue.length > 0; depth += 1) {
    const current = queue.shift();
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current);
    const currentRecord = current as Record<string, unknown>;
    if (errorType === null && current instanceof Error) {
      const name = current.constructor.name;
      if (/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name)) errorType = name;
    }
    const code = 'code' in current ? current.code : null;
    if (driverCode === null && typeof code === 'string' && /^[0-9A-Za-z_-]{1,32}$/u.test(code)) {
      driverCode = code;
    }
    for (const key of ['cause', 'error', 'originalError', 'driverError']) {
      if (key in currentRecord) queue.push(currentRecord[key]);
    }
  }
  return {
    driverCode,
    errorType,
    sqlState: driverCode !== null && /^[0-9A-Z]{5}$/u.test(driverCode) ? driverCode : null,
  };
}

function safeDatabaseErrorResource(error: unknown): string | null {
  const queue: unknown[] = [error];
  const seen = new Set<object>();
  for (let depth = 0; depth < 8 && queue.length > 0; depth += 1) {
    const current = queue.shift();
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of ['table', 'column', 'schema', 'constraint']) {
      const value = record[key];
      if (typeof value === 'string' && /^[a-z_][a-z0-9_]{0,62}$/iu.test(value))
        return value.toUpperCase();
    }
    if (typeof record.message === 'string') {
      const match = /(?:permission denied for (?:table|relation|column|sequence|schema)|row-level security policy for table)\s+["']?([a-z_][a-z0-9_]*)/iu.exec(record.message);
      if (match?.[1] !== undefined) return match[1].toUpperCase();
    }
    for (const key of ['cause', 'error', 'originalError', 'driverError']) {
      if (key in record) queue.push(record[key]);
    }
  }
  return null;
}

function xmlText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function boundedArticleXml(articles: readonly (BackfillArticle & { excerpt: string })[]): string {
  const items = articles.map((article) => `
    <item>
      <title>${xmlText(article.headline)}</title>
      <link>${xmlText(article.canonicalUrl)}</link>
      <guid isPermaLink="true">${xmlText(article.canonicalUrl)}</guid>
      <pubDate>${xmlText(article.publishedAt.toUTCString())}</pubDate>
      ${article.author === null ? '' : `<author>${xmlText(article.author)}</author>`}
      <description>${xmlText(article.excerpt)}</description>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>Authorized public metadata backfill</title>
      <description>Publisher-provided public metadata descriptions only</description>${items}
    </channel></rss>`;
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LIVE_FEED_BYTES)
    throw new Error('PUBLISHER_FEED_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PUBLISHER_FEED_EMPTY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_LIVE_FEED_BYTES) throw new Error('PUBLISHER_FEED_TOO_LARGE');
      chunks.push(part.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel().catch(() => undefined);
  }
}

async function readCorporateFeed(
  endpoint: string,
  etag: string | null,
  lastModified: string | null,
): Promise<CorporateFeedResponse> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('PUBLISHER_ENDPOINT_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('PUBLISHER_ENDPOINT_INVALID');
  const headers = new Headers({
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    'user-agent': 'DialektikCorporateAcquisition/1.0',
  });
  if (etag) headers.set('if-none-match', etag);
  if (lastModified) headers.set('if-modified-since', lastModified);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('PUBLISHER_FEED_FETCH_FAILED');
  }
  const safeEtag = response.headers.get('etag');
  const safeLastModified = response.headers.get('last-modified');
  if (response.status === 304) {
    await response.body?.cancel().catch(() => undefined);
    return { status: 304, content: null, etag: safeEtag, lastModified: safeLastModified };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error('PUBLISHER_FEED_FETCH_FAILED'), { status: response.status });
  }
  return {
    status: response.status,
    content: await readBoundedResponse(response),
    etag: safeEtag,
    lastModified: safeLastModified,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

@Injectable()
export class CorporateLiveAcquisitionService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;

  constructor(
    private readonly config: Readonly<CoreApiConfig>,
    private readonly acquisitionDatabaseService: CorporateLiveAcquisitionDatabaseService,
  ) {}

  onModuleInit(): void {
    void this.startIfEnabled().catch(() => undefined);
  }

  public async startIfEnabled(): Promise<CorporateAcquisitionStartResult> {
    const disabledReason = this.config.nodeEnvironment !== 'production'
      ? 'NOT_PRODUCTION'
      : this.config.ownershipMode !== 'corporate'
        ? 'NON_CORPORATE_OWNERSHIP'
        : this.config.semanticMode !== 'disabled'
          ? 'SEMANTIC_MODE_NOT_DISABLED'
          : !this.acquisitionDatabaseService.isConfigured
            ? 'WRITER_CONNECTION_MISSING'
            : process.env.DIALEKTIK_CORPORATE_LIVE_ACQUISITION_ENABLED !== 'true'
              ? 'FEATURE_FLAG_DISABLED'
              : null;
    if (disabledReason !== null) {
      return {
        enabled: false,
        scheduled: false,
        disabledReason,
        errorType: null,
        driverCode: null,
        sqlState: null,
      };
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.pollOneDueSource(), CORPORATE_ACQUISITION_TICK_MS);
      this.timer.unref();
    }
    try {
      await this.markPollScheduled();
    } catch (error) {
      await this.recordClaimFailure(error);
      return { enabled: true, scheduled: false, disabledReason: null, ...postgresDiagnostic(error) };
    }
    void this.pollOneDueSource();
    return {
      enabled: true,
      scheduled: true,
      disabledReason: null,
      errorType: null,
      driverCode: null,
      sqlState: null,
    };
  }

  private async markPollScheduled(): Promise<void> {
    const youtubeApiConfigured = Boolean(process.env.YOUTUBE_API_KEY?.trim());
    await sql`update public.corporate_live_source_poll_state state
      set last_status='POLL_SCHEDULED',last_polled_at=clock_timestamp(),updated_at=clock_timestamp()
      where state.source_id=(select pending.source_id from public.corporate_live_source_poll_state pending
        join public.sources due_source on due_source.id=pending.source_id
        where pending.next_poll_at<=clock_timestamp()
          and (pending.lease_until is null or pending.lease_until<=clock_timestamp())
          and (${youtubeApiConfigured} or due_source.canonical_domain<>'youtube.com')
        order by case when due_source.canonical_domain='elmostrador.cl' then 0
          when due_source.canonical_domain='youtube.com' then 2 else 1 end,
          pending.next_poll_at,pending.source_id limit 1)`.execute(this.database);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get database(): Kysely<Database> {
    return this.acquisitionDatabaseService.database;
  }

  private async claimDueSource(): Promise<string | null> {
    const youtubeApiConfigured = Boolean(process.env.YOUTUBE_API_KEY?.trim());
    return this.database.transaction().execute(async (transaction) => {
      const rows = await sql<{ sourceId: string }>`
        with due as (
          select state.source_id
          from public.corporate_live_source_poll_state state
          join public.sources source on source.id=state.source_id and source.origin='LIVE_REAL'
          join lateral (
            select connection.* from public.corporate_live_source_connections connection
            where connection.source_id=source.id order by connection.sequence_number desc limit 1
          ) connection on connection.active
          join lateral (
            select decision.* from public.personal_owner_source_rights_decisions decision
            where decision.source_id=source.id and decision.owner_identity=${CORPORATE_EDITOR_OWNER}
            order by decision.sequence_number desc limit 1
          ) decision on decision.id=connection.rights_decision_id
          join lateral (
            select policy.* from public.live_source_policies policy
            where policy.source_id=source.id order by policy.recorded_at desc,policy.id desc limit 1
          ) policy on policy.active and policy.rights_class='LIVE_READY'
            and policy.storage_policy='METADATA_AND_FEED_EXCERPT'
            and policy.policy->>'rightsReviewStatus'='APPROVED'
          where decision.decision_status='AUTHORIZED' and decision.local_processing
            and decision.valid_from<=clock_timestamp()
            and (decision.expires_at is null or decision.expires_at>clock_timestamp())
            and decision.scopes->>'acquisition'='true'
            and decision.scopes->>'metadata_storage'='true'
            and decision.scopes->>'excerpt_storage'='true'
            and decision.scopes->>'fulltext_acquisition'='false'
            and decision.scopes->>'fulltext_persistence'='false'
            and state.next_poll_at<=clock_timestamp()
            and (state.lease_until is null or state.lease_until<=clock_timestamp())
            and (${youtubeApiConfigured} or source.canonical_domain<>'youtube.com')
          order by case when source.canonical_domain='elmostrador.cl' then 0
            when source.canonical_domain='youtube.com' then 2 else 1 end,state.next_poll_at,source.id
          for update of state skip locked limit 1
        )
        update public.corporate_live_source_poll_state state
        set lease_until=clock_timestamp()+(${CORPORATE_SOURCE_LEASE_MS}::text||' milliseconds')::interval,
            updated_at=clock_timestamp()
        from due where state.source_id=due.source_id
        returning state.source_id::text as "sourceId"
      `.execute(transaction);
      return rows.rows[0]?.sourceId ?? null;
    });
  }

  private async loadSource(sourceId: string): Promise<CorporateSourceRow | null> {
    const result = await sql<CorporateSourceRow>`
      select source.id::text as "sourceId",source.name as "sourceName",source.canonical_domain as "canonicalDomain",
        source.source_type as "sourceType",connection.id::text as "connectionId",
        decision.id::text as "decisionId",connection.endpoint,connection.channel_url as "channelUrl",
        connection.discovery_channel as "discoveryChannel",connection.allowed_article_domains as "allowedArticleDomains",
        decision.rights_evidence_url as "rightsEvidenceUrl",decision.rights_evidence_sha256 as "rightsEvidenceSha256",
        decision.attribution,decision.valid_from as "validFrom",decision.expires_at as "expiresAt",
        decision.scopes,policy.registry_key as "registryKey",policy.rights_class as "rightsClass",
        policy.storage_policy as "storagePolicy",policy.active as "policyActive",
        policy.policy->>'endpoint' as "policyEndpoint",policy.policy->>'rightsReviewStatus' as "rightsReviewStatus",
        policy.policy->>'authorizationReference' as "authorizationReference",
        coalesce(policy.policy->>'language','es') as language,
        policy.policy->>'publisherFamily' as "publisherFamily",policy.policy->>'category' as category,
        state.etag,state.last_modified as "lastModified",state.poll_interval_seconds as "pollIntervalSeconds"
      from public.sources source
      join lateral(select c.* from public.corporate_live_source_connections c
        where c.source_id=source.id order by c.sequence_number desc limit 1) connection on connection.active
      join lateral(select d.* from public.personal_owner_source_rights_decisions d
        where d.source_id=source.id and d.owner_identity=${CORPORATE_EDITOR_OWNER}
        order by d.sequence_number desc limit 1) decision on decision.id=connection.rights_decision_id
      join lateral(select p.* from public.live_source_policies p where p.source_id=source.id
        order by p.recorded_at desc,p.id desc limit 1) policy on true
      join public.corporate_live_source_poll_state state on state.source_id=source.id
      where source.id=${sourceId}::dialektik_ulid and source.origin='LIVE_REAL'
    `.execute(this.database);
    return result.rows[0] ?? null;
  }

  private makePolicy(row: CorporateSourceRow, channelOverride?: 'rss_atom'): LiveSourcePolicy {
    const policy: LiveSourcePolicy = {
      sourceId: parseUlid(row.sourceId),
      registryKey: `corporate-${row.registryKey}`,
      publisherName: row.sourceName,
      canonicalDomain: row.canonicalDomain,
      sourceType: row.sourceType as SourceType,
      publisherFamily: row.publisherFamily,
      category: row.category,
      discoveryChannel: channelOverride ?? (row.discoveryChannel === 'news_sitemap'
        ? 'news_sitemap'
        : row.discoveryChannel === 'youtube_data_api_v3'
          ? 'official_api'
          : 'rss_atom'),
      endpoint: row.endpoint,
      rightsClass: 'LIVE_READY',
      storagePolicy: 'METADATA_AND_FEED_EXCERPT',
      active: row.policyActive,
      rightsEvidenceUrl: row.rightsEvidenceUrl,
      rightsReviewStatus: row.rightsReviewStatus,
      authorizationReference: row.authorizationReference,
      rightsVerifiedAt: row.validFrom.toISOString(),
      attribution: row.attribution,
      language: row.language,
      allowedArticleDomains: row.allowedArticleDomains,
    };
    assertLiveSourceReady(policy);
    if (
      !row.policyActive ||
      row.rightsClass !== 'LIVE_READY' ||
      row.storagePolicy !== 'METADATA_AND_FEED_EXCERPT' ||
      row.rightsReviewStatus !== 'APPROVED' ||
      row.authorizationReference === null || row.authorizationReference.trim().length === 0 ||
      row.policyEndpoint !== row.endpoint
    )
      throw new Error('CORPORATE_SOURCE_POLICY_CHANGED');
    return policy;
  }

  private async assertCurrentAuthorization(
    transaction: Transaction<Database>,
    row: CorporateSourceRow,
  ): Promise<void> {
    await sql`select source_id from public.prospective_content_rights_write_guards
      where source_id=${row.sourceId}::dialektik_ulid for update`.execute(transaction);
    const allowed = await sql<{ allowed: boolean }>`
      select exists(
        select 1 from public.corporate_live_source_connections connection
        join lateral(select current_connection.* from public.corporate_live_source_connections current_connection
          where current_connection.source_id=connection.source_id
          order by current_connection.sequence_number desc limit 1) latest_connection
          on latest_connection.id=connection.id and latest_connection.active
        join public.personal_owner_source_rights_decisions decision
          on decision.id=connection.rights_decision_id and decision.source_id=connection.source_id
        join lateral(select latest_decision.* from public.personal_owner_source_rights_decisions latest_decision
          where latest_decision.source_id=decision.source_id and latest_decision.owner_identity=${CORPORATE_EDITOR_OWNER}
          order by latest_decision.sequence_number desc limit 1) current_decision
          on current_decision.id=decision.id
        join lateral(select policy.* from public.live_source_policies policy
          where policy.source_id=connection.source_id order by policy.recorded_at desc,policy.id desc limit 1) policy
          on policy.active and policy.rights_class='LIVE_READY'
            and policy.storage_policy='METADATA_AND_FEED_EXCERPT'
            and policy.policy->>'rightsReviewStatus'='APPROVED'
            and nullif(policy.policy->>'authorizationReference','') is not null
            and policy.policy->>'endpoint'=connection.endpoint
        where connection.id=${row.connectionId}::dialektik_ulid
          and decision.id=${row.decisionId}::dialektik_ulid
          and decision.decision_status='AUTHORIZED' and decision.local_processing
          and decision.valid_from<=clock_timestamp()
          and (decision.expires_at is null or decision.expires_at>clock_timestamp())
          and decision.scopes->>'acquisition'='true'
          and decision.scopes->>'metadata_storage'='true'
          and decision.scopes->>'excerpt_storage'='true'
          and decision.scopes->>'fulltext_acquisition'='false'
          and decision.scopes->>'fulltext_persistence'='false'
      ) as allowed
    `.execute(transaction);
    if (allowed.rows[0]?.allowed !== true)
      throw new Error('CORPORATE_SOURCE_RIGHTS_NOT_AUTHORIZED');
  }

  private async persistPayload(
    row: CorporateSourceRow,
    policy: LiveSourcePolicy,
    payload: string,
    discoveredAt: Date,
    discoveryUrl: string,
  ) {
    return syncLivePayload(this.database, this.config, policy, payload, {
      discoveredAt,
      discoveryUrl,
      corporateProductionAuthorization: true,
      authorizePersistence: (transaction) => this.assertCurrentAuthorization(transaction, row),
    });
  }

  private async backfillElMostrador(row: CorporateSourceRow): Promise<number> {
    const policy = this.makePolicy(row, 'rss_atom');
    let totalPersisted = 0;
    let attempted = 0;
    while (attempted < MAX_ELMOSTRADOR_BACKFILL) {
      const candidates = await sql<BackfillArticle>`
        with latest as (
          select distinct on (version.article_id) version.article_id,version.headline,version.author,
            version.published_at,version.excerpt
          from public.live_article_versions version
          order by version.article_id,version.version_number desc
        )
        select article.id::text as "articleId",article.url_canonical as "canonicalUrl",
          latest.headline,latest.author,latest.published_at as "publishedAt",
          encode(extensions.digest(convert_to(article.text_original,'UTF8'),'sha256'),'hex') as "inputSha256"
        from public.articles article
        join public.sources source on source.id=article.source_id and source.canonical_domain='elmostrador.cl'
        join latest on latest.article_id=article.id
        where article.source_id=${row.sourceId}::dialektik_ulid and article.origin='LIVE_REAL'
          and (article.published_at at time zone 'America/Santiago')::date between date '2026-10-29' and date '2026-10-30'
          and (latest.excerpt is null or btrim(latest.excerpt)='')
          and not exists(select 1 from public.corporate_live_metadata_backfill_attempts attempt
            where attempt.source_id=article.source_id and attempt.article_id=article.id
              and attempt.input_sha256=encode(extensions.digest(convert_to(article.text_original,'UTF8'),'sha256'),'hex')
              and attempt.retry_after>clock_timestamp())
        order by article.published_at desc,article.id
        limit ${MAX_BACKFILL_BATCH}
      `.execute(this.database);
      if (candidates.rows.length === 0) break;
      attempted += candidates.rows.length;
      const described = await mapWithConcurrency(candidates.rows, MAX_BACKFILL_CONCURRENCY, async (article) => {
        try {
          await this.database.transaction().execute((transaction) => this.assertCurrentAuthorization(transaction, row));
          const excerpt = await fetchMetaDescription(article.canonicalUrl, row.allowedArticleDomains);
          return { article, excerpt, error: false };
        } catch {
          return { article, excerpt: null, error: true };
        }
      });
      const available = described.flatMap((value) =>
        value.excerpt === null ? [] : [{ ...value.article, excerpt: value.excerpt }],
      );
      if (available.length > 0) {
        const summary = await this.persistPayload(
          row,
          policy,
          boundedArticleXml(available),
          new Date(),
          row.endpoint,
        );
        if (summary.failedSources > 0 || summary.failedItems > 0)
          throw new Error('CORPORATE_METADATA_BACKFILL_PERSISTENCE_FAILED');
        totalPersisted += summary.updatedArticles + summary.newArticles;
      }
      const recordedAt = new Date().toISOString();
      for (const value of described) {
        if (value.excerpt !== null && available.length > 0) {
          await sql`insert into public.corporate_live_metadata_backfill_attempts
            (source_id,article_id,input_sha256,outcome,attempted_at,retry_after)
            values (${row.sourceId}::dialektik_ulid,${value.article.articleId}::dialektik_ulid,
              ${value.article.inputSha256},'EXCERPT_FOUND',${recordedAt}::timestamptz,
              ${new Date(Date.now()+30*86400000).toISOString()}::timestamptz)
            on conflict do nothing`.execute(this.database);
        } else if (value.excerpt === null) {
          await sql`insert into public.corporate_live_metadata_backfill_attempts
            (source_id,article_id,input_sha256,outcome,attempted_at,retry_after)
            values (${row.sourceId}::dialektik_ulid,${value.article.articleId}::dialektik_ulid,
              ${value.article.inputSha256},${value.error ? 'FETCH_BLOCKED' : 'NO_PUBLIC_DESCRIPTION'},
              ${recordedAt}::timestamptz,${new Date(Date.now()+86400000).toISOString()}::timestamptz)
            on conflict do nothing`.execute(this.database);
        }
      }
    }
    return totalPersisted;
  }

  private async pollOneDueSource(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    let sourceId: string | null = null;
    try {
      sourceId = await this.claimDueSource();
      if (sourceId === null) return;
      const row = await this.loadSource(sourceId);
      if (!row) {
        await this.recordSkip(sourceId, 'CONNECTION_OR_RIGHTS_MISSING');
        return;
      }
      const now = new Date();
      if (
        row.decisionId.length === 0 ||
        row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime() ||
        row.validFrom.getTime() > now.getTime() ||
        row.rightsEvidenceUrl.length === 0 ||
        row.scopes.acquisition !== true ||
        row.scopes.metadata_storage !== true ||
        row.scopes.excerpt_storage !== true
      ) {
        await this.recordSkip(sourceId, 'SOURCE_RIGHTS_NOT_AUTHORIZED');
        return;
      }
      if (row.discoveryChannel === 'youtube_data_api_v3' && !process.env.YOUTUBE_API_KEY?.trim()) {
        await this.recordSkip(sourceId, 'YOUTUBE_API_KEY_MISSING');
        return;
      }

      let backfilled = 0;
      if (row.canonicalDomain === 'elmostrador.cl') backfilled = await this.backfillElMostrador(row);
      const policy = this.makePolicy(row);
      let feed: CorporateFeedResponse;
      let discoveryUrl = row.endpoint;
      if (row.discoveryChannel === 'youtube_data_api_v3') {
        const youtube = await fetchYouTubeDataApiItems(
          {
            sourceId: row.sourceId,
            channelUrl: row.channelUrl ?? 'https://www.youtube.com/',
            feedEndpoint: row.endpoint,
            publisherName: row.sourceName,
          },
          process.env.YOUTUBE_API_KEY!.trim(),
        );
        feed = {
          status: 200,
          content: youtubeDataApiRssPayload(youtube, row.sourceName),
          etag: null,
          lastModified: null,
        };
        discoveryUrl = youtube.apiEndpoint;
      } else {
        feed = await readCorporateFeed(row.endpoint, row.etag, row.lastModified);
      }
      if (feed.status === 304) {
        await this.recordSuccess(row, feed, backfilled, 'NOT_MODIFIED');
        return;
      }
      if (feed.content === null) throw new Error('PUBLISHER_FEED_EMPTY');
      const summary = await this.persistPayload(row, policy, feed.content, new Date(), discoveryUrl);
      await this.recordSuccess(row, feed, backfilled, summary.failedSources > 0 || summary.failedItems > 0
        ? 'PARTIAL_SUCCESS'
        : 'SUCCEEDED');
    } catch (error) {
      if (sourceId !== null) await this.recordFailure(sourceId, error);
      else await this.recordClaimFailure(error);
    } finally {
      this.inFlight = false;
    }
  }

  private async recordClaimFailure(error: unknown): Promise<void> {
    const { sqlState } = postgresDiagnostic(error);
    const status = `CLAIM_FAILED_${sqlState ?? 'UNKNOWN'}`;
    try {
      await sql`update public.corporate_live_source_poll_state state
        set last_status=${status},last_polled_at=clock_timestamp(),
          next_poll_at=clock_timestamp()+interval '60 seconds',lease_until=null,updated_at=clock_timestamp()
        where state.source_id=(select pending.source_id from public.corporate_live_source_poll_state pending
          order by pending.next_poll_at,pending.source_id limit 1)`.execute(this.database);
    } catch {
      process.stderr.write(`${JSON.stringify({ event: 'corporate_live_acquisition_claim_failed', sqlState })}\n`);
    }
  }

  private async recordSkip(sourceId: string, reason: string): Promise<void> {
    const delayedSeconds = reason === 'YOUTUBE_API_KEY_MISSING' ? 86_400 : 3_600;
    await sql`update public.corporate_live_source_poll_state
      set last_status=${reason},last_polled_at=clock_timestamp(),
          next_poll_at=clock_timestamp()+(${delayedSeconds}::text||' seconds')::interval,
          lease_until=null,updated_at=clock_timestamp()
      where source_id=${sourceId}::dialektik_ulid`.execute(this.database);
  }

  private async recordSuccess(
    row: CorporateSourceRow,
    feed: CorporateFeedResponse,
    backfilled: number,
    status: string,
  ): Promise<void> {
    const interval = row.canonicalDomain === 'elmostrador.cl' && backfilled > 0
      ? 30
      : row.discoveryChannel === 'youtube_data_api_v3'
        ? 86_400
        : 900;
    await sql`update public.corporate_live_source_poll_state
      set etag=${feed.etag},last_modified=${feed.lastModified},poll_interval_seconds=${interval},
          consecutive_failures=0,last_http_status=${feed.status},last_status=${status},
          last_polled_at=clock_timestamp(),last_success_at=clock_timestamp(),
          next_poll_at=clock_timestamp()+(${interval}::text||' seconds')::interval,
          lease_until=null,updated_at=clock_timestamp()
      where source_id=${row.sourceId}::dialektik_ulid`.execute(this.database);
  }

  private async recordFailure(sourceId: string, error: unknown): Promise<void> {
    const diagnostic = postgresDiagnostic(error);
    const resource = safeDatabaseErrorResource(error);
    const message = error instanceof YouTubeDataApiError ? error.code :
      error instanceof Error && /^[A-Z0-9_]{1,64}$/u.test(error.message) ? error.message :
      diagnostic.driverCode !== null
        ? `DB_${diagnostic.driverCode.toUpperCase().replace(/[^A-Z0-9_-]/gu, '_')}${resource === null ? '' : `_${resource}`}`
        : diagnostic.errorType !== null
          ? `ERROR_${diagnostic.errorType.replace(/[^A-Z0-9_]/gu, '_').toUpperCase()}`
          : 'CORPORATE_ACQUISITION_FAILED';
    await sql`update public.corporate_live_source_poll_state
      set consecutive_failures=least(consecutive_failures+1,12),
          poll_interval_seconds=least(poll_interval_seconds*2,2592000),
          last_http_status=${typeof error === 'object' && error !== null && 'status' in error
            ? Number(error.status) || null : null},
          last_status=${message},last_polled_at=clock_timestamp(),
          next_poll_at=clock_timestamp()+least(poll_interval_seconds*2,2592000)*interval '1 second',
          lease_until=null,updated_at=clock_timestamp()
      where source_id=${sourceId}::dialektik_ulid`.execute(this.database);
  }
}
