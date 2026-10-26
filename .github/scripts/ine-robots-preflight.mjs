/**
 * ONE-SHOT official-source access preflight: robots + HEAD only.
 * Never downloads news articles, changes the database, or approves a license.
 */
const SOURCE = 'https://www.ine.gob.cl';
const USER_AGENT = 'DialektikProductMetadata';
function allowedByRobots(text, path) {
  // Fail closed on robots directives we cannot interpret conservatively.
  if (/^.*(?:crawl-delay|noindex|host):/im.test(text)) return null;
  const lines = text.split(/\r?\n/).map(s=>s.split('#')[0].trim());
  const groups = [];
  let agents=[],rules=[],started=false;
  function flush(){if(agents.length)groups.push({agents,rules}); agents=[];rules=[];started=false;}
  for(const line of lines) {
    if(!line){flush();continue;}
    const m=/^([\w-]+)\s*:\s*(.*)$/i.exec(line);
    if(!m) return null;
    const [,key,value]=m,k=key.toLowerCase();
    if(k==='user-agent'){
      if(started)flush();
      agents.push(value.toLowerCase());
    }else if(k==='allow'||k==='disallow'){
      if(!agents.length) return null;
      started=true;rules.push({kind:k,path:value});
    }else if(k==='sitemap'){continue;}
    else return null;
  }
  flush();
  const dedicated=groups.filter(g=>g.agents.includes(USER_AGENT.toLowerCase()));
  const applicable=dedicated.length?dedicated:groups.filter(g=>g.agents.includes('*'));
  if(applicable.length===0) return null; // manual review rather than infer
  let matching=[];
  for(const g of applicable)for(const rule of g.rules) {
    if(!rule.path) continue;
    if(/[?$*]/.test(rule.path)) return null;
    if(path.startsWith(rule.path))matching.push(rule);
  }
  matching.sort((a,b)=>b.path.length-a.path.length);
  return matching.length===0 ? true : matching[0].kind==='allow';
}
async function request(url, method='GET'){
 const response=await fetch(url,{method,redirect:'manual',
   headers:{'User-Agent':USER_AGENT+'/1.0 (research-only; contact admin)'},
   signal:AbortSignal.timeout(12000)});
 return response;
}
const result={schema:'dialektik-ine-preflight-v1', checkedAt:new Date().toISOString(),
source:'Instituto Nacional de Estadísticas de Chile',rightsUrl:SOURCE+'/terminos-de-uso-y-licencia-de-datos-abiertos',
robotsUrl:SOURCE+'/robots.txt',newsroomUrl:SOURCE+'/sala-de-prensa/noticias',
rightsLicenseCandidate:'CC BY-SA 4.0',robotStatus:'UNKNOWN',newsroomStatus:'NOT_QUERIED',
sourceApproved:false,metadataAcquisitionEnabled:false,dbWrites:0,headlinePublished:0};
try{
 const res=await request(result.robotsUrl);
 result.robotsHttpStatus=res.status;
 if(res.status===200 && res.url===result.robotsUrl) {
   const text=(await res.text()).slice(0,64000);
   const decision=allowedByRobots(text,'/sala-de-prensa/noticias');
   result.robotStatus=decision===true?'ALLOWED_AT_PREFLIGHT':decision===false?'DISALLOWED':'REQUIRES_MANUAL_PARSER_REVIEW';
   if(decision===true){
      const head=await request(result.newsroomUrl,'HEAD');
      result.newsroomHttpStatus=head.status;
      result.newsroomStatus=head.status===200&&head.url===result.newsroomUrl?'HEAD_OK':'UNVERIFIED';
   }
 } else result.robotStatus='ROBOTS_NOT_FETCHED';
}catch(e){result.robotStatus='UNAVAILABLE_OR_UNVERIFIED';result.errorName=e?.name||'unknown';}
process.stdout.write(JSON.stringify(result,null,2)+'\n');
