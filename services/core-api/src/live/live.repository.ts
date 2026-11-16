import type { Database, Ulid } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import { sourceProfilesAvailable } from '../public-api/source-profiles.js';
import { CHILE_PUBLISHER_DOMAINS, isCatalogMarket, publisherDomainsForMarket, UK_BETA_SOURCE_IDS, type PublisherMarket } from './live.publisher-market.js';

function publisherIdentityFilter(market: PublisherMarket, sourceColumn: string) {
  return market === 'UK'
    ? sql`${sql.ref(sourceColumn)} in (${sql.join(UK_BETA_SOURCE_IDS.map((id) => sql`${id}`))})`
    : sql`true`;
}

export interface LiveReadRow {
  id: Ulid;
  event_id: Ulid | null;
  country_code?: string | null;
  media_group_slug?: string | null;
  editorial_lean?: string | null;
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
  country_code?: string | null;
  media_group_slug?: string | null;
  editorial_lean?: string | null;
}

/** Directory records, never license, operational readiness or publisher approval. */
export interface LiveRegisteredSourceRow {
  id: Ulid;
  name: string;
  canonical_domain: string;
  source_type: string;
  staged_record_count: number;
}

export const LIVE_NEWS_TOPIC_PATTERNS = {
  politica: 'polític|politic|gobierno|presidente|ministro|congreso|diputad|senador|elecci|alcald|partido republican',
  justicia: 'justicia|judicial|tribunal|corte|juez|jueza|fiscal|condena|acusación constitucional|acusacion constitucional|querella',
  economia: 'econom|inflación|inflacion|empleo|desempleo|pensión|pension|afp|banco|peso|dólar|dolar|codelco|empresa|salario|sueldo',
  seguridad: 'seguridad|delito|polic|carabinero|crimen|robo|asalto|homicid|detenido|balacera|siniestro',
  deportes: 'deporte|fútbol|futbol|tenis|partido|campeonato|selección|seleccion|liga|gol|jugador|atleta',
  sociedad: 'sociedad|salud|educación|educacion|colegio|escuela|vivienda|familia|niñez|ninez|cultura|mujer|medio ambiente',
} as const;
export type LiveNewsTopic = keyof typeof LIVE_NEWS_TOPIC_PATTERNS;

export interface LiveNewsQuery {
  readonly cursor?: Ulid;
  readonly limit: number;
  readonly q?: string;
  readonly sourceId?: Ulid;
  readonly publishedFrom?: Date;
  readonly publishedTo?: Date;
  readonly market?: PublisherMarket;
  readonly format?: 'press' | 'videos';
  readonly topic?: LiveNewsTopic;
  readonly sourceScope?: 'following' | 'outside';
  readonly followedSourceIds?: readonly string[];
}

export class LiveRepository {
  constructor(private readonly database: Kysely<Database>) {}

  /** Whether migration 087 is applied (see SourceProfilesMonitor). */
  profilesReady(): boolean {
    return sourceProfilesAvailable();
  }

  /**
   * Publisher-market scope of a source. With profiles, the catalog country
   * decides (Chilean sources without a profile keep their domain mapping);
   * without them only the original domain mapping applies. null: no rows.
   */
  marketScope(market: PublisherMarket, sourceColumn: string, domainColumn: string) {
    // Internal column names only; rendered unquoted like the original filter.
    const source = sql.raw(sourceColumn);
    const domain = sql.raw(domainColumn);
    const chile = sql`${domain} in (${sql.join(CHILE_PUBLISHER_DOMAINS.map((value) => sql`${value}`))})`;
    if (isCatalogMarket(market) && this.profilesReady()) {
      return sql`(exists(select 1 from media_source_profiles market_profile
          where market_profile.source_id = ${source} and market_profile.country_code = ${market})
        or (${market === 'CL'} and ${chile} and not exists(select 1 from media_source_profiles market_profile
          where market_profile.source_id = ${source})))`;
    }
    const domains = publisherDomainsForMarket(market);
    if (domains.length === 0) return null;
    return sql`${domain} in (${sql.join(domains.map((value) => sql`${value}`))}) and ${publisherIdentityFilter(market, sourceColumn)}`;
  }

  /** Country, media group and lean columns for a source column. */
  profileColumns(sourceColumn: string) {
    const source = sql.ref(sourceColumn);
    if (!this.profilesReady())
      return sql`null::text as country_code, null::text as media_group_slug, null::text as editorial_lean`;
    return sql`(select country_code from media_source_profiles where source_id = ${source}) as country_code,
      (select media_group_slug from media_source_profiles where source_id = ${source}) as media_group_slug,
      (select editorial_lean from media_source_profiles where source_id = ${source}) as editorial_lean`;
  }

  /**
   * Receipt aggregates scan every sighting of an article, so they are only
   * computed for the rows of the page being returned, never for the whole
   * market before sorting (13 s for Chile on the free database).
   */
  private receiptColumns(rowAlias: string) {
    const exposure = sql.raw(`${rowAlias}.exposure_id`);
    return sql`(select max(seen_at) from live_acquisition_receipts where exclusion_id = ${exposure}) as last_seen_at,
      (select count(id)::int from live_acquisition_receipts where exclusion_id = ${exposure}) as receipt_count`;
  }

  private newsProjection() {
    return sql`select a.id, a.event_id, v.headline,
      case when p.storage_policy = 'METADATA_AND_FEED_EXCERPT' then v.excerpt else null end as excerpt,
      v.author, v.published_at, v.modified_at,
      coalesce(r.canonical_url, a.url_canonical) as canonical_url, v.declared_upstream,
      v.version_number as version_count, s.id as source_id, s.name as source_name,
      s.source_type, s.canonical_domain, p.policy,
      e.first_seen_at,
      r.original_published_at, r.original_modified_at, r.source_item_id,
      coalesce(r.discovery_channel_detail, r.discovery_channel) as discovery_channel,
      r.discovery_url, r.adapter_version, a.live_exposure_id as exposure_id
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
        -- LIVE_READY is not proof of lawful reuse. Require an independent,
        -- explicitly reviewed source-specific authorization record.
        and p.policy->>'rightsReviewStatus' = 'APPROVED'
        and nullif(p.policy->>'authorizationReference', '') is not null
        and nullif(p.policy->>'rightsEvidenceUrl', '') is not null
        and nullif(p.policy->>'endpoint', '') is not null
        and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
        and p.policy->>'endpoint' <> 'https://supabase.com'
      join live_exposure_exclusions e on e.id = a.live_exposure_id
      where a.origin = 'LIVE_REAL'
        -- Use the latest explicit quarantine decision. Later source policy
        -- versions that omit this field do not accidentally reverse a review.
        and coalesce((select case
          when jsonb_typeof(q.policy->'quarantinedArticleIds') = 'array'
          then not (q.policy->'quarantinedArticleIds' @> jsonb_build_array(a.id::text))
          else false end
          from live_source_policies q where q.source_id = a.source_id
            and q.policy ? 'quarantinedArticleIds'
          order by q.recorded_at desc, q.id desc limit 1), true)`;
  }

  async list(query: LiveNewsQuery): Promise<LiveReadRow[]> {
    const market = query.market ?? 'CL';
    const scope = this.marketScope(market, 'news.source_id', 'news.canonical_domain');
    if (scope === null) return [];
    const cursor =
      query.cursor === undefined
        ? sql`true`
        : sql`(published_at, id) <
      (select published_at, id from news where id = ${query.cursor})`;
    const result = await sql<LiveReadRow>`with news as (${this.newsProjection()}), page as (select news.* from news
      where ${cursor}
        and ${scope}
        and ${query.sourceScope === undefined ? sql`true` : query.sourceScope === 'following' ? sql`source_id::text = any(${query.followedSourceIds ?? []}::text[])` : sql`not (source_id::text = any(${query.followedSourceIds ?? []}::text[]))`}
        and ${query.format === undefined ? sql`true` : query.format === 'videos' ? sql`canonical_domain = 'youtube.com'` : sql`canonical_domain <> 'youtube.com'`}
        and ${query.topic === undefined ? sql`true` : sql`(headline || ' ' || coalesce(excerpt, '')) ~* ${LIVE_NEWS_TOPIC_PATTERNS[query.topic]}`}
        and ${query.q === undefined ? sql`true` : sql`position(lower(${query.q}) in lower(headline || ' ' || coalesce(excerpt, ''))) > 0`}
        and ${query.sourceId === undefined ? sql`true` : sql`source_id = ${query.sourceId}`}
        and ${query.publishedFrom === undefined ? sql`true` : sql`published_at >= ${query.publishedFrom}`}
        and ${query.publishedTo === undefined ? sql`true` : sql`published_at < ${query.publishedTo}`}
      order by published_at desc, id desc limit ${query.limit + 1})
      select page.*, ${this.receiptColumns('page')}, ${this.profileColumns('page.source_id')} from page
      order by published_at desc, id desc`.execute(this.database);
    return result.rows;
  }

  async article(id: Ulid, market: PublisherMarket = 'CL'): Promise<LiveReadRow | undefined> {
    const scope = this.marketScope(market, 'news.source_id', 'news.canonical_domain');
    if (scope === null) return undefined;
    const profile = this.profileColumns('news.source_id');
    const result =
      await sql<LiveReadRow>`with news as (${this.newsProjection()}) select news.*, ${this.receiptColumns('news')}, ${profile} from news
        where id = ${id} and ${scope}`.execute(
        this.database,
      );
    return result.rows[0];
  }

  /**
   * Separate beta-only directory: the registry alone does not license,
   * authenticate or approve any Article or Source. Never join source policies.
   * Country scope is applied before selecting rows, and no article titles,
   * body, hyperlinks or unreviewed rights policy are returned.
   */
  async registeredSources(market: PublisherMarket): Promise<LiveRegisteredSourceRow[]> {
    const scope = this.marketScope(market, 's.id', 's.canonical_domain');
    if (scope === null) return [];
    const result = await sql<LiveRegisteredSourceRow>`
      select s.id, s.name, s.canonical_domain, s.source_type,
        (select count(*)::integer from articles article_row
         where article_row.source_id = s.id
           and article_row.origin = 'LIVE_REAL') as staged_record_count
      from sources s
      where s.origin = 'LIVE_REAL'
        and ${scope}
      order by s.name, s.id
      limit 200
    `.execute(this.database);
    return result.rows;
  }

  async sources(id?: Ulid, market: PublisherMarket = 'CL'): Promise<LiveSourceReadRow[]> {
    const scope = this.marketScope(market, 's.id', 's.canonical_domain');
    if (scope === null) return [];
    const profile = this.profileColumns('s.id');
    const result =
      await sql<LiveSourceReadRow>`select s.id, s.name, s.source_type, s.canonical_domain, p.policy, ${profile}
      from sources s join live_source_policies p on p.source_id = s.id and p.id =
        (select id from live_source_policies where source_id = s.id order by recorded_at desc, id desc limit 1)
      where s.origin = 'LIVE_REAL' and p.active = true and p.rights_class = 'LIVE_READY'
        and p.policy->>'rightsReviewStatus' = 'APPROVED'
        and nullif(p.policy->>'authorizationReference', '') is not null
        and nullif(p.policy->>'rightsEvidenceUrl', '') is not null
        and nullif(p.policy->>'endpoint', '') is not null
        and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
        and p.policy->>'endpoint' <> 'https://supabase.com'
        and ${scope}
        and ${id === undefined ? sql`true` : sql`s.id = ${id}`}
      order by s.name, s.id`.execute(this.database);
    return result.rows;
  }
}
