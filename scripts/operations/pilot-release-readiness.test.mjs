import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRuntime, releaseDecision, DEV_ORIGIN } from './pilot-release-readiness.mjs';

function fakeFetch(statusByPath) {
  const requests=[];
  const fn=async (url, init) => {
    const parsed=new URL(url);
    requests.push({ url, init });
    if (parsed.origin !== DEV_ORIGIN) throw Error('not allowed');
    const status=statusByPath[parsed.pathname];
    if(status===undefined) throw Error('missing test response');
    return { status, text(){ throw Error('PROTECTED_BODY_MUST_NOT_BE_READ'); },
                    json(){ throw Error('PROTECTED_BODY_MUST_NOT_BE_READ'); } };
  };
  return { fn, requests };
}

const okStatuses={
  '/health/live':200,
  '/health/ready':200,
  '/v1/feed':401,
  '/v1/contradictions':401,
  '/live/preview/govuk':401,
  '/live/preview/events/chile-tornado':401,
};

test('healthy DEV runtime is a guarded private pilot, NEVER public release',async()=>{
  const {fn,requests}=fakeFetch(okStatuses);
  const result=await inspectRuntime(fn);
  assert.equal(result.status,'PASS');
  assert.equal(result.unauthenticated_private_routes_all_401,true);
  assert.equal(result.protected_payloads_read,false);
  assert.equal(result.database_writes,0);
  assert.equal(requests.length,6);
  for(const {init} of requests){
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'manual');
    assert.equal(init.headers.Accept,'application/json');
    assert.equal(init.headers.Authorization,undefined);
  }
  const decision=releaseDecision({runtime:result});
  assert.equal(decision.release_status,'NO_GO_PUBLIC_LAUNCH');
  assert.equal(decision.public_marketing_authorization,false);
  assert.equal(decision.autonomous_multi_source_ingestion,'NOT_VERIFIED');
});

test('protected event preview accidentally accessible to public is NO_GO',async()=>{
  const {fn}=fakeFetch({...okStatuses,'/live/preview/events/chile-tornado':200});
  const result=await inspectRuntime(fn);
  assert.equal(result.status,'NO_GO');
  assert.equal(result.unauthenticated_private_routes_all_401,false);
  assert.equal(releaseDecision({runtime:result}).public_marketing_authorization,false);
});

test('if feed or contradictions leaks without credentials, stop the pilot readiness gate',async()=>{
  for(const path of ['/v1/feed','/v1/contradictions']) {
    const {fn}=fakeFetch({...okStatuses,[path]:200});
    assert.equal((await inspectRuntime(fn)).status,'NO_GO');
  }
});

test('database degraded yields NO_GO, no false alarm about autonomous events',async()=>{
  const {fn}=fakeFetch({...okStatuses,'/health/ready':503});
  const result=await inspectRuntime(fn);
  assert.equal(result.status,'NO_GO');
  assert.equal(releaseDecision({runtime:result}).persisted_event_grouping,'NOT_VERIFIED');
});

test('HTTP error or network timeout must not be interpreted as healthy',async()=>{
  const {fn}=fakeFetch({...okStatuses,'/health/live':502});
  assert.equal((await inspectRuntime(fn)).status,'NO_GO');
  const fail=async()=>{throw new Error('Connection could not be established')};
  const result=await inspectRuntime(fail);
  assert.equal(result.status,'NO_GO');
  assert.equal(result.health_live_status,null);
});

test('readiness result cannot grant launch approval even if runtime reports PASS',()=>{
  const fake={status:'PASS',unauthenticated_private_routes_all_401:true};
  const d=releaseDecision({runtime:fake});
  assert.equal(d.release_status,'NO_GO_PUBLIC_LAUNCH');
  assert.equal(d.evidence_backed_contradictions,'NOT_VERIFIED');
  assert.equal(d.disaster_recovery,'NOT_VERIFIED');
  assert.equal(d.flutter_store_distribution,'NOT_VERIFIED');
});

test('missing runtime check is never reported as deployment verification',()=>{
  const d=releaseDecision();
  assert.equal(d.authenticated_private_beta,'RUNTIME_NOT_VERIFIED');
  assert.equal(d.release_status,'NO_GO_PUBLIC_LAUNCH');
});
