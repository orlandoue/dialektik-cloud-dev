/**
 * Source-specific RSS link preview, not the legacy /live/news database feed.
 *
 * Diario El Día expressly describes RSS as content offered for aggregation
 * in applications/sites: https://www.diarioeldia.cl/rss
 *
 * Only source-supplied headline, URL and publication date are displayed.
 * No article page, excerpt, description, image, body or AI input is fetched.
 * This grants NO rights to reprint full text and does not enable the 50-media
 * inactive candidate registry.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const FEED = 'https://www.diarioeldia.cl/rss/noticias/';
const RIGHTS = 'https://www.diarioeldia.cl/rss';
const MAX_BYTES = 400_000;
const CACHE_MS = 300_000;
const MAX_ITEMS = 20;
const MAX_AGE_MS = 10 * 86_400_000;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'DialektikRSSReader/1.0 (metadata-only)';
type Fetcher = typeof fetch;
type Dict = Record<string, unknown>;

function object(raw: unknown): Dict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('RSS_OBJECT_INVALID');
  return raw as Dict;
}
function sourceUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 1500) throw Error('RSS_LINK_INVALID');
  const url = new URL(raw);
  if(url.protocol !== 'https:' || !['www.diarioeldia.cl','diarioeldia.cl'].includes(url.hostname) ||
     url.port || url.username || url.password || url.hash || url.pathname === '/') {
    throw Error('RSS_LINK_UNTRUSTED_ORIGIN');
  }
  return url.href;
}
function title(raw: unknown): string {
  if(typeof raw!=='string') throw Error('RSS_TITLE_INVALID');
  const s=raw.replace(/\s+/gu,' ').trim();
  if(s.length<8 || s.length>260 || /[\u0000-\u001f\u007f]/u.test(s))
    throw Error('RSS_TITLE_INVALID');
  return s;
}
export interface LinkedRssHeadline {
  readonly id: string;
  readonly publisher: 'Diario El Día';
  readonly publisher_domain: 'diarioeldia.cl';
  readonly headline: string;
  readonly original_url: string;
  readonly published_at: string;
  readonly media_category: 'NEWS_LINKS_NOT_INGESTED_ARTICLES';
}
export function decodeChileRss(xml: string, now = new Date()) {
  if (xml.length > MAX_BYTES || /<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml) ||
      XMLValidator.validate(xml) !== true) throw Error('RSS_XML_INVALID');
  const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,
    processEntities:false,trimValues:true,removeNSPrefix:false});
  const root=object(parser.parse(xml));
  const channel=object(object(root.rss).channel);
  if(!channel.item) throw Error('RSS_NO_ITEMS');
  const rawList=Array.isArray(channel.item)?channel.item:[channel.item];
  if(rawList.length>250) throw Error('RSS_TOO_MANY_ITEMS');
  const found: LinkedRssHeadline[]=[];
  const seen=new Set<string>();
  for(const entry of rawList) {
    const item=object(entry);
    if(typeof item.link!=='string' || typeof item.title!=='string' ||
       typeof item.pubDate!=='string') continue;
    let link: string, headline: string;
    try { link=sourceUrl(item.link);headline=title(item.title); }
    catch { continue; }
    const instant=Date.parse(item.pubDate);
    if(!Number.isFinite(instant) || instant > now.getTime()+5*60_000 ||
       instant < now.getTime()-MAX_AGE_MS) continue;
    if(seen.has(link))continue;
    seen.add(link);
    found.push({
      id:link,
      publisher:'Diario El Día',
      publisher_domain:'diarioeldia.cl',
      headline,
      original_url:link,
      published_at:new Date(instant).toISOString(),
      media_category:'NEWS_LINKS_NOT_INGESTED_ARTICLES',
    });
  }
  found.sort((a,b)=>b.published_at.localeCompare(a.published_at) ||
      a.original_url.localeCompare(b.original_url));
  return found.slice(0,MAX_ITEMS);
}
async function loadXml(fetcher:Fetcher): Promise<string> {
  const response=await fetcher(FEED,{
    method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers:{Accept:'application/rss+xml, application/xml, text/xml',
      'User-Agent':USER_AGENT},
  });
  const contentType=response.headers.get('content-type')??'';
  const contentLen=response.headers.get('content-length');
  if(response.status!==200 || !/xml|rss/iu.test(contentType) ||
    (response.url && response.url!==FEED) || !response.body ||
    (contentLen && (!/^\d+$/u.test(contentLen)||Number(contentLen)>MAX_BYTES))) {
    await response.body?.cancel();
    throw Error('RSS_UPSTREAM_UNVERIFIED');
  }
  let size=0;const chunks:Uint8Array[]=[];const reader=response.body.getReader();
  try{
    for(;;){
      const next=await reader.read();if(next.done)break;
      size+=next.value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();throw Error('RSS_TOO_LARGE');}
      chunks.push(next.value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let pos=0;
  for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  finally{bytes.fill(0);}
}
export async function fetchChileRssLinkedHeadlines(fetcher:Fetcher=fetch,now=new Date()) {
  const rows=decodeChileRss(await loadXml(fetcher),now);
  return {
    mode:'LIVE_RSS_ORIGINAL_LINK_PREVIEW' as const,
    country_code:'CL' as const,
    rights_basis:'PUBLISHER_OFFICIAL_RSS_AGGREGATION_INFORMATION' as const,
    rights_evidence_url:RIGHTS,
    feed_url:FEED,
    origin:'PUBLISHER_ORIGINAL_RSS' as const,
    persisted:false as const,
    articles_reproduced:false as const,
    excerpts_reproduced:false as const,
    bodies_downloaded:false as const,
    events_detected:false as const,
    contradictions_detected:false as const,
    fetched_at:now.toISOString(),
    items:rows,
  };
}
let cache:Promise<Awaited<ReturnType<typeof fetchChileRssLinkedHeadlines>>>|null=null;
let expiresAt=0;
export function latestChileRssLinkedHeadlines(now=new Date()) {
  if(!cache || now.getTime()>=expiresAt) {
    const active=fetchChileRssLinkedHeadlines(fetch,now);
    const tracked=active.catch(error=>{if(cache===tracked){cache=null;expiresAt=0;}throw error;});
    cache=tracked;expiresAt=now.getTime()+CACHE_MS;
  }
  return cache;
}
