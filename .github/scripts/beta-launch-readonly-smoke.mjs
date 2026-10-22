#!/usr/bin/env node
// Live, read-only probe of the existing Render DEV API. No credentials.
const origin='https://dialektik-core-dev.onrender.com';
const checks=[
 ['/health/live',200,'live','CORE_LIVENESS'],
 ['/health/ready',200,'ready','CORE_DB_READINESS'],
 ['/v1/feed',401,null,'BETA_FEED_AUTH_DENIAL'],
 ['/v1/contradictions',401,null,'BETA_CONTRADICTIONS_AUTH_DENIAL'],
 ['/live/news',401,null,'LIVE_NEWS_AUTH_DENIAL'],
 ['/live/preview/events/chile-tornado',401,null,'EDITORIAL_PREVIEW_AUTH_DENIAL'],
];
if(process.env.DIALEKTIK_BETA_SMOKE_ONLY!=='YES'||process.env.DATABASE_URL||
   process.env.SUPABASE_ACCESS_TOKEN||process.env.DIALEKTIK_API_TOKEN){
  console.error('BETA_SMOKE_ENVIRONMENT=FAIL_CLOSED');process.exit(1);
}
async function probe([path,expected,bodyStatus,label]){
  const url=new URL(path,origin);
  if(url.origin!==origin)throw Error('HOST_NOT_ALLOWLISTED');
  for(let retry=0;retry<3;retry++){
    try{
      const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(110000),
        headers:{Accept:'application/json','Cache-Control':'no-cache'}});
      if(response.status===503&&retry<2){await new Promise(r=>setTimeout(r,3000));continue;}
      if(response.status!==expected)throw Error('STATUS_MISMATCH');
      if(bodyStatus&& (await response.json())?.status!==bodyStatus)throw Error('BODY_MISMATCH');
      console.log(label+'=PASS');
      return;
    }catch(e){
      if(retry>=2 || e?.message==='STATUS_MISMATCH'||e?.message==='BODY_MISMATCH')throw e;
      await new Promise(r=>setTimeout(r,1500));
    }
  }
}
for(const c of checks){
  try{await probe(c);}catch{console.error(c[3]+'=FAIL_REDACTED');process.exitCode=1;break;}
}
if(process.exitCode!==1){
  console.log('PRIVATE_BETA_LIVE_API_NO_AUTH_SMOKE=PASS');
  console.log('SIGNED_APK_AND_USER_LOGIN=NOT_VERIFIED');
  console.log('AUTONOMOUS_INGESTION_OR_CONTRADICTIONS=NOT_VERIFIED');
  console.log('RENDER_AND_SUPABASE_CHANGES=0');
}
