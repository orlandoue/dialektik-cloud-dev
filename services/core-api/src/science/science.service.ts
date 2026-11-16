import { createDatabase, destroyDatabase, scienceCommentsSql } from '@dialektik/database';
import {
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import { PublicApiService } from '../public-api/public-api.service.js';
import {
  isLiteralFragment, resolveStudy, resolverOptionsFromEnv, type FetchLike, type ResolvedStudy, type ScienceSource,
} from './study-resolver.js';
import { ScienceDuplicateError } from './science-http.error.js';

/** Same rule as the app: 2-30 letters, digits, spaces or `._-`. */
export function sanitizeAlias(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/gu, ' ').trim().replace(/^[ ._-]+/u, '');
  const clipped = cleaned.length > 30 ? cleaned.slice(0, 30).trimEnd() : cleaned;
  return clipped.length >= 2 ? clipped : null;
}

/** The reader's public name from the profile; the client cannot choose it. */
export function profileAlias(row: { alias: string | null; display_name: string | null; reader_number: number | null } | undefined): string {
  return sanitizeAlias(row?.alias) ?? sanitizeAlias(row?.display_name)
    ?? (row?.reader_number == null ? 'Lector' : `Lector-${row.reader_number}`);
}

export type StudyFilter = 'conectados' | 'chile' | 'temas' | 'recientes';
export type StudyRelation = 'respalda' | 'contradice' | 'matiza' | 'contexto';

export interface StudyJson {
  doi: string;
  title: string;
  review: 'peer_reviewed' | 'preprint';
  authors: string | null;
  institution: string | null;
  journal: string | null;
  published_at: string | null;
  design: string | null;
  population: string | null;
  sample_size: number | null;
  follow_up: string | null;
  funding: string | null;
  conflicts: string | null;
  access: string | null;
  corrections: string | null;
  retracted: boolean;
  retracted_at: string | null;
  abstract: string | null;
  abstract_language: string | null;
  made_in_chile: boolean;
  connected_stories: number;
  citing_comments: number;
}

export interface CommentJson {
  id: string;
  author: string;
  body: string;
  created_at: Date;
  parent_id: string | null;
  status: 'published' | 'in_review' | 'rejected';
  reactions: number;
  reacted: boolean;
  mine: boolean;
  attachment: {
    study: StudyJson;
    claim_quote_id: string;
    claim_text: string;
    claim_outlet: string;
    claim_speaker: null;
    relation: StudyRelation;
    abstract_fragment: string;
  } | null;
}

export interface StudyModeration {
  design?: string | null;
  population?: string | null;
  sample_size?: number | null;
  follow_up?: string | null;
  funding?: string | null;
  conflicts?: string | null;
  access?: string | null;
  corrections?: string | null;
  made_in_chile?: boolean;
}

/** Comments with a study need an account at least this old. */
export const MINIMUM_ACCOUNT_AGE_DAYS = 3;
/** Cached studies are re-resolved after this, so a retraction is picked up. */
const REFRESH_AFTER_DAYS = 7;
const MISSING_STORAGE = new Set(['42P01', '42883']);

/** A typed refusal the app can act on (`code` survives the safe filter). */
function refused(status: HttpStatus, code: string): HttpException {
  return new HttpException({ code }, status);
}

type StudyRow = Omit<StudyJson, 'published_at' | 'retracted_at'> & { published_at: string | Date | null; retracted_at: string | Date | null };

const day = (value: string | Date | null): string | null =>
  value === null ? null : (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

function studyJson(row: StudyRow): StudyJson {
  return {
    doi: row.doi,
    title: row.title,
    review: row.review,
    authors: row.authors,
    institution: row.institution,
    journal: row.journal,
    published_at: day(row.published_at),
    design: row.design,
    population: row.population,
    sample_size: row.sample_size,
    follow_up: row.follow_up,
    funding: row.funding,
    conflicts: row.conflicts,
    access: row.access,
    corrections: row.corrections,
    retracted: row.retracted,
    retracted_at: day(row.retracted_at),
    abstract: row.abstract,
    abstract_language: row.abstract_language,
    made_in_chile: row.made_in_chile,
    connected_stories: Number(row.connected_stories ?? 0),
    citing_comments: Number(row.citing_comments ?? 0),
  };
}

const STUDY_COLUMNS = sql.raw(`s.doi, s.title, s.review, s.authors, s.institution, s.journal, s.published_at,
  s.design, s.population, s.sample_size, s.follow_up, s.funding, s.conflicts, s.access, s.corrections,
  s.retracted, s.retracted_at, s.abstract, s.abstract_language, s.made_in_chile,
  (select count(distinct a.event_id)::int from public.story_comment_studies a
     join public.story_comments c on c.id = a.comment_id and c.status = 'published' where a.doi = s.doi) as connected_stories,
  (select count(*)::int from public.story_comment_studies a
     join public.story_comments c on c.id = a.comment_id and c.status = 'published' where a.doi = s.doi) as citing_comments`);

@Injectable()
export class ScienceService implements OnModuleInit {
  readonly #logger = new Logger(ScienceService.name);
  #ready = false;

  /** Replaced in tests; production resolves through the network. */
  fetcher: FetchLike = fetch as unknown as FetchLike;

  constructor(
    @Inject(CoreDatabaseService) private readonly db: CoreDatabaseService,
    @Inject(PublicApiService) private readonly publicApi: PublicApiService,
  ) {}

  /** Accounts allowed to moderate, from DIALEKTIK_SCIENCE_MODERATORS. */
  isModerator(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.DIALEKTIK_SCIENCE_MODERATORS ?? '')
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id !== '')
      .includes(userId.toLowerCase());
  }

  /**
   * Remote flag for Science and story comments: off unless
   * DIALEKTIK_SCIENCE_ENABLED is «true», always on for moderators so they can
   * try it before anyone else sees it.
   */
  access(userId: string, env: NodeJS.ProcessEnv = process.env): { enabled: boolean; moderator: boolean } {
    const moderator = this.isModerator(userId, env);
    return { enabled: moderator || env.DIALEKTIK_SCIENCE_ENABLED?.trim().toLowerCase() === 'true', moderator };
  }

  /** Without the flag the routes do not exist for this reader. */
  requireAccess(userId: string): void {
    if (!this.access(userId).enabled) throw new NotFoundException({ code: 'PUBLIC_NOT_FOUND' });
  }

  async onModuleInit(): Promise<void> {
    if (!process.env.OPENALEX_API_KEY?.trim()) {
      this.#logger.warn('OPENALEX_API_KEY is not set: OpenAlex allows only a minimal daily budget without a key.');
    }
    if (!resolverOptionsFromEnv().contactEmail) {
      this.#logger.warn('SCIENCE_CONTACT_EMAIL is not set: Crossref requests stay out of the polite pool.');
    }
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => { timer = setTimeout(resolve, 20_000); });
    try {
      await Promise.race([this.ensureStorage(), limit]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Creates the tables when the role may; otherwise 503 until 091 is applied. */
  async ensureStorage(): Promise<void> {
    const bootstrapUrl = process.env.SOCIAL_ARENA_BOOTSTRAP_DATABASE_URL?.trim();
    const dedicated = bootstrapUrl
      ? createDatabase({
          connectionString: bootstrapUrl,
          applicationName: 'dialektik-science-bootstrap',
          maxConnections: 1,
          ...(process.env.DATABASE_CA_CERT?.trim() ? { caCertificate: process.env.DATABASE_CA_CERT } : {}),
        })
      : undefined;
    const database = (dedicated ?? this.db.database) as Kysely<unknown>;
    try {
      if (await this.#present(database)) {
        this.#ready = true;
        return;
      }
      await database.transaction().setAccessMode('read write').execute(async (tx) => {
        await sql`set local lock_timeout = '10s'`.execute(tx);
        await sql`select pg_advisory_xact_lock(910091)`.execute(tx);
        await sql.raw(scienceCommentsSql).execute(tx);
      });
      this.#ready = true;
      this.#logger.log('Science storage created at startup.');
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      this.#logger.warn(`Science storage unavailable (SQLSTATE ${typeof code === 'string' ? code : 'unknown'}); apply migration 091.`);
    } finally {
      if (dedicated) await destroyDatabase(dedicated).catch(() => undefined);
    }
  }

  async #present(database: Kysely<unknown>): Promise<boolean> {
    const present = await sql<{ ready: boolean }>`select to_regclass('public.science_studies') is not null
      and to_regclass('public.story_comments') is not null and to_regclass('public.story_comment_studies') is not null
      and to_regclass('public.story_comment_reactions') is not null and to_regclass('public.science_api_usage') is not null
      and to_regprocedure('public.dialektik_reader_profile(uuid)') is not null as ready`.execute(database);
    return present.rows[0]?.ready === true;
  }

  get ready(): boolean {
    return this.#ready;
  }

  async #guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (typeof code === 'string' && MISSING_STORAGE.has(code)) {
        throw new ServiceUnavailableException('Science storage is not available yet.');
      }
      throw error;
    }
  }

  #transaction<T>(userId: string, work: (tx: Transaction<unknown>) => Promise<T>, moderator = false): Promise<T> {
    return this.#guarded(() => this.db.database.transaction().setAccessMode('read write').execute(async (tx) => {
      await sql`select set_config('dialektik.social_user', ${userId}, true)`.execute(tx);
      if (moderator) await sql`select set_config('dialektik.science_moderator', 'on', true)`.execute(tx);
      return work(tx as Transaction<unknown>);
    }));
  }

  // ---- Studies -------------------------------------------------------------

  async listStudies(filter: StudyFilter): Promise<{ studies: StudyJson[] }> {
    return this.#guarded(async () => {
      const where = {
        conectados: sql`exists (select 1 from public.story_comment_studies a join public.story_comments c
          on c.id = a.comment_id and c.status = 'published' where a.doi = s.doi)`,
        chile: sql`s.made_in_chile`,
        // Studies connected to stories published in the last 30 days.
        temas: sql`exists (select 1 from public.story_comment_studies a
          join public.story_comments c on c.id = a.comment_id and c.status = 'published'
          join public.public_events e on e.id = a.event_id and e.analysis_state = 'PUBLISHED'
          where a.doi = s.doi and e.detected_at > now() - interval '30 days')`,
        recientes: sql`true`,
      }[filter];
      const rows = await sql<StudyRow>`select ${STUDY_COLUMNS} from public.science_studies s
        where ${where} order by s.published_at desc nulls last, s.doi limit 50`.execute(this.db.database);
      return { studies: rows.rows.map(studyJson) };
    });
  }

  /** Cached study, resolved from Crossref and OpenAlex when missing or stale. */
  async study(doi: string): Promise<StudyJson> {
    return this.#guarded(async () => {
      const cached = await this.#readStudy(this.db.database as Kysely<unknown>, doi);
      const fresh = cached !== null && (await sql<{ fresh: boolean }>`select resolved_at > now() - make_interval(days => ${REFRESH_AFTER_DAYS}) as fresh
        from public.science_studies where doi = ${doi}`.execute(this.db.database)).rows[0]?.fresh === true;
      if (cached !== null && fresh) return cached;
      const resolved = await resolveStudy(doi, this.fetcher, { ...resolverOptionsFromEnv(), onCall: (source, ok) => this.recordCall(source, ok) });
      await this.flushUsage();
      if (resolved === null) {
        if (cached !== null) return cached;
        throw new NotFoundException('DOI not found.');
      }
      await this.#store(resolved);
      return (await this.#readStudy(this.db.database as Kysely<unknown>, doi))!;
    });
  }

  async #readStudy(database: Kysely<unknown>, doi: string): Promise<StudyJson | null> {
    const rows = await sql<StudyRow>`select ${STUDY_COLUMNS} from public.science_studies s where s.doi = ${doi}`.execute(database);
    return rows.rows[0] ? studyJson(rows.rows[0]) : null;
  }

  /** Bibliographic fields only; moderator fields are never overwritten. */
  async #store(s: ResolvedStudy): Promise<void> {
    await sql`insert into public.science_studies(doi,title,review,authors,institution,journal,published_at,abstract,
        abstract_language,access,retracted,retracted_at,made_in_chile,resolved_at)
      values (${s.doi},${s.title},${s.review},${s.authors},${s.institution},${s.journal},${s.published_at}::date,${s.abstract},
        ${s.abstract_language},${s.access},${s.retracted},${s.retracted_at}::date,${s.made_in_chile},now())
      on conflict (doi) do update set title=excluded.title, review=excluded.review, authors=excluded.authors,
        institution=excluded.institution, journal=excluded.journal, published_at=excluded.published_at,
        abstract=excluded.abstract, abstract_language=excluded.abstract_language,
        access=coalesce(public.science_studies.access, excluded.access),
        retracted=excluded.retracted or public.science_studies.retracted,
        retracted_at=coalesce(excluded.retracted_at, public.science_studies.retracted_at),
        made_in_chile=public.science_studies.made_in_chile or excluded.made_in_chile,
        resolved_at=now()`.execute(this.db.database);
  }

  // ---- Comments ------------------------------------------------------------

  async #comments(database: Kysely<unknown>, userId: string, filter: ReturnType<typeof sql>): Promise<CommentJson[]> {
    const rows = await sql<{
      id: string; author: string; body: string; created_at: Date; parent_id: string | null;
      status: CommentJson['status']; reactions: number; reacted: boolean; mine: boolean;
      claim_quote_id: string | null; claim_text: string | null; claim_outlet: string | null;
      relation: StudyRelation | null; abstract_fragment: string | null; study: StudyRow | null;
    }>`
      select c.id::text as id, c.author_alias as author, c.body, c.created_at, c.parent_id::text as parent_id, c.status,
        (select count(*)::int from public.story_comment_reactions r where r.comment_id = c.id) as reactions,
        exists (select 1 from public.story_comment_reactions r where r.comment_id = c.id and r.user_id = ${userId}::uuid) as reacted,
        (c.user_id = ${userId}::uuid) as mine,
        a.claim_quote_id::text as claim_quote_id, a.claim_text, a.claim_outlet, a.relation, a.abstract_fragment,
        case when a.doi is null then null else (select to_jsonb(x) from (select ${STUDY_COLUMNS}
          from public.science_studies s where s.doi = a.doi) x) end as study
      from public.story_comments c
      left join public.story_comment_studies a on a.comment_id = c.id
      where ${filter}
        -- Published comments for everyone; one's own also while in review.
        and (c.status = 'published' or (c.status = 'in_review' and c.user_id = ${userId}::uuid))
      order by c.created_at desc, c.id desc limit 300`.execute(database);
    return rows.rows.map((row) => ({
      id: row.id,
      author: row.author,
      body: row.body,
      created_at: row.created_at,
      parent_id: row.parent_id,
      status: row.status,
      reactions: row.reactions,
      reacted: row.reacted,
      mine: row.mine,
      attachment: row.study === null || row.claim_quote_id === null ? null : {
        study: studyJson(row.study),
        claim_quote_id: row.claim_quote_id,
        claim_text: row.claim_text ?? '',
        claim_outlet: row.claim_outlet ?? '',
        claim_speaker: null,
        relation: row.relation ?? 'contexto',
        abstract_fragment: row.abstract_fragment ?? '',
      },
    }));
  }

  async #requirePublished(database: Kysely<unknown>, eventId: string): Promise<void> {
    const event = await sql`select 1 from public.public_events where id = ${eventId}::dialektik_ulid and analysis_state = 'PUBLISHED'`.execute(database);
    if (!event.rows.length) throw new NotFoundException('Published event not found.');
  }

  async storyComments(userId: string, eventId: string): Promise<{ comments: CommentJson[] }> {
    return this.#guarded(async () => {
      await this.#requirePublished(this.db.database as Kysely<unknown>, eventId);
      return { comments: await this.#comments(this.db.database as Kysely<unknown>, userId, sql`c.event_id = ${eventId}::dialektik_ulid`) };
    });
  }

  async #comment(database: Kysely<unknown>, userId: string, id: string): Promise<CommentJson> {
    const rows = await this.#comments(database, userId, sql`c.id = ${id}::uuid`);
    if (!rows[0]) throw new NotFoundException('Comment not found.');
    return rows[0];
  }

  /** Published at once; one level of replies. */
  async #authorAlias(database: Kysely<unknown>, userId: string): Promise<string> {
    const rows = await sql<{ alias: string | null; display_name: string | null; reader_number: number | null }>`
      select alias, display_name, reader_number from public.dialektik_reader_profile(${userId}::uuid)`.execute(database);
    return profileAlias(rows.rows[0]);
  }

  async addComment(userId: string, eventId: string, input: { body: string; parentId: string | null }): Promise<CommentJson> {
    return this.#transaction(userId, async (tx) => {
      await this.#requirePublished(tx, eventId);
      if (input.parentId !== null) {
        const parent = await sql`select 1 from public.story_comments where id = ${input.parentId}::uuid
          and event_id = ${eventId}::dialektik_ulid and parent_id is null and status = 'published'`.execute(tx);
        if (!parent.rows.length) throw refused(HttpStatus.BAD_REQUEST, 'PUBLIC_SCIENCE_INVALID_PARENT');
      }
      const inserted = await sql<{ id: string }>`insert into public.story_comments(event_id,user_id,parent_id,kind,status,author_alias,body)
        values (${eventId}::dialektik_ulid, ${userId}::uuid, ${input.parentId}::uuid, 'normal', 'published',
          ${await this.#authorAlias(tx, userId)}, ${input.body})
        returning id::text as id`.execute(tx);
      return this.#comment(tx, userId, inserted.rows[0]!.id);
    });
  }

  /**
   * A comment with a study: literal claim of the story, relation, literal
   * abstract fragment. Refused for a retracted study, a duplicate (same DOI
   * and claim in this story), a non-literal fragment or a new account.
   * Starts in review.
   */
  async addStudyComment(userId: string, eventId: string, input: {
    doi: string; claimQuoteId: string; relation: StudyRelation; abstractFragment: string; body: string;
  }): Promise<CommentJson> {
    await this.#guarded(async () => {
      const created = await sql<{ created_at: Date | null }>`select public.dialektik_account_created_at(${userId}::uuid) as created_at`
        .execute(this.db.database);
      const createdAt = created.rows[0]?.created_at;
      if (!createdAt || Date.now() - new Date(createdAt).getTime() < MINIMUM_ACCOUNT_AGE_DAYS * 86_400_000) {
        throw new ForbiddenException({ code: 'PUBLIC_SCIENCE_ACCOUNT_TOO_NEW' });
      }
    });
    const study = await this.study(input.doi);
    if (study.retracted) throw new GoneException({ code: 'PUBLIC_SCIENCE_RETRACTED' });
    if (!isLiteralFragment(input.abstractFragment, study.abstract)) {
      throw refused(HttpStatus.UNPROCESSABLE_ENTITY, 'PUBLIC_SCIENCE_NOT_LITERAL');
    }
    // The claim must be one of the literal quotes the app shows for the story.
    const detail = await this.publicApi.event(eventId, true);
    const positions = (detail.body as unknown as { positions?: { assertions?: { id: string; quoted_text: string; source_name: string }[] }[] }).positions ?? [];
    const claim = positions.flatMap((p) => p.assertions ?? []).find((a) => a.id === input.claimQuoteId && a.quoted_text.trim() !== '');
    if (claim === undefined) throw refused(HttpStatus.BAD_REQUEST, 'PUBLIC_SCIENCE_INVALID_CLAIM');

    return this.#transaction(userId, async (tx) => {
      // Serialises concurrent attempts on the same study and claim.
      await sql`select pg_advisory_xact_lock(hashtext(${`science:${eventId}:${study.doi}:${claim.id}`}))`.execute(tx);
      const duplicate = await sql<{ id: string; status: string }>`select c.id::text as id, c.status
        from public.story_comment_studies a join public.story_comments c on c.id = a.comment_id
        where a.event_id = ${eventId}::dialektik_ulid and a.doi = ${study.doi} and a.claim_quote_id = ${claim.id}::dialektik_ulid
          and c.status <> 'rejected'
        order by (c.status = 'published') desc, c.created_at limit 1`.execute(tx);
      if (duplicate.rows[0]) throw new ScienceDuplicateError(duplicate.rows[0]);
      const inserted = await sql<{ id: string }>`insert into public.story_comments(event_id,user_id,kind,status,author_alias,body)
        values (${eventId}::dialektik_ulid, ${userId}::uuid, 'study', 'in_review',
          ${await this.#authorAlias(tx, userId)}, ${input.body})
        returning id::text as id`.execute(tx);
      const id = inserted.rows[0]!.id;
      await sql`insert into public.story_comment_studies(comment_id,event_id,doi,claim_quote_id,claim_text,claim_outlet,relation,abstract_fragment)
        values (${id}::uuid, ${eventId}::dialektik_ulid, ${study.doi}, ${claim.id}::dialektik_ulid, ${claim.quoted_text.trim()},
          ${claim.source_name.replace(/\s*\(YouTube\)\s*$/iu, '').trim()}, ${input.relation}, ${input.abstractFragment.trim()})`.execute(tx);
      return this.#comment(tx, userId, id);
    });
  }

  /** «Útil» / «Pertinente»; false withdraws it. */
  async react(userId: string, commentId: string, reacted: boolean): Promise<CommentJson> {
    return this.#transaction(userId, async (tx) => {
      const visible = await sql`select 1 from public.story_comments c join public.public_events e on e.id = c.event_id
        and e.analysis_state = 'PUBLISHED' where c.id = ${commentId}::uuid and c.status = 'published'`.execute(tx);
      if (!visible.rows.length) throw new NotFoundException('Comment not found.');
      if (reacted) {
        await sql`insert into public.story_comment_reactions(comment_id,user_id) values (${commentId}::uuid, ${userId}::uuid)
          on conflict do nothing`.execute(tx);
      } else {
        await sql`delete from public.story_comment_reactions where comment_id = ${commentId}::uuid and user_id = ${userId}::uuid`.execute(tx);
      }
      return this.#comment(tx, userId, commentId);
    });
  }

  async commentsCitingStudy(userId: string, doi: string): Promise<{ comments: CommentJson[] }> {
    return this.#guarded(async () => ({
      comments: await this.#comments(this.db.database as Kysely<unknown>, userId,
        sql`exists (select 1 from public.story_comment_studies x where x.comment_id = c.id and x.doi = ${doi})`),
    }));
  }

  // ---- Usage of the metadata APIs -----------------------------------------

  #usageDay = '';
  #usageToday = new Map<ScienceSource, { calls: number; errors: number }>();

  /** Counts one call per source and day; logs the totals once a day ends. */
  recordCall(source: ScienceSource, ok: boolean, now: Date = new Date()): void {
    const today = now.toISOString().slice(0, 10);
    if (this.#usageDay !== today) {
      if (this.#usageDay !== '' && this.#usageToday.size > 0) {
        const totals = [...this.#usageToday].map(([s, u]) => `${s} ${u.calls} calls (${u.errors} errors)`).join(', ');
        this.#logger.log(`Science API usage ${this.#usageDay}: ${totals}.`);
      }
      this.#usageDay = today;
      this.#usageToday = new Map();
    }
    const counter = this.#usageToday.get(source) ?? { calls: 0, errors: 0 };
    counter.calls += 1;
    if (!ok) counter.errors += 1;
    this.#usageToday.set(source, counter);
    const write = sql`insert into public.science_api_usage(source, day, calls, errors) values (${source}, ${today}::date, 1, ${ok ? 0 : 1})
      on conflict (source, day) do update set calls = public.science_api_usage.calls + 1,
        errors = public.science_api_usage.errors + excluded.errors`.execute(this.db.database)
      .catch(() => this.#logger.warn('Could not record science API usage.'));
    this.#pendingUsage.push(write);
  }

  #pendingUsage: Promise<unknown>[] = [];

  /** Waits for the usage rows of the calls made so far. */
  async flushUsage(): Promise<void> {
    await Promise.allSettled(this.#pendingUsage.splice(0));
  }

  async usage(userId: string): Promise<{ days: { source: string; day: string; calls: number; errors: number }[] }> {
    this.#requireModerator(userId);
    return this.#guarded(async () => {
      const rows = await sql<{ source: string; day: string; calls: number; errors: number }>`select source, day::text as day, calls, errors
        from public.science_api_usage where day > current_date - 30 order by day desc, source`.execute(this.db.database);
      return { days: rows.rows };
    });
  }

  // ---- Moderation ----------------------------------------------------------

  #requireModerator(userId: string): void {
    if (!this.isModerator(userId)) throw new ForbiddenException({ code: 'PUBLIC_FORBIDDEN' });
  }

  async moderationQueue(userId: string): Promise<{ comments: (CommentJson & { event_id: string })[] }> {
    this.#requireModerator(userId);
    return this.#guarded(async () => {
      const rows = await sql<{ id: string; event_id: string }>`select id::text as id, event_id::text as event_id from public.story_comments
        where status = 'in_review' order by created_at limit 100`.execute(this.db.database);
      const comments: (CommentJson & { event_id: string })[] = [];
      for (const row of rows.rows) {
        const listed = await this.#reviewRow(row.id, userId);
        if (listed) comments.push({ ...listed, event_id: row.event_id });
      }
      return { comments };
    });
  }

  /** In-review rows of other readers, for the moderator only. */
  async #reviewRow(id: string, userId: string): Promise<CommentJson | undefined> {
    const rows = await sql<{ owner: string }>`select user_id::text as owner from public.story_comments where id = ${id}::uuid`.execute(this.db.database);
    const owner = rows.rows[0]?.owner;
    if (owner === undefined) return undefined;
    const listed = await this.#comments(this.db.database as Kysely<unknown>, owner, sql`c.id = ${id}::uuid`);
    return listed[0] ? { ...listed[0], mine: owner === userId } : undefined;
  }

  async decide(userId: string, commentId: string, approve: boolean): Promise<{ id: string; status: string }> {
    this.#requireModerator(userId);
    return this.#transaction(userId, async (tx) => {
      const updated = await sql<{ status: string }>`update public.story_comments
        set status = ${approve ? 'published' : 'rejected'}, reviewed_at = now()
        where id = ${commentId}::uuid and status = 'in_review' returning status`.execute(tx);
      if (!updated.rows.length) throw new NotFoundException('Comment in review not found.');
      return { id: commentId, status: updated.rows[0]!.status };
    }, true);
  }

  /** Fields only a moderator completes; null clears one back to «No informado». */
  async moderateStudy(userId: string, doi: string, fields: StudyModeration): Promise<StudyJson> {
    this.#requireModerator(userId);
    await this.study(doi);
    const has = (key: keyof StudyModeration) => Object.hasOwn(fields, key);
    await this.#guarded(() => sql`update public.science_studies set
        design = case when ${has('design')} then ${fields.design ?? null}::text else design end,
        population = case when ${has('population')} then ${fields.population ?? null}::text else population end,
        sample_size = case when ${has('sample_size')} then ${fields.sample_size ?? null}::int else sample_size end,
        follow_up = case when ${has('follow_up')} then ${fields.follow_up ?? null}::text else follow_up end,
        funding = case when ${has('funding')} then ${fields.funding ?? null}::text else funding end,
        conflicts = case when ${has('conflicts')} then ${fields.conflicts ?? null}::text else conflicts end,
        access = case when ${has('access')} then ${fields.access ?? null}::text else access end,
        corrections = case when ${has('corrections')} then ${fields.corrections ?? null}::text else corrections end,
        made_in_chile = case when ${has('made_in_chile')} then ${fields.made_in_chile ?? false} else made_in_chile end,
        moderated_at = now()
      where doi = ${doi}`.execute(this.db.database));
    return (await this.#readStudy(this.db.database as Kysely<unknown>, doi))!;
  }
}
