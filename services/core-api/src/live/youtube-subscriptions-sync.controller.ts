import { Body, Controller, HttpException, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { betaUserId, PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { CorporateLiveAcquisitionDatabaseService } from './corporate-live-acquisition-database.service.js';
import { publicYouTubeSubscriptions } from './youtube-subscriptions-sync.js';

@Controller('v1/source-sync')
@UseGuards(PrivateBetaAuthGuard)
export class YoutubeSubscriptionsSyncController {
  private readonly limits = new Map<string, number[]>();
  constructor(@Inject(CorporateLiveAcquisitionDatabaseService) private readonly writer: CorporateLiveAcquisitionDatabaseService) {}
  @Post('youtube')
  async sync(@Req() request: FastifyRequest, @Body() body: unknown) {
    const id=betaUserId(request); const now=Date.now();
    const recent=(this.limits.get(id) ?? []).filter((time)=>now-time<60_000);
    if(recent.length>=3) throw new HttpException('SOURCE_SYNC_RATE_LIMITED',429);
    this.limits.set(id,[...recent,now]);
    if(this.limits.size>1000) for(const [user,times] of this.limits) if(times.every((time)=>now-time>=60_000)) this.limits.delete(user);
    const value=typeof body==='object' && body!==null && !Array.isArray(body) ? (body as Record<string,unknown>).channel : null;
    const result=await publicYouTubeSubscriptions(value);
    const rows=await sql<{sourceId:string;channelUrl:string}>`select source.id::text as "sourceId", connection.channel_url as "channelUrl"
      from public.sources source
      join lateral (select * from public.corporate_live_source_connections c where c.source_id=source.id order by c.sequence_number desc limit 1) connection on connection.active
      join lateral (select * from public.live_source_policies p where p.source_id=source.id order by p.recorded_at desc,p.id desc limit 1) policy on policy.active and policy.rights_class='LIVE_READY'
      where source.origin='LIVE_REAL' and source.canonical_domain='youtube.com' and connection.discovery_channel='youtube_data_api_v3'`.execute(this.writer.database);
    const ids=new Set(result.channelIds);
    return {source_ids:rows.rows.filter((row)=>{const match=/\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/u.exec(row.channelUrl ?? '');return match?.[1] !== undefined && ids.has(match[1]);}).map((row)=>row.sourceId),truncated:result.truncated};
  }
}
