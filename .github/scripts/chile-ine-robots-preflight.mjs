// Chile INE site robots preflight: NO page/article acquisition or persistence.
import {resolve} from 'node:path';
const ROBOTS='https://www.ine.gob.cl/robots.txt';
const PATHS=Object.freeze(['/sala-de-prensa/noticias','/sala-de-prensa/prensa/general']);
const USER_AGENT='DialektikNewsSourcePreflight/1.0';
function deny(code){throw new Error(code)}
export function allowByRobots(robots,path){
  if(typeof robots!=='string'||robots.length>262144||typeof path!=='string'||!path.startsWith('/'))deny('INE_ROBOTS_INVALID');
  const groups=[];let group=null;let sawRules=false;
  for(const text of robots.split(/\r?\n/u)){
    const line=text.split('#')[0].trim();
    if(!line)continue;
    const m=/^(user-agent|allow|disallow)\s*:\s*(.*?)\s*$/iu.exec(line);
    if(!m)continue;
    const key=m[1].toLowerCase(),value=m[2];
    if(key==='user-agent'){
      if(!group||sawRules){group={agents:[],rules:[]};groups.push(group);sawRules=false}
      group.agents.push(value.toLowerCase());
    }else if(group&&group.agents.length){
      sawRules=true;
      if(value!=='')group.rules.push({allow:key==='allow',path:value});
    }
  }
  const candidate=groups.filter(g=>g.agents.includes('dialektiknewssourcepreflight')||
    g.agents.includes('dialektiknewssourcepreflight/1.0'));
  const chosen=candidate.length?candidate:groups.filter(g=>g.agents.includes('*'));
  if(!chosen.length)deny('INE_ROBOTS_NO_APPLICABLE_GROUP');
  let best=null;
  for(const g of chosen)for(const rule of g.rules){
    // Only exact prefix rules are supported: ambiguous wildcards require review.
    if(rule.path.includes('*')||rule.path.includes('$'))deny('INE_ROBOTS_COMPLEX_RULE_REVIEW');
    if(path.startsWith(rule.path)&&(!best||rule.path.length>best.path.length||
      (rule.path.length===best.path.length&&rule.allow)))best=rule;
  }
  return best===null||best.allow;
}
export async function checkIneRobots({fetcher=fetch}={}){
  const response=await fetcher(ROBOTS,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(10000),headers:{'User-Agent':USER_AGENT,Accept:'text/plain'}});
  if(response.status!==200||response.url&&response.url!==ROBOTS||
    !response.headers.get('content-type')?.toLowerCase().includes('text/plain')){
    await response.body?.cancel();deny('INE_ROBOTS_NOT_VERIFIED');
  }
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>262144))deny('INE_ROBOTS_SIZE_INVALID');
  if(!response.body)deny('INE_ROBOTS_EMPTY');
  const reader=response.body.getReader();let total=0;const chunks=[];
  try{while(true){const x=await reader.read();if(x.done)break;total+=x.value.byteLength;
    if(total>262144){await reader.cancel();deny('INE_ROBOTS_SIZE_INVALID')}chunks.push(x.value)}}
  finally{reader.releaseLock()}
  const bytes=Buffer.concat(chunks.map(x=>Buffer.from(x)),total);
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
  finally{bytes.fill(0)}
  const allowed=PATHS.map(path=>allowByRobots(text,path));
  if(allowed.some(x=>x!==true))deny('INE_NEWS_ROBOTS_PATH_DENIED');
  return Object.freeze({schema:'dialektik-ine-robots-readonly-v1',site:'www.ine.gob.cl',
    checkedPaths:PATHS.length,pathsAllowed:allowed.length,rightsReference:'https://ineportaldpr.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos',
    robotsVerified:true,newsFetched:false,dbWrites:0,sourceActivated:false});
}
async function main(){
  if(process.env.DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.DIALEKTIK_GOVUK_ACQUISITION_DATABASE_URL)
    deny('INE_PREFLIGHT_DB_ENV_FORBIDDEN');
  const receipt=await checkIneRobots();
  console.log('INE_ROBOTS_VERIFIED='+receipt.robotsVerified+'; PATHS_ALLOWED='+receipt.pathsAllowed+
    '; NEWS_FETCHED=0; DB_WRITES=0; SOURCE_ENABLED=FALSE');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href)
  main().catch(e=>{console.error('INE_SOURCE_PREFLIGHT_STOP',e.message);process.exitCode=1});
