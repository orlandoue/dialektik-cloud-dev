import type { Database, Ulid } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import { publisherDomainsForMarket, type PublisherMarket } from './live.publisher-market.js';

export interface LiveReadRow {
  id: Ulid;
  headline: string;
  excerpt: string | null;
  author: string | null;
  published_at: Date;
  modified_at: Date | null;
  canonical_url: string;
  declared_upstream: string | null;
  version_count: number;
  source_id: Ulid;
  source_name: string;
  source_type: string;
  canonical_domain: string;
  policy: Record<string, unknown>;
  first_seen_at: Date;
  last_seen_at: Date;
  original_published_at: string | null;
  original_modified_at: string | null;
  source_item_id: string | null;
  discovery_channel: string;
  discovery_url: string;
  adapter_version: string;
  receipt_count: number;
}

export interface LiveSourceReadRow {
  id: Ulid;
  name: string;
  source_type: string;
  canonical_domain: string;
  policy: Record<string, unknown>;
}

export interface LiveNewsQuery {
  readonly cursor?: Ulid;
  readonly limit: number;
  readonly q?: string;
  readonly sourceId?: Ulid;
  readonly publishedFrom?: Date;
  readonly publishedTo?: Date;
  readonly market?: PublisherMarket;
}

export class LiveRepository {
  constructor(private readonly database: Kysely<Database>) {}

  private newsProjection() {
    return sql`select a.id, v.headline, v.excerpt, v.author, v.published_at, v.modified_at,
      coalesce(r.canonical_url, a.url_canonical) as canonical_url, v.declared_upstream,
      v.version_number as version_count, s.id as source_id, s.name as source_name,
      s.source_type, s.canonical_domain, p.policy,
      e.first_seen_at,
      (select max(seen_at) from live_acquisition_receipts where exclusion_id = a.live_exposure_id) as last_seen_at,
      r.original_published_at, r.original_modified_at, r.source_item_id,
      r.discovery_channel, r.discovery_url, r.adapter_version,
      (select count(id)::int from live_acquisition_receipts where exclusion_id = a.live_exposure_id) as receipt_count
      from articles a join sources s on s.id = a.source_id
      join live_article_versions v on v.article_id = a.id and v.version_number =
        (select max(version_number) from live_article_versions where article_id = a.id)
      join live_acquisition_receipts r on r.id =
        (select id from live_acquisition_receipts where exclusion_id = a.live_exposure_id
          and disposition = 'PERSISTED' order by seen_at desc, id desc limit 1)
      join live_source_policies p on p.source_id = a.source_id and p.id =
        (select id from live_source_policies where source_id = a.source_id
          order by recorded_at desc, id desc limit 1)
        and p.active = true and p.rights_class = 'LIVE_READY'
      join live_exposure_exclusions e on e.id = a.live_exposure_id
      where a.origin = 'LIVE_REAL' and a.event_id is null`;
  }

  async list(query: LiveNewsQuery): Promise<LiveReadRow[]> {
    const domains = publisherDomainsForMarket(query.market ?? 'CL');
    if (domains.length === 0) return [];
    const marketFilter = sql.join(domains.map((domain) => sql`${domain}`));
    const cursor =
      query.cursor === undefined
        ? sql`true`
        : sql`(published_at, id) <
      (select published_at, id from news where id = ${query.cursor})`;
    const result = await sql<LiveReadRow>`with news as (${this.newsProjection()}) select * from news
      where ${cursor}
        and canonical_domain in (${marketFilter})
        and ${query.q === undefined ? sql`true` : sql`position(lower(${query.q}) in lower(headline || ' ' || coalesce(excerpt, ''))) > 0`}
        and ${query.sourceId === undefined ? sql`true` : sql`source_id = ${query.sourceId}`}
        and ${query.publishedFrom === undefined ? sql`true` : sql`published_at >= ${query.publishedFrom}`}
        and ${query.publishedTo === undefined ? sql`true` : sql`published_at < ${query.publishedTo}`}
      order by published_at desc, id desc limit ${query.limit + 1}`.execute(this.database);
    return result.rows;
  }

  async article(id: Ulid, market: PublisherMarket = 'CL'): Promise<LiveReadRow | undefined> {
    const domains = publisherDomainsForMarket(market);
    if (domains.length === 0) return undefined;
    const marketFilter = sql.join(domains.map((domain) => sql`${domain}`));
    const result =
      await sql<LiveReadRow>`with news as (${this.newsProjection()}) select * from news
        where id = ${id} and canonical_domain in (${marketFilter})`.execute(
        this.database,
      );
    return result.rows[0];
  }

  async sources(id?: Ulid, market: PublisherMarket = 'CL'): Promise<LiveSourceReadRow[]> {
    const domains = publisherDomainsForMarket(market);
    if (domains.length === 0) return [];
    const marketFilter = sql.join(domains.map((domain) => sql`${domain}`));
    const result =
      await sql<LiveSourceReadRow>`select s.id, s.name, s.source_type, s.canonical_domain, p.policy
      from sources s join live_source_policies p on p.source_id = s.id and p.id =
        (select id from live_source_policies where source_id = s.id order by recorded_at desc, id desc limit 1)
      where s.origin = 'LIVE_REAL' and p.active = true and p.rights_class = 'LIVE_READY'
        and s.canonical_domain in (${marketFilter})
        and ${id === undefined ? sql`true` : sql`s.id = ${id}`}
      order by s.name, s.id`.execute(this.database);
    return result.rows;
  }
}
