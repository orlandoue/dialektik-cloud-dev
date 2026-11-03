import { HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { publisherDomainsForMarket } from '../live/live.publisher-market.js';

@Injectable()
export class FollowedSourcesService {
  constructor(@Inject(CoreDatabaseService) private readonly db: CoreDatabaseService) {}
  async list(userId: string): Promise<string[]> {
    return this.db.database.transaction().execute(async (tx) => {
      await sql`select set_config('dialektik.follow_user',${userId},true)`.execute(tx);
      const result = await sql<{source_id:string}>`select source_id::text as source_id from public.user_followed_sources
        where user_id=${userId}::uuid order by source_id`.execute(tx);
      return result.rows.map((row) => row.source_id);
    });
  }
  async change(userId: string, sourceId: string, follow: boolean): Promise<void> {
    try {
    await this.db.database.transaction().execute(async (tx) => {
      await sql`select set_config('dialektik.follow_user',${userId},true)`.execute(tx);
      if (follow) {
        const domains=publisherDomainsForMarket('CL');
        const eligible=await sql<{ok:boolean}>`select exists(select 1 from public.sources s
          join lateral(select p.* from public.live_source_policies p where p.source_id=s.id
            order by p.recorded_at desc,p.id desc limit 1) p on true
          where s.id=${sourceId}::dialektik_ulid and s.origin='LIVE_REAL'
            and s.canonical_domain in (${sql.join(domains.map((d)=>sql`${d}`))})
            and p.active and p.rights_class='LIVE_READY' and p.policy->>'rightsReviewStatus'='APPROVED'
            and nullif(p.policy->>'authorizationReference','') is not null
            and nullif(p.policy->>'rightsEvidenceUrl','') is not null
            and nullif(p.policy->>'endpoint','') is not null
            and p.policy->>'rightsEvidenceUrl' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')
            and p.policy->>'endpoint' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')) as ok`.execute(tx);
        if (!eligible.rows[0]?.ok) throw new NotFoundException('Source not found.');
        await sql`insert into public.user_followed_sources(user_id,source_id) values (${userId}::uuid,${sourceId}::dialektik_ulid)
          on conflict (user_id,source_id) do nothing`.execute(tx);
      } else {
        await sql`delete from public.user_followed_sources where user_id=${userId}::uuid and source_id=${sourceId}::dialektik_ulid`.execute(tx);
      }
    });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      const safeCode = code === '42501' ? 'PUBLIC_FOLLOW_PERMISSION' :
        code === '23503' ? 'PUBLIC_FOLLOW_REFERENCE' :
        code === '23505' ? 'PUBLIC_FOLLOW_CONFLICT' :
        code === '23514' ? 'PUBLIC_FOLLOW_CONSTRAINT' :
        error instanceof TypeError ? 'PUBLIC_FOLLOW_TYPE' : 'PUBLIC_FOLLOW_OTHER';
      throw new HttpException({code:safeCode},503);
    }
  }
}
