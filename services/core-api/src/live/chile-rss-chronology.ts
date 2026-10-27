/**
 * Aggregated navigation-only Chile RSS timeline.
 *
 * This is NOT a cross-newsroom Event detector; items remain separate
 * publisher claims with original links. Do not write to the SQL Article
 * tables or feed the evidence/contradiction engine from this preview.
 */
import { fetchChileRssLinkedHeadlines, latestChileRssLinkedHeadlines } from './chile-publisher-rss-preview.js';
import { fetchChileRssLinkPreview, latestChileRssLinkPreview } from './chile-rss-link-preview.js';

type ElDia = Awaited<ReturnType<typeof fetchChileRssLinkedHeadlines>>;
type Cooperativa = Awaited<ReturnType<typeof fetchChileRssLinkPreview>>;
type SourceStatus = 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE';

export type RssTimelineHeadline = Readonly<{
  item_key: string;
  source_id: 'cl_diario_eldia_rss' | 'cl_cooperativa_rss';
  publisher: 'Diario El Día' | 'Cooperativa.cl';
  title: string;
  original_url: string;
  published_at: string;
  content_kind: 'PUBLISHER_RSS_TITLE_AND_DEEP_LINK';
}>;
type Outcome<T> = PromiseSettledResult<T>;
const MAX_FUTURE_MS=300_000;
const MAX_AGE_MS=10*86_400_000;
const MAX_ITEMS=30;

function trustworthyUrl(raw:string,source:'eldia'|'cooperativa') {
  let url:URL;
  try {url=new URL(raw);}catch {throw Error('AGG_RSS_INVALID_URL');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||
    (source==='eldia' ?
      !['www.diarioeldia.cl','diarioeldia.cl'].includes(url.hostname) :
      url.hostname!=='www.cooperativa.cl' || !url.pathname.startsWith('/noticias/'))) {
    throw Error('AGG_RSS_WRONG_PUBLISHER');
  }
  return url.toString();
}
function validDate(text:string,now:Date) {
  const time=Date.parse(text);
  if(!Number.isFinite(time) || time<now.getTime()-MAX_AGE_MS ||
      time>now.getTime()+MAX_FUTURE_MS)throw Error('AGG_RSS_BAD_DATE');
  return new Date(time).toISOString();
}
function title(raw:string) {
  if(typeof raw!=='string' || raw.length<3 || raw.length>280 ||
     /[\u0000-\u001f\u007f]/u.test(raw))throw Error('AGG_RSS_TITLE_INVALID');
  return raw;
}
export function composeChileRssChronology(
  day:Outcome<ElDia>,cooperativa:Outcome<Cooperativa>,now=new Date(),
) {
  const sources:Array<{id:string;publisher:string;status:SourceStatus;count:number}>=[];
  const links:RssTimelineHeadline[]=[];
  const ids=new Set<string>();

  function collect(
    id:RssTimelineHeadline['source_id'],
    publisher:RssTimelineHeadline['publisher'],
    kind:'eldia'|'cooperativa',
    outcome:Outcome<ElDia>|Outcome<Cooperativa>,
  ) {
    if(outcome.status!=='fulfilled') {
      sources.push({id,publisher,status:'UNAVAILABLE',count:0});
      return;
    }
    let count=0;
    try {
      const payload=outcome.value;
      if(!Array.isArray(payload.items) ||
         (kind==='eldia' &&
            (payload.mode!=='LIVE_RSS_ORIGINAL_LINK_PREVIEW' || payload.persisted!==false)) ||
         (kind==='cooperativa' &&
            (payload.mode!=='SOURCE_RSS_LINKS_READ_ONLY_BETA' || payload.persisted!==false))) {
        throw Error('AGG_RSS_MODE_INVALID');
      }
      const list=payload.items;
      if(list.length>24)throw Error('AGG_RSS_ITEMS_UNBOUNDED');
      const staging:RssTimelineHeadline[]=[];
      const unique=new Set<string>();
      for(const item of list) {
        const canonical=trustworthyUrl(
          kind==='eldia' ?
            (item as ElDia['items'][number]).original_url :
            (item as Cooperativa['items'][number]).canonical_url,kind);
        if(unique.has(canonical))continue;
        unique.add(canonical);
        const name=kind==='eldia' ?
          (item as ElDia['items'][number]).publisher :
          (item as Cooperativa['items'][number]).publisher;
        if(name!==publisher)throw Error('AGG_RSS_PUBLISHER_INVALID');
        const headline=kind==='eldia' ?
          (item as ElDia['items'][number]).headline :
          (item as Cooperativa['items'][number]).headline;
        staging.push({
          item_key:id+':'+canonical,
          source_id:id,publisher,title:title(headline),
          original_url:canonical,
          published_at:validDate(item.published_at,now),
          content_kind:'PUBLISHER_RSS_TITLE_AND_DEEP_LINK',
        });
      }
      // Do not partially publish a source if one item fails provenance validation.
      for(const row of staging) {
        if(ids.has(row.item_key))continue;
        ids.add(row.item_key);
        links.push(Object.freeze(row));
        count++;
      }
      sources.push({id,publisher,status:count>0?'AVAILABLE':'EMPTY',count});
    }catch {
      sources.push({id,publisher,status:'UNAVAILABLE',count:0});
    }
  }
  collect('cl_diario_eldia_rss','Diario El Día','eldia',day);
  collect('cl_cooperativa_rss','Cooperativa.cl','cooperativa',cooperativa);
  const available=sources.filter(s=>s.status==='AVAILABLE').length;
  if(available===0)throw Error('AGG_RSS_ALL_SOURCES_UNAVAILABLE_OR_EMPTY');
  links.sort((a,b)=>b.published_at.localeCompare(a.published_at) ||
    a.item_key.localeCompare(b.item_key));
  return Object.freeze({
    mode:'CHILE_MULTI_PUBLISHER_RSS_LINK_TIMELINE' as const,
    country_code:'CL' as const,
    refreshed_at:now.toISOString(),
    publisher_count:available,
    sources:sources.map(s=>Object.freeze(s)),
    items:links.slice(0,MAX_ITEMS),
    persisted:false as const,
    full_articles_downloaded:false as const,
    story_text_republished:false as const,
    semantic_grouping_performed:false as const,
    contradictions_generated:false as const,
    independent_events_claimed:0 as const,
  });
}
export async function fetchChileRssChronology(now=new Date()) {
  const [day,coop]=await Promise.allSettled([
    latestChileRssLinkedHeadlines(now),
    latestChileRssLinkPreview(now),
  ]);
  return composeChileRssChronology(day,coop,now);
}
