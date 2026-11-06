import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { CoreDatabaseService } from '../database/core-database.service.js';

export type SocialReaction = 'SOLID' | 'BIASED';

@Injectable()
export class SocialService {
  constructor(@Inject(CoreDatabaseService) private readonly db: CoreDatabaseService) {}

  async react(userId: string, eventId: string, reaction: SocialReaction | null): Promise<void> {
    await this.db.database.transaction().setAccessMode('read write').execute(async tx => {
      await sql`select set_config('dialektik.social_user', ${userId}, true)`.execute(tx);
      const event = await sql`select 1 from public.public_events where id = ${eventId}::dialektik_ulid and analysis_state = 'PUBLISHED'`.execute(tx);
      if (!event.rows.length) throw new NotFoundException('Published event not found.');
      if (reaction === null) {
        await sql`delete from public.social_reactions where event_id = ${eventId}::dialektik_ulid and user_id = ${userId}::uuid`.execute(tx);
      } else {
        await sql`insert into public.social_reactions(event_id,user_id,reaction) values (${eventId}::dialektik_ulid,${userId}::uuid,${reaction})
          on conflict (event_id,user_id) do update set reaction=excluded.reaction, updated_at=now()`.execute(tx);
      }
    });
  }

  async summary(userId: string, eventId?: string, sourceId?: string) {
    return this.db.database.transaction().execute(async tx => {
      const filter = eventId !== undefined
        ? sql`r.event_id = ${eventId}::dialektik_ulid`
        : sql`exists (select 1 from public.articles a where a.event_id = r.event_id and a.source_id = ${sourceId}::dialektik_ulid)`;
      const votes = await sql<{solid: number; biased: number; mine: SocialReaction | null}>`
        select count(*) filter (where r.reaction='SOLID')::int as solid,
          count(*) filter (where r.reaction='BIASED')::int as biased,
          max(r.reaction) filter (where r.user_id=${userId}::uuid) as mine
        from public.social_reactions r join public.public_events e on e.id=r.event_id and e.analysis_state='PUBLISHED'
        where ${filter}`.execute(tx);
      if (eventId === undefined) return {...votes.rows[0], mine: null};
      const comments = await sql<{id:string; body:string; article_id:string; url:string; created_at:Date}>`
        select c.id::text, c.body, c.article_id::text, a.url_canonical as url, c.created_at
        from public.social_evidence_comments c join public.articles a on a.id=c.article_id
        join public.public_events e on e.id=c.event_id and e.analysis_state='PUBLISHED'
        where c.event_id=${eventId}::dialektik_ulid order by c.created_at desc, c.id desc limit 50`.execute(tx);
      return {...votes.rows[0], comments:comments.rows};
    });
  }

  async comment(userId: string, eventId: string, articleId: string, body: string): Promise<void> {
    await this.db.database.transaction().setAccessMode('read write').execute(async tx => {
      await sql`select set_config('dialektik.social_user', ${userId}, true)`.execute(tx);
      const inserted = await sql`insert into public.social_evidence_comments(event_id,user_id,article_id,body)
        select e.id,${userId}::uuid,a.id,${body} from public.public_events e
        join public.articles a on a.event_id=e.id and a.id=${articleId}::dialektik_ulid
        where e.id=${eventId}::dialektik_ulid and e.analysis_state='PUBLISHED' returning id`.execute(tx);
      if (!inserted.rows.length) throw new NotFoundException('Published event or evidence not found.');
    });
  }
}
