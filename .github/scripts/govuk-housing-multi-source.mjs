// GOV.UK two-original-publisher discovery: bounded live API proof, no database or semantic writes.
// The RSH adapter is separately proven; the additional housing-ministry publication is
// verified against the official Content API, never inferred from a Search API hit alone.
import {resolve,dirname} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadPreviousDiscoveryReceipt} from './govuk-incremental-receipt.mjs';
import {discoverGovUkRshNews} from './govuk-search-discovery.mjs';
import {planRightsGatedMetadata} from '../../services/core-api/dist/live/rights-gated-metadata-stage.js';
import {govUkRobotsAllowsPath} from '../../services/core-api/dist/live/govuk-product-acquisition.js';

const ORIGIN='https://www.gov.uk';
const MINISTRY='Ministry of Housing, Communities and Local Government';
const MHCLG_SOURCE='govuk_mhclg_official';
const SEARCH=ORIGIN+'/api/search.json?filter_organisations=ministry-of-housing-communities-local-government&count=40&order=-public_timestamp&fields=link,title,public_timestamp';
const TERMS='https://www.gov.uk/help/terms-conditions';
const RIGHTS_REVIEW='2026-10-21T00:00:00.000Z';
const MAX_MINISTRY=5;
const MAX_BYTES=5*1024*1024;
function deny(code){throw Error(code)}
async function boundedGet(fetcher,url,ctype,maxBytes){
  const res=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000),
    headers:{'User-Agent':'DialektikProductMetadata/1.0',Accept:ctype}});
  if(res.status!==200||!res.headers.get('content-type')?.toLowerCase().includes(ctype)||res.url&&res.url!==url){
    await res.body?.cancel();deny('MULTISOURCE_RESPONSE_DENIED');
  }
  const declared=res.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/u.test(declared)||Number(declared)>maxBytes))deny('MULTISOURCE_BYTES_DENIED');
  if(!res.body)deny('MULTISOURCE_EMPTY_RESPONSE');
  const reader=res.body.getReader();let count=0;const buffers=[];
  try{while(true){const item=await reader.read();if(item.done)break;count+=item.value.byteLength;
      if(count>maxBytes){await reader.cancel();deny('MULTISOURCE_BYTES_DENIED')}buffers.push(item.value)}}
  finally{reader.releaseLock()}
  return Buffer.concat(buffers.map(x=>Buffer.from(x)),count);
}
function jsonAndDispose(bytes){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
  catch{deny('MULTISOURCE_INVALID_JSON')}
  finally{bytes.fill(0)}
}
function instant(value,now,nullable=false){
  if(nullable&&(value===undefined||value===null))return null;
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(value))deny('MULTISOURCE_INVALID_TIMESTAMP');
  const t=new Date(value);
  if(!Number.isFinite(t.getTime())||t>now)deny('MULTISOURCE_INVALID_TIMESTAMP');
  return t.toISOString();
}
function verifyMinistryMetadata(data,path,now){
  if(!data||data.base_path!==path||data.schema_name!=='news_article'||data.document_type!=='press_release'||
    data.locale&&data.locale!=='en'||!Array.isArray(data.links?.organisations)||
    !data.links.organisations.some(o=>o?.title===MINISTRY)||
    typeof data.content_id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(data.content_id))deny('MULTISOURCE_MINISTRY_ORIGIN_DENIED');
  if(typeof data.title!=='string'||/[\u0000-\u0008\u000e-\u001f\u007f]/u.test(data.title))deny('MULTISOURCE_MINISTRY_TITLE_INVALID');
  const headline=data.title.replace(/\s+/gu,' ').trim().normalize('NFC');
  if(!headline||Array.from(headline).length>1024||/[\u0000-\u001f\u007f]/u.test(headline))deny('MULTISOURCE_MINISTRY_TITLE_INVALID');
  const publishedAt=instant(data.first_published_at,now);
  const modifiedAt=instant(data.public_updated_at,now,true);
  if(modifiedAt!==null&&modifiedAt<publishedAt)deny('MULTISOURCE_MINISTRY_TIMESTAMP_ORDER');
  return {sourceId:MHCLG_SOURCE,sourceItemId:data.content_id,canonicalUrl:ORIGIN+path,title:headline,publishedAt,modifiedAt};
}
export async function discoverGovUkHousingPublishers({fetcher=fetch,at=new Date(),previous=[]}={}){
  if(!Number.isFinite(at.getTime())||at.getTime()<Date.parse(RIGHTS_REVIEW)||at.getTime()-Date.parse(RIGHTS_REVIEW)>30*86400000)
    deny('MULTISOURCE_RIGHTS_REVIEW_EXPIRED');
  // RSH discovery has its own official Content API identity and rights validation.
  const rsh=await discoverGovUkRshNews({fetcher,at,previous});
  const robotsBytes=await boundedGet(fetcher,ORIGIN+'/robots.txt','text/plain',512*1024);
  const robots=new TextDecoder('utf-8',{fatal:true}).decode(robotsBytes);robotsBytes.fill(0);
  if(!govUkRobotsAllowsPath(robots,'/api/search.json'))deny('MULTISOURCE_SEARCH_ROBOTS_DENIED');
  const results=jsonAndDispose(await boundedGet(fetcher,SEARCH,'application/json',768*1024));
  if(!Array.isArray(results?.results)||results.results.length>40)deny('MULTISOURCE_SEARCH_SCHEMA_INVALID');
  const priorUrls=new Set(rsh.plan.items.map(x=>x.canonicalUrl));
  const paths=[];
  for(const hit of results.results){
    if(typeof hit?.link!=='string')deny('MULTISOURCE_SEARCH_SCHEMA_INVALID');
    if(!hit.link.startsWith('/government/news/'))continue;
    if(!/^\/government\/news\/[a-z0-9-]+$/u.test(hit.link))deny('MULTISOURCE_SEARCH_LINK_INVALID');
    if(priorUrls.has(ORIGIN+hit.link)||paths.includes(hit.link))continue;
    paths.push(hit.link);
    if(paths.length>=MAX_MINISTRY)break;
  }
  if(paths.length===0)deny('MULTISOURCE_NO_INDEPENDENT_MINISTRY_ITEMS');
  const ministry=[];
  for(const path of paths){
    if(!govUkRobotsAllowsPath(robots,'/api/content'+path))deny('MULTISOURCE_CONTENT_ROBOTS_DENIED');
    const item=jsonAndDispose(await boundedGet(fetcher,ORIGIN+'/api/content'+path,'application/json',MAX_BYTES));
    ministry.push(verifyMinistryMetadata(item,path,at));
  }
  const policy={sourceId:MHCLG_SOURCE,publisherId:'ministry_housing_communities',canonicalOrigin:ORIGIN,
    reviewedPathPrefix:'/government/news/',rightsDecisionId:'govuk-oglv3-mhclg-20261021',rightsEvidenceUrl:TERMS,
    rightsReviewedAt:RIGHTS_REVIEW,robotsCheckedAt:at.toISOString(),
    acquisitionApproved:true,metadataRetentionApproved:true,robotsAllowsPlannedPath:true,maxItemsPerBatch:MAX_MINISTRY};
  const mhclg=planRightsGatedMetadata([policy],ministry,previous.filter(x=>x.sourceId===MHCLG_SOURCE),at);
  if(new Set([...rsh.plan.items,...mhclg.items].map(x=>x.canonicalUrl)).size!==rsh.plan.items.length+mhclg.items.length)
    deny('MULTISOURCE_SHARED_CANONICAL_URL');
  return Object.freeze({schema:'dialektik-govuk-housing-two-publisher-readonly-v1',checkedAt:at.toISOString(),
    publishers:['Regulator of Social Housing',MINISTRY],publisherCount:2,
    items:Object.freeze([...rsh.plan.items,...mhclg.items]),
    counts:{new:rsh.plan.counts.new+mhclg.counts.new,updated:rsh.plan.counts.updated+mhclg.counts.updated,
      unchanged:rsh.plan.counts.unchanged+mhclg.counts.unchanged},
    sourceIdentitiesVerified:true,independentCanonicalUrls:true,
    officialSearchApiNotGuaranteed:true,bodyPersisted:false,databaseWrites:0,eventsGenerated:0,
    contradictionsGenerated:0,publicLaunchAuthority:false});
}
async function main(){
  if(process.env.DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.DIALEKTIK_GOVUK_ACQUISITION_DATABASE_URL)
    deny('MULTISOURCE_DB_SECRETS_FORBIDDEN');
  const out=process.env.DIALEKTIK_MULTI_DISCOVERY_OUTPUT;
  const temp=resolve(process.env.RUNNER_TEMP||'/tmp');
  if(typeof out!=='string'||!resolve(out).startsWith(temp+'/'))deny('MULTISOURCE_OUTPUT_DENIED');
  const now=new Date();
  const stateFile=process.env.DIALEKTIK_PREVIOUS_DISCOVERY_RECEIPT;
  if(stateFile!==undefined&&!resolve(stateFile).startsWith(temp+'/'))deny('MULTISOURCE_HISTORY_OUT_OF_SCOPE');
  const {previous,continuity}=await loadPreviousDiscoveryReceipt(stateFile,now);
  const result=await discoverGovUkHousingPublishers({at:now,previous});
  const receipt={...result,comparisonMode:continuity,
    publicationFreshnessEstablished:false,completeHistoricalLedger:false};
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('TWO_GOVUK_PUBLISHERS_VERIFIED=2; METADATA_CANDIDATES='+receipt.items.length+'; COMPARISON='+receipt.comparisonMode+'; STATUS_NEW='+receipt.counts.new+'; STATUS_UPDATED='+receipt.counts.updated+'; STATUS_UNCHANGED='+receipt.counts.unchanged+'; DB_WRITES=0; EVENTS=0; CONTRADICTIONS=0');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href)
  main().catch(e=>{console.error('GOVUK_TWO_PUBLISHER_FAIL_CLOSED',e.message);process.exitCode=1});
