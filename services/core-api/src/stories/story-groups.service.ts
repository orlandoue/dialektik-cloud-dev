import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { SHARED_READ_OPTIONS, SharedReadCache } from '../public-api/shared-read-cache.js';
import { ScienceService } from '../science/science.service.js';
import { proposeStories, type ApprovedStory, type StoryEvent } from './story-grouping.js';

const MISSING = new Set(['42P01', '42703', '42883']);

export interface StoryGroupJson {
  id: string;
  title: string;
  cover_event_id: string | null;
  event_ids: string[];
  source_ids: string[];
  source_count: number;
  last_coverage_at: string | null;
}

export interface StoryProposalJson {
  id: string;
  target_group_id: string | null;
  target_title: string | null;
  suggested_title: string;
  proposed_at: string;
  events: { id: string; title: string; outlets: string[]; first_published_at: string | null }[];
}

/** Every 30 minutes; the first run two minutes after start. */
const PROPOSE_EVERY_MS = 30 * 60_000;

@Injectable()
export class StoryGroupsService implements OnModuleInit, OnModuleDestroy {
  readonly #logger = new Logger(StoryGroupsService.name);
  readonly #shared = new SharedReadCache<StoryGroupJson[]>(SHARED_READ_OPTIONS);
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;

  constructor(
    @Inject(CoreDatabaseService) private readonly db: CoreDatabaseService,
    @Inject(ScienceService) private readonly science: ScienceService,
  ) {}

  onModuleInit(): void {
    if (process.env.DIALEKTIK_STORY_PROPOSALS === 'off') return;
    const tick = () => {
      this.#timer = setTimeout(() => {
        void this.propose().catch(() => undefined).finally(tick);
      }, this.#timer === undefined ? 2 * 60_000 : PROPOSE_EVERY_MS);
      this.#timer.unref?.();
    };
    tick();
    this.#shared.startWarming();
  }

  onModuleDestroy(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#shared.stopWarming();
  }

  /** Approved stories of the last 30 days: shared by every reader. */
  stories(): Promise<StoryGroupJson[]> {
    return this.#shared.get('stories', () => this.#stories());
  }

  async #stories(): Promise<StoryGroupJson[]> {
    try {
      const rows = await sql<{ id: string; title: string; cover_event_id: string | null; event_ids: string[];
        source_ids: string[] | null; last_coverage_at: Date | null }>`
        select g.id::text, g.title, g.cover_event_id::text,
          array_agg(distinct ge.event_id::text) as event_ids,
          array_agg(distinct a.source_id::text) filter (where a.source_id is not null) as source_ids,
          max(a.published_at) as last_coverage_at
        from public.story_groups g
        join public.story_group_events ge on ge.group_id = g.id
        join public.public_events e on e.id = ge.event_id and e.analysis_state = 'PUBLISHED'
        left join public.articles a on a.event_id = ge.event_id and a.origin = 'LIVE_REAL'
        group by g.id
        having max(e.detected_at) > now() - interval '30 days'
        order by max(a.published_at) desc nulls last
        limit 200`.execute(this.db.database);
      return rows.rows.map((row) => ({
        id: row.id,
        title: row.title,
        cover_event_id: row.cover_event_id,
        event_ids: row.event_ids,
        source_ids: row.source_ids ?? [],
        source_count: (row.source_ids ?? []).length,
        last_coverage_at: row.last_coverage_at === null ? null : new Date(row.last_coverage_at).toISOString(),
      }));
    } catch (error) {
      if (MISSING.has(String((error as { code?: unknown })?.code))) return [];
      throw error;
    }
  }

  /** Events published in the last 7 days, with their outlets and headlines. */
  async #recentEvents(database: Kysely<unknown> | Transaction<unknown>): Promise<StoryEvent[]> {
    const rows = await sql<{ id: string; title: string; headlines: string[]; source_ids: string[];
      first_published: Date; last_published: Date }>`
      select e.id::text, e.title_descriptive as title,
        array_agg(left(v.headline, 160) order by v.published_at) as headlines,
        array_agg(distinct a.source_id::text) as source_ids,
        min(v.published_at) as first_published, max(v.published_at) as last_published
      from public.public_events e
      join public.articles a on a.event_id = e.id and a.origin = 'LIVE_REAL'
      join public.live_article_versions v on v.article_id = a.id
        and v.version_number = (select max(version_number) from public.live_article_versions where article_id = a.id)
      where e.analysis_state = 'PUBLISHED' and e.merged_into is null
        and e.detected_at > now() - interval '7 days'
      group by e.id, e.title_descriptive`.execute(database);
    return rows.rows.map((row) => ({
      id: row.id,
      title: row.title,
      headlines: row.headlines,
      sourceIds: row.source_ids,
      firstPublished: new Date(row.first_published),
      lastPublished: new Date(row.last_published),
    }));
  }

  /** One proposer run: new proposals are stored; still-valid ones are marked seen. */
  async propose(now: Date = new Date()): Promise<number> {
    if (this.#running) return 0;
    this.#running = true;
    try {
      return await this.db.database.transaction().setAccessMode('read write').execute(async (tx) => {
        // Core itself proposes and refreshes «seen»; it never decides.
        await sql`select set_config('dialektik.science_moderator', 'on', true)`.execute(tx);
        const events = await this.#recentEvents(tx as unknown as Transaction<unknown>);
        const approved = await sql<{ id: string; event_ids: string[] }>`
          select g.id::text, array_agg(ge.event_id::text) as event_ids
          from public.story_groups g join public.story_group_events ge on ge.group_id = g.id
          group by g.id`.execute(tx);
        const rejected = await sql<{ signature: string }>`
          select signature from public.story_group_proposals where status = 'rejected'`.execute(tx);
        const proposals = proposeStories(
          events,
          approved.rows.map((row): ApprovedStory => ({ id: row.id, eventIds: row.event_ids })),
          new Set(rejected.rows.map((row) => row.signature)),
        );
        for (const proposal of proposals) {
          await sql`insert into public.story_group_proposals(signature, target_group_id, event_ids, suggested_title, seen_at)
            values (${proposal.signature}, ${proposal.targetGroupId}::uuid, ${proposal.eventIds}::text[],
              ${proposal.suggestedTitle.slice(0, 140)}, ${now})
            on conflict (signature) do update set seen_at = excluded.seen_at
              where story_group_proposals.status = 'proposed'`.execute(tx);
        }
        return proposals.length;
      });
    } catch (error) {
      if (MISSING.has(String((error as { code?: unknown })?.code))) return 0;
      this.#logger.warn(`Story proposals failed: ${(error as Error).message}`);
      throw error;
    } finally {
      this.#running = false;
    }
  }

  #requireModerator(userId: string): void {
    if (!this.science.isModerator(userId)) throw new ForbiddenException({ code: 'PUBLIC_FORBIDDEN' });
  }

  async #moderate<T>(userId: string, work: (tx: Transaction<unknown>) => Promise<T>): Promise<T> {
    this.#requireModerator(userId);
    try {
      return await this.db.database.transaction().setAccessMode('read write').execute(async (tx) => {
        await sql`select set_config('dialektik.social_user', ${userId}, true)`.execute(tx);
        await sql`select set_config('dialektik.science_moderator', 'on', true)`.execute(tx);
        return work(tx as Transaction<unknown>);
      });
    } catch (error) {
      if (MISSING.has(String((error as { code?: unknown })?.code))) {
        throw new ServiceUnavailableException('Story storage is not available yet.');
      }
      throw error;
    }
  }

  /** Open proposals still produced by the last runs, for the «Fusiones» tab. */
  async proposals(userId: string): Promise<{ proposals: StoryProposalJson[] }> {
    return this.#moderate(userId, async (tx) => {
      const open = await sql<{ id: string; target_group_id: string | null; target_title: string | null;
        suggested_title: string; proposed_at: Date; event_ids: string[] }>`
        select p.id::text, p.target_group_id::text, g.title as target_title, p.suggested_title, p.proposed_at, p.event_ids
        from public.story_group_proposals p
        left join public.story_groups g on g.id = p.target_group_id
        where p.status = 'proposed' and p.seen_at > now() - interval '2 hours'
          and not exists (select 1 from public.story_group_events ge where ge.event_id = any(p.event_ids))
        order by cardinality(p.event_ids) desc, p.proposed_at desc
        limit 50`.execute(tx);
      const ids = [...new Set(open.rows.flatMap((row) => row.event_ids))];
      const details = ids.length === 0 ? [] : (await sql<{ id: string; title: string; outlets: string[];
        first_published_at: Date | null }>`
        select e.id::text, e.title_descriptive as title,
          array_agg(distinct s.name) filter (where s.name is not null) as outlets,
          min(a.published_at) as first_published_at
        from public.public_events e
        left join public.articles a on a.event_id = e.id and a.origin = 'LIVE_REAL'
        left join public.sources s on s.id = a.source_id
        where e.id::text = any(${ids}::text[])
        group by e.id, e.title_descriptive`.execute(tx)).rows;
      const byId = new Map(details.map((row) => [row.id, row]));
      return {
        proposals: open.rows.map((row) => ({
          id: row.id,
          target_group_id: row.target_group_id,
          target_title: row.target_title,
          suggested_title: row.suggested_title,
          proposed_at: new Date(row.proposed_at).toISOString(),
          events: row.event_ids.map((id) => byId.get(id)).filter((e) => e !== undefined)
            .sort((a, b) => (a.first_published_at?.getTime() ?? 0) - (b.first_published_at?.getTime() ?? 0))
            .map((e) => ({
              id: e.id,
              title: e.title,
              outlets: e.outlets ?? [],
              first_published_at: e.first_published_at === null ? null : new Date(e.first_published_at).toISOString(),
            })),
        })),
      };
    });
  }

  /** Approve (with the story's title) or reject one proposal. */
  async decide(userId: string, proposalId: string, approve: boolean, title: string | null): Promise<{ group_id: string | null }> {
    if (approve && title !== null && (title.trim().length < 3 || title.trim().length > 140)) {
      throw new BadRequestException('Invalid title.');
    }
    const result = await this.#moderate(userId, async (tx) => {
      const found = await sql<{ target_group_id: string | null; event_ids: string[]; suggested_title: string }>`
        select target_group_id::text, event_ids, suggested_title from public.story_group_proposals
        where id = ${proposalId}::uuid and status = 'proposed' for update`.execute(tx);
      const proposal = found.rows[0];
      if (proposal === undefined) throw new NotFoundException('Open proposal not found.');
      if (!approve) {
        await sql`update public.story_group_proposals set status = 'rejected', decided_at = now(), decided_by = ${userId}::uuid
          where id = ${proposalId}::uuid`.execute(tx);
        return { group_id: null };
      }
      let groupId = proposal.target_group_id;
      const chosenTitle = (title ?? proposal.suggested_title).trim();
      if (groupId === null) {
        // Cover: the proposal's first event with the most outlets.
        const cover = await sql<{ id: string }>`select a.event_id::text as id from public.articles a
          where a.event_id::text = any(${proposal.event_ids}::text[]) and a.origin = 'LIVE_REAL'
          group by a.event_id order by count(distinct a.source_id) desc, min(a.published_at) limit 1`.execute(tx);
        const created = await sql<{ id: string }>`insert into public.story_groups(title, cover_event_id, decided_by)
          values (${chosenTitle}, ${cover.rows[0]?.id ?? null}, ${userId}::uuid) returning id::text`.execute(tx);
        groupId = created.rows[0]!.id;
      } else {
        await sql`update public.story_groups set updated_at = now()
          ${title === null ? sql.raw('') : sql`, title = ${chosenTitle}`} where id = ${groupId}::uuid`.execute(tx);
      }
      for (const eventId of proposal.event_ids) {
        await sql`insert into public.story_group_events(event_id, group_id) values (${eventId}, ${groupId}::uuid)
          on conflict (event_id) do nothing`.execute(tx);
      }
      await sql`update public.story_group_proposals set status = 'approved', decided_at = now(), decided_by = ${userId}::uuid
        where id = ${proposalId}::uuid`.execute(tx);
      return { group_id: groupId };
    });
    this.#shared.invalidate('stories');
    return result;
  }
}
