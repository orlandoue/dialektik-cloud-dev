import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const REGISTRY='app/assets/source-universe/candidate-registry.v1.json';
const AGENT='DialektikBetaSourcePreflight/1.0';
const TIMEOUT_MS=7000;
const MAX_ROBOTS_BYTES=65536;
const GROUP_SIZE=4;

export function validateInventory(json) {
  if (json.schemaVersion !== 1 || json.candidateCount !== 50 ||
      json.distinctDomainCount !== 50 || !Array.isArray(json.candidates) ||
      json.candidates.length !== 50) throw Error('INVENTORY_NOT_50');
  const domains=new Set();
  return json.candidates.map((entry,index)=>{
    const domain=entry?.identity?.canonicalDomain;
    const name=entry?.identity?.publisherName;
    const endpoint=entry?.discovery?.endpointCandidate;
    if(typeof domain!=='string' ||
      !/^[a-z0-9][a-z0-9.-]{1,120}\.[a-z]{2,}$/u.test(domain) ||
      domain.includes('..') || domain.startsWith('localhost') ||
      typeof name !== 'string' || name.length < 2 ||
      (endpoint!==null && endpoint!==undefined &&
        (typeof endpoint !== 'string' || !endpoint.startsWith('https://'))) ||
      domains.has(domain) ||
      entry?.operational?.acquisitionEnabled !== false ||
      entry?.currentAssessment?.operational?.authorizationStatus !== 'NOT_AUTHORIZED' ||
      entry?.currentAssessment?.operational?.acquisitionEnabled !== false
    ) throw Error('INVENTORY_SOURCE_UNSAFE_'+index);
    domains.add(domain);
    return Object.freeze({name,domain,
      robotsUrl:'https://'+domain+'/robots.txt',
      endpointCandidatePresent:typeof endpoint==='string'});
  });
}
async function readLimitedBody(response) {
  if(!response.body)return '';
  const reader=response.body.getReader(),parts=[];
  let bytes=0;
  try {
    while(true){
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.byteLength;
      if(bytes>MAX_ROBOTS_BYTES) {await reader.cancel();throw Error('ROBOTS_TOO_LARGE');}
      parts.push(part.value);
    }
  }finally{reader.releaseLock();}
  const buf=new Uint8Array(bytes);let offset=0;
  for(const part of parts){buf.set(part,offset);offset+=part.length;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buf);}
  finally{buf.fill(0);}
}
/** Probe exactly one public robots URL per supplied vetted domain. */
export async function probeRobots(candidate, fetcher=fetch) {
  const base={name:candidate.name,domain:candidate.domain,
    robotsUrl:candidate.robotsUrl,endpointCandidatePresent:candidate.endpointCandidatePresent,
    robotsStatus:'UNVERIFIED',httpStatus:null,hasUserAgentSection:false,
    permissionGranted:false,metadataAcquisitionEnabled:false,articleBodiesFetched:0};
  try {
    const options={
      method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(TIMEOUT_MS),
      headers:{Accept:'text/plain','User-Agent':AGENT},
    };
    let res=await fetcher(candidate.robotsUrl,options);
    // Follow at most ONE HTTPS robots redirect, only to this same reviewed
    // publisher domain (optionally www), never to an external aggregator.
    if(res.status>=300 && res.status<400) {
      const location=res.headers.get('location');
      let next=null;
      try {if(location)next=new URL(location,candidate.robotsUrl);}catch{}
      const allowed=next &&
        next.protocol==='https:' && next.port==='' &&
        next.username==='' && next.password==='' &&
        (next.hostname===candidate.domain ||
         next.hostname==='www.'+candidate.domain) &&
        next.pathname==='/robots.txt' && next.search==='' && next.hash==='' &&
        next.href!==candidate.robotsUrl;
      await res.body?.cancel();
      if(!allowed)return {...base,robotsStatus:'REDIRECT_REVIEW_REQUIRED',
        httpStatus:res.status};
      res=await fetcher(next.href,options);
    }
    const status=res.status;
    if(!Number.isInteger(status))throw Error('NOT_HTTP');
    base.httpStatus=status;
    if(status>=300&&status<400) {
      await res.body?.cancel();
      return {...base,robotsStatus:'REDIRECT_REVIEW_REQUIRED'};
    }
    if(status===404||status===410) {
      await res.body?.cancel();
      return {...base,robotsStatus:'NOT_PUBLISHED'};
    }
    if(status!==200) {
      await res.body?.cancel();
      return {...base,robotsStatus:'HTTP_REVIEW_REQUIRED'};
    }
    const declared=res.headers.get('content-length');
    if(declared && (!/^\d+$/u.test(declared) ||
        Number(declared)>MAX_ROBOTS_BYTES)) {
      await res.body?.cancel();
      return {...base,robotsStatus:'ROBOTS_TOO_LARGE'};
    }
    const text=await readLimitedBody(res);
    if(/<!doctype|<html|<head|<body/i.test(text) ||
       res.headers.get('content-type')?.includes('text/html')) {
      return {...base,robotsStatus:'HTML_SOFT_ERROR'};
    }
    if(!/^\s*user-agent\s*:/mi.test(text)) {
      return {...base,robotsStatus:'NO_USABLE_RULES'};
    }
    return {...base,robotsStatus:'TEXT_RULES_REQUIRE_MANUAL_REVIEW',
      hasUserAgentSection:true};
  }catch {
    return {...base,robotsStatus:'NETWORK_REVIEW_REQUIRED'};
  }
}
export async function preflight(candidates,fetcher=fetch) {
  const results=new Array(candidates.length);
  let next=0;
  async function worker(){
    for(;;){
      const index=next++;
      if(index>=candidates.length)return;
      results[index]=await probeRobots(candidates[index],fetcher);
    }
  }
  await Promise.all(Array.from({length:Math.min(GROUP_SIZE,candidates.length)},()=>worker()));
  return {schema:'dialektik-50-publisher-technical-preflight-v1',
    generatedAt:new Date().toISOString(),count:results.length,
    checkedRobots:results.length,publisherRightsApproved:0,
    acquisitionEnabled:0,newsPublished:0,dbWrites:0,
    statement:'Technical accessibility is NOT a reuse license or authorization to crawl.',
    summary:Object.fromEntries([...new Set(results.map(x=>x.robotsStatus))].sort().map(
      status=>[status,results.filter(x=>x.robotsStatus===status).length])),
    results};
}
const invoked =process.argv[1]?.endsWith('/chile-50-source-access-preflight.mjs');
if(invoked){
  const catalog=JSON.parse(readFileSync(REGISTRY,'utf8'));
  const candidates=validateInventory(catalog);
  const report=await preflight(candidates);
  mkdirSync('artifacts',{recursive:true});
  writeFileSync('artifacts/chile-50-technical-preflight.json',JSON.stringify(report,null,2)+'\n');
  const rows=[
    '# Dialektik: 50 medios — preflight técnico de robots',
    '',
    'Se comprobaron únicamente URLs /robots.txt. No se consultaron noticias, cuerpos, RSS, sitemaps ni endpoints de titulares.',
    '**Ninguna fuente queda habilitada por esta prueba.**',
    '',
    '| Resultado | Cantidad |','|---|---:|',
    ...Object.entries(report.summary).map(([name,num])=>'| '+name+' | '+num+' |'),
    '| **Total** | **'+report.count+'** |',
    '',
    '| Medio | Dominio | Estado del preflight |',
    '|---|---|---|',
    ...report.results.map(row=>'| '+row.name.replace(/\|/g,'')+' | '+row.domain+' | '+row.robotsStatus+' |'),
    '',
    'Resultado operativo: 0 medios con derechos autorizados, 0 publicaciones, 0 escrituras SQL.',
  ];
  writeFileSync('artifacts/chile-50-technical-preflight.md',rows.join('\n')+'\n');
  process.stdout.write(JSON.stringify({count:report.count,summary:report.summary,
    licenses:report.publisherRightsApproved,acquisition:report.acquisitionEnabled,
    dbWrites:report.dbWrites})+'\n');
}
