import {createHash} from 'node:crypto';
import {XMLParser, XMLValidator} from 'fast-xml-parser';

/**
 * First genuine RSS navigation pilot in private beta.
 * Publisher-origin RSS metadata only: title, canonical source URL, date.
 * It does NOT license reproduction or authorize SQL persistence/AI inference.
 */
const SOURCE = Object.freeze({
  id:'cl_cooperativa_rss',
  publisher:'Cooperativa.cl',
  domain:'www.cooperativa.cl',
  rssUrl:'https://www.cooperativa.cl/noticias/google_news_rss.xml',
  robotsUrl:'https://www.cooperativa.cl/robots.txt',
});
const RSS_LIMIT=18;
const BYTE_LIMIT=1_000_000;
const CACHE_MS=300_000;
const MAX_AGE_MS=7*86_400_000;
const FETCH_MS=12000;
type Fetcher=typeof fetch;
type UnknownRecord=Record<string,unknown>;

function record(value:unknown):UnknownRecord{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('RSS_INVALID_OBJECT');
  return value as UnknownRecord;
}
function stringField(input:unknown,max=280):string {
  if(typeof input!=='string'||input.trim().length<3||input.trim().length>max ||
     /[\u0000-\u001f\u007f]/u.test(input))throw Error('RSS_INVALID_STRING');
  return input.trim().replace(/\s+/gu,' ');
}
function allowedLink(raw:unknown):string{
  const url=new URL(stringField(raw,1500));
  if(url.protocol!=='https:' || url.host!==SOURCE.domain ||
      !url.pathname.startsWith('/noticias/') || url.username || url.password ||
      url.hash || url.port)throw Error('RSS_OUTBOUND_ORIGIN_INVALID');
  url.hash='';
  return url.toString();
}
function sourceRobotsPermit(robots:string, path:string):boolean{
  if(/<html|<!doctype|<\?xml/iu.test(robots)||robots.length>65000)return false;
  // Conservative minimal parser for the public robots file. Rules for the
  // product-specific agent override wildcard groups, and longest match wins.
  const groups:Array<{agents:string[];rules:Array<{type:string;pattern:string}>}>=[];
  let agents:string[]=[],rules:Array<{type:string;pattern:string}>=[];
  const flush=()=>{
    if(agents.length)groups.push({agents,rules});
    agents=[];rules=[];
  };
  for(const line of robots.split(/\r?\n/u)){
    const text=line.split('#')[0]?.trim()??'';
    if(!text)continue;
    const match=/^([a-z-]+)\s*:\s*(.*)$/iu.exec(text);
    if(!match)return false;
    const key=match[1]!.toLowerCase(),val=match[2]!.trim();
    if(key==='user-agent'){
      if(rules.length)flush();
      agents.push(val.toLowerCase());
    }else if(key==='allow'||key==='disallow'){
      if(!agents.length)continue;
      rules.push({type:key,pattern:val});
    }else if(key==='sitemap'){continue;}
    else if(key==='crawl-delay')return false;
    else return false;
  }
  flush();
  const own=groups.filter(g=>g.agents.includes('dialektikrsslinks'));
  const active=own.length?own:groups.filter(g=>g.agents.includes('*'));
  if(!active.length)return false;
  const patterns=active.flatMap(g=>g.rules)
    .filter(r=>r.pattern.length>0&&path.startsWith(r.pattern.replace(/\*.*$/u,'')))
    .sort((a,b)=>b.pattern.replace(/\*.*$/u,'').length-a.pattern.replace(/\*.*$/u,'').length ||
           (a.type==='allow'?-1:1));
  if(patterns.some(x=>x.pattern.includes('$')))return false;
  return patterns.length>0 && patterns[0]!.type==='allow';
}
async function getBoundedText(url:string,fetcher:Fetcher,accept:string):Promise<string>{
  const res=await fetcher(url,{
    method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
    signal:AbortSignal.timeout(FETCH_MS),
    headers:{Accept:accept,'User-Agent':'DialektikRSSLinks/1.0'},
  });
  if(res.status!==200 || (res.url&&res.url!==url) ||
     (res.headers.get('content-length')&&
       Number(res.headers.get('content-length'))>BYTE_LIMIT) || !res.body) {
    await res.body?.cancel();
    throw Error('RSS_HTTP_SOURCE_NOT_AVAILABLE');
  }
  const reader=res.body.getReader(),parts:Uint8Array[]=[];
  let used=0;
  try{
    for(;;){
      const part=await reader.read();if(part.done)break;
      used+=part.value.byteLength;
      if(used>BYTE_LIMIT){await reader.cancel();throw Error('RSS_TOO_LARGE');}
      parts.push(part.value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(used);let index=0;
  for(const part of parts){bytes.set(part,index);index+=part.byteLength;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  finally{bytes.fill(0);}
}
export function parseChileRssLinks(xml:string,now=new Date()){
  if(typeof xml!=='string'||xml.length>BYTE_LIMIT||
     /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/iu.test(xml))throw Error('RSS_UNSAFE_XML');
  if(XMLValidator.validate(xml)!==true)throw Error('RSS_XML_SYNTAX');
  const parsed=record(new XMLParser({
    ignoreAttributes:true,parseTagValue:false,trimValues:true,
    processEntities:true,removeNSPrefix:true,ignoreDeclaration:true,
  }).parse(xml));
  const rss=record(parsed.rss);
  const channel=record(rss.channel);
  const title=String(channel.title??'');
  if(!/Cooperativa/iu.test(title))throw Error('RSS_PUBLISHER_NOT_PROVEN');
  const entries=Array.isArray(channel.item)?channel.item:
    channel.item?[channel.item]:[];
  if(entries.length>1000)throw Error('RSS_TOO_MANY_ENTRIES');
  const result:Array<{
    content_id:string;headline:string;publisher:string;
    canonical_url:string;published_at:string;source_feed_url:string;
  }>=[];
  const seen=new Set<string>();
  for(const value of entries){
    try{
      const item=record(value);
      const headline=stringField(item.title,230);
      const canonical_url=allowedLink(item.link);
      const parsedDate=Date.parse(stringField(item.pubDate,120));
      if(!Number.isFinite(parsedDate)||parsedDate>now.getTime()+300000||
         parsedDate<now.getTime()-MAX_AGE_MS||seen.has(canonical_url))continue;
      seen.add(canonical_url);
      result.push({
        content_id:createHash('sha256').update(SOURCE.id+'\n'+canonical_url).digest('hex'),
        headline,publisher:SOURCE.publisher,canonical_url,
        published_at:new Date(parsedDate).toISOString(),
        source_feed_url:SOURCE.rssUrl,
      });
    }catch{continue;} // Reject malformed entry, not the entire vetted source.
  }
  return result.sort((a,b)=>b.published_at.localeCompare(a.published_at))
    .slice(0,RSS_LIMIT);
}
export async function fetchChileRssLinkPreview(fetcher:Fetcher=fetch,now=new Date()){
  const robots=await getBoundedText(SOURCE.robotsUrl,fetcher,'text/plain');
  if(!sourceRobotsPermit(robots,new URL(SOURCE.rssUrl).pathname)){
    throw Error('RSS_SOURCE_ROBOTS_NOT_VERIFIED');
  }
  const xml=await getBoundedText(SOURCE.rssUrl,fetcher,'application/rss+xml, application/xml, text/xml');
  const items=parseChileRssLinks(xml,now);
  if(!items.length)throw Error('RSS_NO_RECENT_VERIFIABLE_ITEMS');
  return Object.freeze({
    mode:'SOURCE_RSS_LINKS_READ_ONLY_BETA' as const,
    country_code:'CL' as const,
    publisher:SOURCE.publisher,
    source_feed_url:SOURCE.rssUrl,
    rights_status:'LINK_NAVIGATION_ONLY_RIGHTS_REVIEW_PENDING' as const,
    content_republication_authorized:false as const,
    persisted:false as const,
    semantic_events_published:false as const,
    contradictions_generated:false as const,
    inspected_at:now.toISOString(),
    items,
  });
}
let cache:Promise<Awaited<ReturnType<typeof fetchChileRssLinkPreview>>>|undefined;
let expires=0;
export function latestChileRssLinkPreview(now=new Date()){
  if(!cache||now.getTime()>=expires){
    const ongoing=fetchChileRssLinkPreview(fetch,now);
    const tracked=ongoing.catch((err:unknown)=>{
      if(cache===tracked){cache=undefined;expires=0;}throw err;
    });
    cache=tracked;expires=now.getTime()+CACHE_MS;
  }
  return cache;
}
