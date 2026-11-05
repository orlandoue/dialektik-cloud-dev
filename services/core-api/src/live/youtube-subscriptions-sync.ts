import { BadGatewayException, BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { youtubeApiKey } from './youtube-data-api.js';

const channelPattern = /^UC[A-Za-z0-9_-]{22}$/u;
const handlePattern = /^@[A-Za-z0-9._-]{3,30}$/u;
const maxPages = 10;

/** Public subscriptions only. No credentials, subscription list or handle is persisted. */
export async function publicYouTubeSubscriptions(input: unknown, request: typeof fetch = fetch, key = youtubeApiKey()): Promise<{ channelIds: string[]; truncated: boolean }> {
  if (typeof input !== 'string' || input.length > 32) throw new BadRequestException('YOUTUBE_CHANNEL_INVALID');
  const value=input.trim();
  if (!channelPattern.test(value) && !handlePattern.test(value)) throw new BadRequestException('YOUTUBE_CHANNEL_INVALID');
  if (!key) throw new ServiceUnavailableException('YOUTUBE_API_NOT_CONFIGURED');
  async function get(path: string, params: Record<string,string>): Promise<Record<string,unknown>> {
    const url=new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for(const [name,entry] of Object.entries(params)) url.searchParams.set(name,entry);
    url.searchParams.set('key',key!);
    let response: Response;
    try { response=await request(url,{signal:AbortSignal.timeout(12000),redirect:'error'}); }
    catch { throw new BadGatewayException('YOUTUBE_API_UNAVAILABLE'); }
    if(response.status===403) throw new ForbiddenException('YOUTUBE_SUBSCRIPTIONS_PRIVATE_OR_UNAVAILABLE');
    if(!response.ok) throw new BadGatewayException('YOUTUBE_API_UNAVAILABLE');
    let data:unknown;
    try { data=await response.json(); } catch { throw new BadGatewayException('YOUTUBE_RESPONSE_INVALID'); }
    if(typeof data!=='object' || data===null || Array.isArray(data)) throw new BadGatewayException('YOUTUBE_RESPONSE_INVALID');
    return data as Record<string,unknown>;
  }
  let channelId=value;
  if(handlePattern.test(value)) {
    const data=await get('channels',{part:'id',forHandle:value,maxResults:'1'});
    const item=Array.isArray(data.items) ? data.items[0] as Record<string,unknown> | undefined : undefined;
    if(typeof item?.id!=='string' || !channelPattern.test(item.id)) throw new BadRequestException('YOUTUBE_CHANNEL_NOT_FOUND');
    channelId=item.id;
  }
  const channels=new Set<string>(); let page:string | undefined;
  for(let count=0;count<maxPages;count++) {
    const data=await get('subscriptions',{part:'snippet',channelId,maxResults:'50',...(page ? {pageToken:page} : {})});
    if(!Array.isArray(data.items)) throw new BadGatewayException('YOUTUBE_RESPONSE_INVALID');
    for(const item of data.items) {
      if(typeof item!=='object' || item===null) continue;
      const snippet=(item as Record<string,unknown>).snippet;
      if(typeof snippet!=='object' || snippet===null) continue;
      const resource=(snippet as Record<string,unknown>).resourceId;
      if(typeof resource!=='object' || resource===null) continue;
      const id=(resource as Record<string,unknown>).channelId;
      if(typeof id==='string' && channelPattern.test(id)) channels.add(id);
    }
    page=typeof data.nextPageToken==='string' && /^[A-Za-z0-9_-]{1,256}$/u.test(data.nextPageToken) ? data.nextPageToken : undefined;
    if(!page) return {channelIds:[...channels],truncated:false};
  }
  return {channelIds:[...channels],truncated:true};
}
