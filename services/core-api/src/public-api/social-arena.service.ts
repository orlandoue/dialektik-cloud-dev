import { createDatabase, destroyDatabase, socialArenaSql } from '@dialektik/database';
import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { profileAlias, ScienceService } from '../science/science.service.js';

export type CommunityChannel = 'DEBATE' | 'APORTE' | 'NOTA';

export interface PositionVotes {
  total: number;
  mine: string | null;
  positions: { position_id: string; votes: number }[];
}

export interface CommunityEntry {
  id: string;
  channel: 'debate' | 'aporte' | 'nota';
  author: string;
  body: string;
  article_id: string | null;
  url: string | null;
  created_at: Date;
  upvotes: number;
  downvotes: number;
  my_vote: 1 | -1 | null;
  mine: boolean;
  /** The version (position) it is about; null: the case as a whole. */
  position_id: string | null;
  stance: CommunityStance | null;
  /** Only the author sees an entry «in_review». */
  status: 'published' | 'in_review';
}

export type CommunityStance = 'supports' | 'contradicts' | 'context';

export interface NewCommunityEntry {
  channel: CommunityChannel;
  body: string;
  alias: string | null;
  articleId: string | null;
  linkUrl: string | null;
  positionId?: string | null;
  stance?: CommunityStance | null;
}

export interface ReviewEntry {
  id: string;
  event_id: string;
  event_title: string;
  channel: 'aporte' | 'nota';
  author: string;
  body: string;
  url: string | null;
  position_title: string | null;
  stance: CommunityStance | null;
  created_at: Date;
}

/** Link contributions an account publishes before they skip review. */
export const REVIEWED_BEFORE_TRUST = 3;
/** Link contributions per account and 24 h. */
export const LINK_ENTRIES_PER_DAY = 3;
/** Accounts younger than this are left out of the public vote split. */
export const SPLIT_ACCOUNT_MIN_AGE_HOURS = 72;

// Migration 085 is applied out-of-band. Until then these endpoints answer 503
// and every earlier social endpoint keeps working unchanged.
const UNDEFINED_TABLE = '42P01';

export type ArenaStorageState = 'unknown' | 'ready' | 'created' | 'unavailable';

@Injectable()
export class SocialArenaService implements OnModuleInit {
  readonly #logger = new Logger(SocialArenaService.name);
  #storage: { state: ArenaStorageState; code: string | null } = { state: 'unknown', code: null };

  constructor(
    @Inject(CoreDatabaseService) private readonly db: CoreDatabaseService,
    @Optional() @Inject(ScienceService) private readonly science?: ScienceService,
  ) {}

  #review: { ready: boolean; at: number } = { ready: false, at: 0 };

  /** Whether migration 103 (stance, review, account age) is applied. */
  async #reviewReady(tx: Transaction<unknown>): Promise<boolean> {
    if (Date.now() - this.#review.at < 5 * 60_000) return this.#review.ready;
    const found = await sql<{ ready: boolean }>`select exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'social_community_entries' and column_name = 'status')
      and to_regprocedure('public.dialektik_account_created_at(uuid)') is not null as ready`.execute(tx);
    this.#review = { ready: found.rows[0]?.ready === true, at: Date.now() };
    return this.#review.ready;
  }

  /** Outcome of the startup storage check; `code` is a SQLSTATE, never SQL text. */
  get storage(): { state: ArenaStorageState; code: string | null } {
    return { ...this.#storage };
  }

  /** Re-checks for the tables, e.g. after the owner applied migration 085. */
  async currentStorage(): Promise<{ state: ArenaStorageState; code: string | null }> {
    if (this.#storage.state !== 'ready' && this.#storage.state !== 'created') {
      try {
        const present = await sql<{ ready: boolean }>`select to_regclass('public.social_position_votes') is not null
          and to_regclass('public.social_community_entries') is not null
          and to_regclass('public.social_entry_votes') is not null as ready`.execute(this.db.database);
        if (present.rows[0]?.ready === true) this.#storage = { state: 'ready', code: null };
      } catch {
        /* Keep the last known state. */
      }
    }
    return this.storage;
  }

  async onModuleInit(): Promise<void> {
    // Startup never waits on this for long: a slow database leaves the state
    // as it is and the endpoints keep answering from what exists.
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>(resolve => { timer = setTimeout(resolve, 20_000); });
    try {
      await Promise.race([this.ensureStorage(), limit]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Creates the Arena tables when they are missing. It never blocks startup:
   * a role without DDL privileges leaves the endpoints answering 503 until
   * the owner applies migration 085. SOCIAL_ARENA_BOOTSTRAP_DATABASE_URL may
   * name a connection that is allowed to create them.
   */
  async ensureStorage(): Promise<void> {
    const bootstrapUrl = process.env.SOCIAL_ARENA_BOOTSTRAP_DATABASE_URL?.trim();
    const dedicated = bootstrapUrl
      ? createDatabase({
          connectionString: bootstrapUrl,
          applicationName: 'dialektik-social-arena-bootstrap',
          maxConnections: 1,
          // Same certificate authority the Core connection verifies against.
          ...(process.env.DATABASE_CA_CERT?.trim() ? { caCertificate: process.env.DATABASE_CA_CERT } : {}),
        })
      : undefined;
    const database = (dedicated ?? this.db.database) as Kysely<unknown>;
    try {
      const present = await sql<{ ready: boolean }>`select to_regclass('public.social_position_votes') is not null
        and to_regclass('public.social_community_entries') is not null
        and to_regclass('public.social_entry_votes') is not null as ready`.execute(database);
      if (present.rows[0]?.ready === true) {
        this.#storage = { state: 'ready', code: null };
        return;
      }
      await database.transaction().setAccessMode('read write').execute(async tx => {
        await sql`set local lock_timeout = '10s'`.execute(tx);
        // Serialises concurrent instances starting at the same time.
        await sql`select pg_advisory_xact_lock(850085)`.execute(tx);
        await sql.raw(socialArenaSql).execute(tx);
      });
      this.#storage = { state: 'created', code: null };
      this.#logger.log('Arena social storage created at startup.');
    } catch (error) {
      const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code : null;
      this.#storage = { state: 'unavailable', code };
      this.#logger.warn(`Arena social storage is unavailable (SQLSTATE ${code ?? 'unknown'}); apply migration 085.`);
    } finally {
      if (dedicated) await destroyDatabase(dedicated).catch(() => undefined);
    }
  }

  async #guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === UNDEFINED_TABLE) {
        throw new ServiceUnavailableException('Community storage is not available yet.');
      }
      throw error;
    }
  }

  async #write<T>(userId: string, work: (tx: Transaction<unknown>) => Promise<T>): Promise<T> {
    return this.#guarded(() => this.db.database.transaction().setAccessMode('read write').execute(async tx => {
      await sql`select set_config('dialektik.social_user', ${userId}, true)`.execute(tx);
      return work(tx as Transaction<unknown>);
    }));
  }

  /** One vote per reader and case; null withdraws it. */
  async votePosition(userId: string, eventId: string, positionId: string | null): Promise<void> {
    await this.#write(userId, async tx => {
      const event = await sql`select 1 from public.public_events where id = ${eventId}::dialektik_ulid and analysis_state = 'PUBLISHED'`.execute(tx);
      if (!event.rows.length) throw new NotFoundException('Published event not found.');
      if (positionId === null) {
        await sql`delete from public.social_position_votes where event_id = ${eventId}::dialektik_ulid and user_id = ${userId}::uuid`.execute(tx);
        return;
      }
      const position = await sql`select 1 from public.positions p where p.id = ${positionId}::dialektik_ulid
        and p.event_id = ${eventId}::dialektik_ulid and p.publication_state::text = 'published'`.execute(tx);
      if (!position.rows.length) throw new NotFoundException('Published position of the event not found.');
      await sql`insert into public.social_position_votes(event_id,user_id,position_id)
        values (${eventId}::dialektik_ulid,${userId}::uuid,${positionId}::dialektik_ulid)
        on conflict (event_id,user_id) do update set position_id=excluded.position_id, updated_at=now()`.execute(tx);
    });
  }

  async positionVotes(userId: string, eventId: string): Promise<PositionVotes> {
    return this.#guarded(() => this.db.database.transaction().execute(async tx => {
      // An account younger than 72 h still votes, and sees its own vote,
      // but is not counted in the public split (a burst of new accounts).
      const counted = await this.#reviewReady(tx as Transaction<unknown>)
        ? sql`(v.user_id = ${userId}::uuid or public.dialektik_account_created_at(v.user_id)
            < now() - make_interval(hours => ${SPLIT_ACCOUNT_MIN_AGE_HOURS}))`
        : sql`true`;
      const rows = await sql<{ position_id: string; votes: number; mine: boolean }>`
        select v.position_id::text as position_id, (count(*) filter (where ${counted}))::int as votes,
          coalesce(bool_or(v.user_id = ${userId}::uuid), false) as mine
        from public.social_position_votes v
        join public.public_events e on e.id = v.event_id and e.analysis_state = 'PUBLISHED'
        join public.positions p on p.id = v.position_id and p.publication_state::text = 'published'
        where v.event_id = ${eventId}::dialektik_ulid
        group by v.position_id order by v.position_id`.execute(tx);
      return {
        total: rows.rows.reduce((sum, row) => sum + row.votes, 0),
        mine: rows.rows.find(row => row.mine)?.position_id ?? null,
        positions: rows.rows.map(row => ({ position_id: row.position_id, votes: row.votes })),
      };
    }));
  }

  /** The three channels of a case, earlier evidence comments included. */
  async community(userId: string, eventId: string): Promise<{ entries: CommunityEntry[] }> {
    return this.#guarded(() => this.db.database.transaction().execute(async tx => {
      const review = await this.#reviewReady(tx as Transaction<unknown>);
      // Entries in review or rejected are hidden; the author sees their own
      // entry in review.
      const extra = review
        ? sql`c.position_id::text as position_id, c.stance, c.status`
        : sql`null::text as position_id, null::text as stance, 'published'::text as status`;
      const visible = review
        ? sql`(c.status = 'published' or (c.status = 'in_review' and c.user_id = ${userId}::uuid))`
        : sql`true`;
      const rows = await sql<{
        id: string; channel: CommunityChannel; author: string; body: string; article_id: string | null;
        url: string | null; created_at: Date; upvotes: number; downvotes: number; my_vote: number | null; mine: boolean;
        position_id: string | null; stance: CommunityStance | null; status: 'published' | 'in_review';
      }>`
        with entries as (
          select c.id, c.event_id, c.user_id, c.channel, c.author_alias, c.body, c.article_id::text as article_id,
            coalesce(c.link_url, a.url_canonical) as url, c.created_at, ${extra}
          from public.social_community_entries c left join public.articles a on a.id = c.article_id
          where c.event_id = ${eventId}::dialektik_ulid and ${visible}
          union all
          select l.id, l.event_id, l.user_id, 'APORTE', 'Lector-' || upper(substr(md5(l.user_id::text), 1, 4)), l.body,
            l.article_id::text, a.url_canonical, l.created_at, null::text, null::text, 'published'::text
          from public.social_evidence_comments l join public.articles a on a.id = l.article_id
          where l.event_id = ${eventId}::dialektik_ulid
        )
        select n.id::text as id, n.channel, n.author_alias as author, n.body, n.article_id, n.url, n.created_at,
          n.position_id, n.stance, n.status,
          (n.user_id = ${userId}::uuid) as mine,
          (select count(*)::int from public.social_entry_votes v where v.entry_id = n.id and v.vote = 1) as upvotes,
          (select count(*)::int from public.social_entry_votes v where v.entry_id = n.id and v.vote = -1) as downvotes,
          (select v.vote::int from public.social_entry_votes v where v.entry_id = n.id and v.user_id = ${userId}::uuid) as my_vote
        from entries n join public.public_events e on e.id = n.event_id and e.analysis_state = 'PUBLISHED'
        order by n.created_at desc, n.id desc limit 150`.execute(tx);
      return {
        entries: rows.rows.map(row => ({
          id: row.id,
          channel: row.channel.toLowerCase() as CommunityEntry['channel'],
          author: row.author,
          body: row.body,
          article_id: row.article_id,
          url: row.url,
          created_at: row.created_at,
          upvotes: row.upvotes,
          downvotes: row.downvotes,
          my_vote: row.my_vote === 1 ? 1 : row.my_vote === -1 ? -1 : null,
          mine: row.mine,
          position_id: row.position_id,
          stance: row.stance,
          status: row.status === 'in_review' ? 'in_review' : 'published',
        })),
      };
    }));
  }

  /** The reader's chosen alias or «Lector-NNNN»; null where the profile function is missing. */
  async #authorAlias(tx: Transaction<unknown>, userId: string): Promise<string | null> {
    const available = await sql<{ ok: boolean }>`select to_regprocedure('public.dialektik_reader_profile(uuid)') is not null as ok`.execute(tx);
    if (!available.rows[0]?.ok) return null;
    const rows = await sql<{ alias: string | null; display_name: string | null; reader_number: number | null }>`
      select alias, display_name, reader_number from public.dialektik_reader_profile(${userId}::uuid)`.execute(tx);
    return rows.rows[0] === undefined ? null : profileAlias(rows.rows[0]);
  }

  async addEntry(userId: string, eventId: string, entry: NewCommunityEntry): Promise<void> {
    await this.#write(userId, async tx => {
      // The signature comes from the account, never from the client: the
      // alias the reader chose, else «Lector-NNNN». Older apps sent the
      // Google account's full name here; it is ignored wherever the profile
      // function exists (the client alias only remains for test schemas).
      const alias = (await this.#authorAlias(tx, userId)) ?? entry.alias;
      const review = await this.#reviewReady(tx);
      let status = 'published';
      if (review && entry.channel !== 'DEBATE') {
        const mine = await sql<{ today: number; trusted: number }>`select
            count(*) filter (where created_at > now() - interval '24 hours')::int as today,
            count(*) filter (where status = 'published')::int as trusted
          from public.social_community_entries
          where user_id = ${userId}::uuid and channel <> 'DEBATE'`.execute(tx);
        if ((mine.rows[0]?.today ?? 0) >= LINK_ENTRIES_PER_DAY) {
          throw new HttpException({ code: 'PUBLIC_ENTRY_DAILY_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
        }
        // The first link contributions of an account wait for a moderator.
        if ((mine.rows[0]?.trusted ?? 0) < REVIEWED_BEFORE_TRUST) status = 'in_review';
      }
      if (review && entry.positionId) {
        const position = await sql`select 1 from public.positions p where p.id = ${entry.positionId}::dialektik_ulid
          and p.event_id = ${eventId}::dialektik_ulid`.execute(tx);
        if (!position.rows.length) throw new NotFoundException('Position of the event not found.');
      }
      const columns = review ? sql`,position_id,stance,status` : sql``;
      const values = review
        ? sql`, ${entry.positionId ?? null}::dialektik_ulid, ${entry.stance ?? null}::text, ${status}::text`
        : sql``;
      const inserted = await sql`
        insert into public.social_community_entries(event_id,user_id,channel,author_alias,body,article_id,link_url${columns})
        select e.id, ${userId}::uuid, ${entry.channel},
          coalesce(${alias}::text, 'Lector-' || upper(substr(md5(${userId}::text), 1, 4))),
          ${entry.body}, ${entry.articleId}::dialektik_ulid, ${entry.linkUrl}::text${values}
        from public.public_events e
        where e.id = ${eventId}::dialektik_ulid and e.analysis_state = 'PUBLISHED'
          and (${entry.articleId}::dialektik_ulid is null or exists (
            select 1 from public.articles a where a.id = ${entry.articleId}::dialektik_ulid and a.event_id = e.id))
        returning id`.execute(tx);
      if (!inserted.rows.length) throw new NotFoundException('Published event or evidence not found.');
    });
  }

  #requireModerator(userId: string): void {
    if (this.science?.isModerator(userId) !== true) throw new ForbiddenException({ code: 'PUBLIC_FORBIDDEN' });
  }

  /** Link contributions waiting for a moderator, oldest first. */
  async reviewQueue(userId: string): Promise<{ entries: ReviewEntry[] }> {
    this.#requireModerator(userId);
    return this.#guarded(() => this.db.database.transaction().execute(async tx => {
      if (!(await this.#reviewReady(tx as Transaction<unknown>))) return { entries: [] };
      const rows = await sql<ReviewEntry & { channel: string }>`
        select c.id::text, c.event_id::text, e.title_descriptive as event_title, lower(c.channel) as channel,
          c.author_alias as author, c.body, coalesce(c.link_url, a.url_canonical) as url,
          p.title as position_title, c.stance, c.created_at
        from public.social_community_entries c
        join public.public_events e on e.id = c.event_id
        left join public.articles a on a.id = c.article_id
        left join public.positions p on p.id = c.position_id
        where c.status = 'in_review'
        order by c.created_at limit 100`.execute(tx);
      return { entries: rows.rows.map(row => ({ ...row, channel: row.channel === 'nota' ? 'nota' : 'aporte' })) };
    }));
  }

  /** Publishes or rejects one contribution in review. */
  async reviewEntry(userId: string, entryId: string, approve: boolean): Promise<void> {
    this.#requireModerator(userId);
    await this.#write(userId, async tx => {
      await sql`select set_config('dialektik.science_moderator', 'on', true)`.execute(tx);
      const updated = await sql`update public.social_community_entries
        set status = ${approve ? 'published' : 'rejected'}, reviewed_at = now(), reviewed_by = ${userId}::uuid
        where id = ${entryId}::uuid and status = 'in_review' returning id`.execute(tx);
      if (!updated.rows.length) throw new NotFoundException('Contribution in review not found.');
    });
  }

  /** Shared usefulness vote; returns the event whose listing changed. */
  async voteEntry(userId: string, entryId: string, vote: 1 | -1 | null): Promise<string> {
    return this.#write(userId, async tx => {
      const entry = await sql<{ event_id: string }>`
        select n.event_id::text as event_id from (
          select id, event_id from public.social_community_entries where id = ${entryId}::uuid
          union all
          select id, event_id from public.social_evidence_comments where id = ${entryId}::uuid
        ) n join public.public_events e on e.id = n.event_id and e.analysis_state = 'PUBLISHED' limit 1`.execute(tx);
      const eventId = entry.rows[0]?.event_id;
      if (eventId === undefined) throw new NotFoundException('Community entry not found.');
      if (vote === null) {
        await sql`delete from public.social_entry_votes where entry_id = ${entryId}::uuid and user_id = ${userId}::uuid`.execute(tx);
      } else {
        await sql`insert into public.social_entry_votes(entry_id,user_id,vote) values (${entryId}::uuid,${userId}::uuid,${vote}::smallint)
          on conflict (entry_id,user_id) do update set vote=excluded.vote, updated_at=now()`.execute(tx);
      }
      return eventId;
    });
  }
}
