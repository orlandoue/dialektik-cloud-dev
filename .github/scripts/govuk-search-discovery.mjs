// Official GOV.UK new-URL discovery, single publisher, READ ONLY, no SQL.
import { resolve, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { planRightsGatedMetadata } from '../../services/core-api/dist/live/rights-gated-metadata-stage.js';
import { govUkRobotsAllowsPath, GOVUK_RSH_RIGHTS_REVIEWED_AT } from '../../services/core-api/dist/live/govuk-product-acquisition.js';
const ORIGIN='https://www.gov.uk';
const SEARCH=ORIGIN+'/api/search.json?filter_organisations=regulator-of-social-housing&count=40&order=-public_timestamp&fields=link,title,public_timestamp';
const SOURCE='govuk_rsh_official';
const MAX=5;
const reject=(code)=>{throw Error(code)};
async function get(fetcher,url,mime,limit){
  const response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'DialektikProductMetadata/1.0',Accept:mime}});
  if(response.status!==200||!response.headers.get('content-type')?.toLowerCase().includes(mime)||(response.url&&response.url!==url)){await response.body?.cancel();reject('DISCOVERY_RESPONSE_DENIED')}
  const claimed=response.headers.get('content-length');
  if(claimed!==null&&(!/^\d+$/u.test(claimed)||Number(claimed)>limit))reject('DISCOVERY_BYTES_EXCEEDED');
  if(!response.body)reject('DISCOVERY_EMPTY_RESPONSE');
  const stream=response.body.getReader();const chunks=[];let total=0;
  try{while(true){const x=await stream.read();if(x.done)break;total+=x.value.byteLength;if(total>limit){await stream.cancel();reject('DISCOVERY_BYTES_EXCEEDED')}chunks.push(x.value)}}
  finally{stream.releaseLock()}
  return Buffer.concat(chunks.map(x=>Buffer.from(x)),total);
}
function asJson(buf){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf))}catch{reject('DISCOVERY_JSON_INVALID')}finally{buf.fill(0)}}
function timestamp(v,at,nullable=false){
  if(nullable&&(v===null||v===undefined))return null;
  if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(v))reject('DISCOVERY_DATE_INVALID');
  const d=new Date(v);if(!Number.isFinite(d.getTime())||d>at)reject('DISCOVERY_DATE_INVALID');
  return d.toISOString();
}
function verifyMetadata(raw,path,at){
  if(!raw||raw.base_path!==path||raw.schema_name!=='news_article'||raw.document_type!=='press_release'||raw.locale&&raw.locale!=='en'||
    !Array.isArray(raw.links?.organisations)||!raw.links.organisations.some(x=>x?.title==='Regulator of Social Housing')||
    typeof raw.content_id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(raw.content_id))reject('DISCOVERY_PUBLISHER_INVALID');
  if(raw.details&&typeof raw.details==='object')raw.details.body='';
  if(typeof raw.title!=='string'||!raw.title.trim()||raw.title!==raw.title.trim()||raw.title.length>1024||/[\u0000-\u001f\u007f]/u.test(raw.title))reject('DISCOVERY_TITLE_INVALID');
  const publishedAt=timestamp(raw.first_published_at,at);
  const modifiedAt=timestamp(raw.public_updated_at,at,true);
  if(modifiedAt&&modifiedAt<publishedAt)reject('DISCOVERY_DATE_INVALID');
  return {sourceId:SOURCE,sourceItemId:raw.content_id,canonicalUrl:ORIGIN+path,title:raw.title,publishedAt,modifiedAt};
}
export async function discoverGovUkRshNews({fetcher=fetch,at=new Date(),previous=[]}={}){
  const reviewed=Date.parse(GOVUK_RSH_RIGHTS_REVIEWED_AT);
  if(!Number.isFinite(at.getTime())||!Number.isFinite(reviewed)||at.getTime()<reviewed||at.getTime()-reviewed>30*86400000)reject('DISCOVERY_RIGHTS_EXPIRED');
  const bytes=await get(fetcher,ORIGIN+'/robots.txt','text/plain',512*1024);
  const robots=new TextDecoder('utf-8',{fatal:true}).decode(bytes);bytes.fill(0);
  if(!govUkRobotsAllowsPath(robots,'/api/search.json'))reject('DISCOVERY_ROBOTS_SEARCH_DENIED');
  const search=asJson(await get(fetcher,SEARCH,'application/json',768*1024));
  if(!Array.isArray(search?.results)||search.results.length>40)reject('DISCOVERY_SEARCH_SCHEMA_INVALID');
  const paths=[];
  for(const item of search.results){
    if(typeof item?.link!=='string')reject('DISCOVERY_SEARCH_SCHEMA_INVALID');
    if(!item.link.startsWith('/government/news/'))continue;
    if(!/^\/government\/news\/[a-z0-9-]+$/u.test(item.link))reject('DISCOVERY_LINK_INVALID');
    if(!paths.includes(item.link))paths.push(item.link);
    if(paths.length===MAX)break;
  }
  if(!paths.length)reject('DISCOVERY_NO_NEWS_CANDIDATES');
  const candidates=[];
  for(const path of paths){
    const api=ORIGIN+'/api/content'+path;
    if(!govUkRobotsAllowsPath(robots,new URL(api).pathname))reject('DISCOVERY_ROBOTS_CONTENT_DENIED');
    const content=asJson(await get(fetcher,api,'application/json',5*1024*1024));
    candidates.push(verifyMetadata(content,path,at));
  }
  const policy={sourceId:SOURCE,publisherId:'regulator_of_social_housing',canonicalOrigin:ORIGIN,reviewedPathPrefix:'/government/news/',
    rightsDecisionId:'govuk-oglv3-20261015',rightsEvidenceUrl:'https://www.gov.uk/help/terms-conditions',
    rightsReviewedAt:GOVUK_RSH_RIGHTS_REVIEWED_AT,robotsCheckedAt:at.toISOString(),
    acquisitionApproved:true,metadataRetentionApproved:true,robotsAllowsPlannedPath:true,maxItemsPerBatch:MAX};
  const plan=planRightsGatedMetadata([policy],candidates,previous,at);
  return {schema:'dialektik-rsh-discovery-readonly-v1',discovery_endpoint:'GOVUK_PUBLIC_SEARCH_API',unsupported_search_api:true,
    publisher_count:1,checked_at:at.toISOString(),plan,article_bodies_saved:false,database_writes:0,events_generated:0,contradictions_generated:0,production_permission:false};
}
async function main(){
  if(process.env.DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.DIALEKTIK_GOVUK_ACQUISITION_DATABASE_URL)reject('DISCOVERY_DB_SECRETS_FORBIDDEN');
  const output=process.env.DIALEKTIK_DISCOVERY_OUTPUT;
  if(!output||!resolve(output).startsWith(resolve(process.env.RUNNER_TEMP||'/tmp')+'/'))reject('DISCOVERY_OUTPUT_OUT_OF_SCOPE');
  const result=await discoverGovUkRshNews();
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('GOVUK_RSH_CANDIDATES='+result.plan.items.length+'; SOURCE_COUNT=1; DB_WRITES=0; EVENTS=0; CONTRADICTIONS=0');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href)
  main().catch(e=>{console.error('DISCOVERY_FAIL_CLOSED',e.message);process.exitCode=1});
