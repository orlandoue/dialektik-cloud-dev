import type { Database, Ulid } from '@dialektik/database';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { sourceProfilesAvailable } from '../public-api/source-profiles.js';
import { CHILE_PUBLISHER_DOMAINS, isCatalogMarket, publisherDomainsForMarket, UK_BETA_SOURCE_IDS, type PublisherMarket } from './live.publisher-market.js';
import { liveSightingsAvailable } from './live-sightings.js';

function publisherIdentityFilter(market: PublisherMarket, sourceColumn: string) {
  return market === 'UK'
    ? sql`${sql.ref(sourceColumn)} in (${sql.join(UK_BETA_SOURCE_IDS.map((id) => sql`${id}`))})`
    : sql`true`;
}

export interface LiveReadRow {
  id: Ulid;
  event_id: Ulid | null;
  /** The article's event, only once that event is published. */
  published_event_id?: Ulid | null;
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

/** Recent versions read per candidate wanted (most are of other markets). */
const LIVE_SCAN_PER_CANDIDATE = 16;

/**
 * A source policy that allows showing items. LIVE_READY is not proof of
 * lawful reuse: an independent, explicitly reviewed source-specific
 * authorization record is required too.
 */
function approvedPolicy(alias: string) {
  const p = sql.raw(alias);
  return sql`${p}.active = true and ${p}.rights_class = 'LIVE_READY'
        and ${p}.policy->>'rightsReviewStatus' = 'APPROVED'
        and nullif(${p}.policy->>'authorizationReference', '') is not null
        and nullif(${p}.policy->>'rightsEvidenceUrl', '') is not null
        and nullif(${p}.policy->>'endpoint', '') is not null
        and ${p}.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
        and ${p}.policy->>'endpoint' <> 'https://supabase.com'`;
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
    // Unchanged repeats are hourly sightings (migration 099), not receipts.
    const lastSeen = liveSightingsAvailable()
      ? sql`greatest((select max(seen_at) from live_acquisition_receipts where exclusion_id = ${exposure}),
          (select last_seen_at from live_item_sightings where exclusion_id = ${exposure}))`
      : sql`(select max(seen_at) from live_acquisition_receipts where exclusion_id = ${exposure})`;
    return sql`${lastSeen} as last_seen_at,
      (select count(id)::int from live_acquisition_receipts where exclusion_id = ${exposure}) as receipt_count`;
  }

  private newsProjection(candidates: RawBuilder<unknown> = sql`true`) {
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
        and ${approvedPolicy('p')}
      -- One primary-key lookup per article. As a plain join the planner,
      -- misled by the correlated version/receipt/policy conditions above,
      -- expects one article and scans this whole table once per article
      -- (27 MB × thousands of articles: the 10 s Chilean feed). offset 0
      -- keeps the subquery from being flattened back into that join.
      join lateral (select exclusion.first_seen_at from live_exposure_exclusions exclusion
        where exclusion.id = a.live_exposure_id offset 0) e on true
      where a.origin = 'LIVE_REAL' and ${candidates}
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

  /**
   * The full projection costs several index lookups per article in the
   * large receipt and exclusion tables (on disk on the free database); run
   * over every live article it took 6-15 s. So one statement first picks
   * the newest candidates from articles, their latest version and their
   * source alone, with filters that can only keep too many rows, never too
   * few, and projects only those. When the stricter conditions leave the
   * page short and more candidates exist, the window grows until the result
   * equals projecting every article.
   */
  async list(query: LiveNewsQuery): Promise<LiveReadRow[]> {
    const market = query.market ?? 'CL';
    const wanted = query.limit + 1;
    // A text search or one source keeps few of the newest versions, so its
    // walk is not bounded: bounded, it would only take more rounds. A
    // common list tries one bounded walk; when that walk was not enough
    // (a market with few of the newest items, such as Spanish videos) it
    // goes straight to the full read instead of widening the walk.
    const selective = query.q !== undefined || query.topic !== undefined || query.sourceId !== undefined;
    let window = wanted * 4;
    if (!selective) {
      const scan = window * LIVE_SCAN_PER_CANDIDATE;
      const walked = await this.#page(query, market, window, scan);
      if (walked === null) return [];
      if (walked.rows.length >= wanted) return walked.rows;
      // Neither limit cut anything: fewer candidates than the window,
      // taken from fewer recent versions than the scan.
      if (walked.candidates < window && walked.scanned < scan) return walked.rows;
      // A full window that still left the page short needs a wider one.
      if (walked.candidates >= window) window *= 4;
    }
    for (; ; window *= 4) {
      const result = await this.#page(query, market, window, null);
      if (result === null) return [];
      if (result.rows.length >= wanted || result.candidates < window) return result.rows;
    }
  }

  async #page(query: LiveNewsQuery, market: PublisherMarket, window: number, scan: number | null):
    Promise<{ rows: LiveReadRow[]; candidates: number; scanned: number } | null> {
    const scope = this.marketScope(market, 'news.source_id', 'news.canonical_domain');
    const candidateScope = this.marketScope(market, 's.id', 's.canonical_domain');
    if (scope === null || candidateScope === null) return null;
    const following = (column: string) => query.sourceScope === undefined ? sql`true`
      : query.sourceScope === 'following' ? sql`${sql.raw(column)}::text = any(${query.followedSourceIds ?? []}::text[])`
        : sql`not (${sql.raw(column)}::text = any(${query.followedSourceIds ?? []}::text[]))`;
    const format = (domain: string) => query.format === undefined ? sql`true`
      : query.format === 'videos' ? sql`${sql.raw(domain)} = 'youtube.com'` : sql`${sql.raw(domain)} <> 'youtube.com'`;
    // Candidates match headline and excerpt before the storage policy hides
    // the excerpt: matching more text can only add candidates.
    const candidateText = sql`(v.headline || ' ' || coalesce(v.excerpt, ''))`;
    const candidateCursor = query.cursor === undefined ? sql`true` : sql`(v.published_at, v.article_id) <
      (select cursor_version.published_at, cursor_article.id from articles cursor_article
        join live_article_versions cursor_version on cursor_version.article_id = cursor_article.id
          and cursor_version.version_number = (select max(version_number) from live_article_versions where article_id = cursor_article.id)
        where cursor_article.id = ${query.cursor})`;
    // A cursor outside the projection ends the listing, as before.
    const cursor =
      query.cursor === undefined
        ? sql`true`
        : sql`(published_at, id) <
      (select cursor_news.published_at, cursor_news.id from (${this.newsProjection(sql`a.id = ${query.cursor}`)}) cursor_news)`;
    const filters = sql`true
          and ${candidateScope}
          and ${following('a.source_id')}
          and ${format('s.canonical_domain')}
          and ${query.topic === undefined ? sql`true` : sql`${candidateText} ~* ${LIVE_NEWS_TOPIC_PATTERNS[query.topic]}`}
          and ${query.q === undefined ? sql`true` : sql`position(lower(${query.q}) in lower(${candidateText})) > 0`}
          and ${query.sourceId === undefined ? sql`true` : sql`a.source_id = ${query.sourceId}`}`;
    // Walk (common lists): the newest versions first, bounded by `scan`.
    // Full (searches, one source): every article, as such filters keep few
    // of the newest versions and a bounded walk would only add rounds.
    const candidateSql = scan !== null ? sql`-- The newest versions first, read along live_versions_by_published
      -- (migration 100) instead of finding the latest version of every
      -- live article: the planner cannot see that the filters below keep
      -- enough of the newest rows, so the walk is bounded explicitly and
      -- widened by list() when it was not enough.
      recent as materialized (
        select v.article_id, v.version_number, v.published_at, v.headline, v.excerpt from live_article_versions v
        where ${candidateCursor}
          and ${query.publishedFrom === undefined ? sql`true` : sql`v.published_at >= ${query.publishedFrom}`}
          and ${query.publishedTo === undefined ? sql`true` : sql`v.published_at < ${query.publishedTo}`}
        order by v.published_at desc, v.article_id desc limit ${scan}),
      -- Primary-key lookups per recent version, in this order: as plain
      -- joins the planner, misjudging how few sources are approved, scanned
      -- the whole walk once per article. offset 0 keeps them as lookups.
      candidates as materialized (
        select a.id from recent v
        cross join lateral (select article.id, article.source_id, article.origin, article.live_exposure_id
          from articles article where article.id = v.article_id offset 0) a
        cross join lateral (select source.id, source.canonical_domain
          from sources source where source.id = a.source_id offset 0) s
        where v.version_number = (select max(version_number) from live_article_versions where article_id = v.article_id)
          and a.origin = 'LIVE_REAL' and a.live_exposure_id is not null
          and exists (select 1 from approved_sources where approved_sources.source_id = a.source_id)
          and ${filters}
        order by v.published_at desc, v.article_id desc limit ${window}),` : sql`recent as materialized (select null::text as article_id where false),
      candidates as materialized (
        select a.id from articles a
        join sources s on s.id = a.source_id
        join live_article_versions v on v.article_id = a.id
          and v.version_number = (select max(version_number) from live_article_versions where article_id = a.id)
        where a.origin = 'LIVE_REAL' and a.live_exposure_id is not null
          and exists (select 1 from approved_sources where approved_sources.source_id = a.source_id)
          and ${candidateCursor}
          and ${filters}
          and ${query.publishedFrom === undefined ? sql`true` : sql`v.published_at >= ${query.publishedFrom}`}
          and ${query.publishedTo === undefined ? sql`true` : sql`v.published_at < ${query.publishedTo}`}
        order by v.published_at desc, v.article_id desc limit ${window}),`;
    // Sources whose latest policy allows showing their items: the same
    // per-source condition as the projection, so applying it to candidates
    // drops nothing the projection keeps. Without it, a page of a market
    // whose newest items come from unapproved channels widened the window
    // (×4 each time) and re-scanned the whole table.
    const result = await sql<LiveReadRow & { candidate_count: number; scanned_count: number }>`with approved_sources as materialized (
        select p.source_id from live_source_policies p
        where p.id = (select id from live_source_policies where source_id = p.source_id
            order by recorded_at desc, id desc limit 1)
          and ${approvedPolicy('p')}),
      ${candidateSql}
      news as (${this.newsProjection(sql`a.id in (select candidates.id from candidates)`)}), page as (select news.* from news
      where ${cursor}
        and ${scope}
        and ${following('source_id')}
        and ${format('canonical_domain')}
        and ${query.topic === undefined ? sql`true` : sql`(headline || ' ' || coalesce(excerpt, '')) ~* ${LIVE_NEWS_TOPIC_PATTERNS[query.topic]}`}
        and ${query.q === undefined ? sql`true` : sql`position(lower(${query.q}) in lower(headline || ' ' || coalesce(excerpt, ''))) > 0`}
        and ${query.sourceId === undefined ? sql`true` : sql`source_id = ${query.sourceId}`}
        and ${query.publishedFrom === undefined ? sql`true` : sql`published_at >= ${query.publishedFrom}`}
        and ${query.publishedTo === undefined ? sql`true` : sql`published_at < ${query.publishedTo}`}
      order by published_at desc, id desc limit ${query.limit + 1})
      select page.*, ${this.receiptColumns('page')}, ${this.profileColumns('page.source_id')},
        (select pe.id from public.public_events pe where pe.id = page.event_id
          and pe.analysis_state = 'PUBLISHED' limit 1) as published_event_id,
        meta.candidate_count, meta.scanned_count
      from (select (select count(*)::int from candidates) as candidate_count,
        (select count(*)::int from recent) as scanned_count) meta left join page on true
      order by page.published_at desc, page.id desc`.execute(this.database);
    // The one-row meta keeps the candidate count when the page is empty.
    const candidates = Number(result.rows[0]?.candidate_count ?? 0);
    const scanned = Number(result.rows[0]?.scanned_count ?? 0);
    const rows = result.rows.filter((row) => row.id !== null && row.id !== undefined)
      .map(({ candidate_count: _count, scanned_count: _scanned, ...row }) => row as LiveReadRow);
    return { rows, candidates, scanned };
  }

  async article(id: Ulid, market: PublisherMarket = 'CL'): Promise<LiveReadRow | undefined> {
    const scope = this.marketScope(market, 'news.source_id', 'news.canonical_domain');
    if (scope === null) return undefined;
    const profile = this.profileColumns('news.source_id');
    const result =
      await sql<LiveReadRow>`with news as (${this.newsProjection(sql`a.id = ${id}`)}) select news.*, ${this.receiptColumns('news')}, ${profile} from news
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
