import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverGovUkRshNews} from './govuk-search-discovery.mjs';
const at=new Date('2026-10-21T03:00:00.000Z'),a='/government/news/rsh-new-announcement-a',b='/government/news/rsh-new-announcement-b';
function mock({robots='User-agent: *\nAllow: /\n',links=[a,b],publisher='Regulator of Social Housing'}={}){
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push([url,init]);
    if(url.endsWith('/robots.txt'))return new Response(robots,{headers:{'content-type':'text/plain'}});
    if(url.includes('/api/search.json'))return new Response(JSON.stringify({results:links.map(link=>({link}))}),{headers:{'content-type':'application/json'}});
    const path=new URL(url).pathname.replace('/api/content','');
    const body={base_path:path,schema_name:'news_article',document_type:'press_release',locale:'en',
      links:{organisations:[{title:publisher}]},content_id:path===a?'123e4567-e89b-12d3-a456-426614174000':'123e4567-e89b-12d3-a456-426614174001',
      title:path===a?'First real news title':'Second real news title',first_published_at:'2026-10-20T09:00:00Z',public_updated_at:null,details:{body:'DO NOT PERSIST ME'}};
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
  return {fetcher,calls};
}
test('discover new paths and verify original publisher, no DB or event authority',async()=>{
  const {fetcher,calls}=mock();const x=await discoverGovUkRshNews({fetcher,at});
  assert.equal(x.plan.items.length,2);assert.deepEqual(x.plan.counts,{new:2,updated:0,unchanged:0});
  assert.equal(x.database_writes,0);assert.equal(x.events_generated,0);assert.equal(x.contradictions_generated,0);
  assert(!JSON.stringify(x).includes('DO NOT PERSIST ME'));
  assert.equal(calls.length,4);assert(calls.every(([url,init])=>init.method==='GET'&&init.redirect==='error'&&url.startsWith('https://www.gov.uk/')));
  const previous=x.plan.items.map(i=>({sourceId:i.sourceId,sourceItemId:i.sourceItemId,canonicalUrl:i.canonicalUrl,metadataHash:i.metadataHash}));
  assert.deepEqual((await discoverGovUkRshNews({fetcher,at,previous})).plan.counts,{new:0,updated:0,unchanged:2});
});
test('deny disallowed robots before content fetch',async()=>{
  const {fetcher,calls}=mock({robots:'User-agent: *\nDisallow: /api/\n'});
  await assert.rejects(discoverGovUkRshNews({fetcher,at}),/DISCOVERY_ROBOTS_SEARCH_DENIED/);assert.equal(calls.length,1);
});
test('source identity spoof fails closed',async()=>{
  const {fetcher}=mock({publisher:'Unrelated newsroom'});
  await assert.rejects(discoverGovUkRshNews({fetcher,at}),/DISCOVERY_PUBLISHER_INVALID/);
});
test('malicious path and stale review fail closed',async()=>{
  const x=mock({links:['/government/news/../../secrets']});
  await assert.rejects(discoverGovUkRshNews({fetcher:x.fetcher,at}),/DISCOVERY_LINK_INVALID/);
  await assert.rejects(discoverGovUkRshNews({fetcher:x.fetcher,at:new Date('2026-12-01T00:00:00.000Z')}),/DISCOVERY_RIGHTS_EXPIRED/);
});
