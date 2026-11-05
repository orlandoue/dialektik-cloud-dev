import { describe, expect, it } from 'vitest';
import { publicYouTubeSubscriptions } from '../src/live/youtube-subscriptions-sync.js';

const channel='UCabcdefghijklmnopqrstuv';
const subscribed='UC1234567890123456789012';
const json=(data: unknown, status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
describe('public YouTube subscription matching',()=>{
  it('resolves a handle and enumerates public pages without persisting credentials',async()=>{
    const calls:URL[]=[];
    const request:typeof fetch=async(input)=>{
      const url=new URL(String(input)); calls.push(url);
      if(url.pathname.endsWith('/channels')) return json({items:[{id:channel}]});
      if(!url.searchParams.has('pageToken')) return json({items:[{snippet:{resourceId:{channelId:subscribed}}}],nextPageToken:'NEXT'});
      return json({items:[{snippet:{resourceId:{channelId:subscribed}}}]});
    };
    const result=await publicYouTubeSubscriptions('@mychannel',request,'test-key');
    expect(result).toEqual({channelIds:[subscribed],truncated:false});
    expect(calls).toHaveLength(3);
    expect(calls[1]?.searchParams.get('channelId')).toBe(channel);
  });
  it('reports inaccessible lists and rejects invalid input',async()=>{
    await expect(publicYouTubeSubscriptions(channel,async()=>json({},403),'test-key')).rejects.toThrow('YOUTUBE_SUBSCRIPTIONS_PRIVATE_OR_UNAVAILABLE');
    await expect(publicYouTubeSubscriptions('https://evil.example',async()=>json({}),'test-key')).rejects.toThrow('YOUTUBE_CHANNEL_INVALID');
  });
  it('bounds long lists and indicates incomplete results',async()=>{
    let calls=0;
    const result=await publicYouTubeSubscriptions(channel,async()=>{calls++;return json({items:[],nextPageToken:'NEXT'});},'test-key');
    expect(calls).toBe(10);expect(result.truncated).toBe(true);
  });
});
