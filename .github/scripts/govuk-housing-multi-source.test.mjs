import assert from 'node:assert/strict';
import {test} from 'node:test';
import {discoverGovUkHousingPublishers} from './govuk-housing-multi-source.mjs';
const at=new Date('2026-10-21T06:00:00.000Z');
const r='/government/news/rsh-housing-release-a',m='/government/news/mhclg-housing-release-b';
function fixture({ministryName='Ministry of Housing, Communities and Local Government',shared=false,ministryTitle='Ministry housing safety announcement',robots='User-agent: *\nAllow: /\n'}={}){
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push([url,init]);
    if(url.endsWith('/robots.txt'))return new Response(robots,{headers:{'content-type':'text/plain'}});
    if(url.includes('/api/search.json'))return new Response(JSON.stringify({results:[{link:url.includes('ministry-of-housing')?(shared?r:m):r}]}),{headers:{'content-type':'application/json'}});
    const ministry=url.endsWith(m);
    const path=new URL(url).pathname.replace('/api/content','');
    const d={base_path:path,document_type:'press_release',schema_name:'news_article',locale:'en',
      links:{organisations:[{title:ministry?ministryName:'Regulator of Social Housing'}]},
      title:ministry?ministryTitle:'Regulator housing safety announcement',
      first_published_at:'2026-10-20T10:00:00Z',public_updated_at:null,
      content_id:ministry?'a23e4567-e89b-12d3-a456-426614174001':'a23e4567-e89b-12d3-a456-426614174000',
      details:{body:'NEVER DISCLOSE FULL TEXT'}};
    return new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}});
  };
  return {fetcher,calls};
}
test('two verified original publishers, distinct Article identities, no DB/semantic authority',async()=>{
  const {fetcher,calls}=fixture();
  const x=await discoverGovUkHousingPublishers({fetcher,at});
  assert.equal(x.publisherCount,2);assert.equal(x.items.length,2);
  assert.deepEqual(x.counts,{new:2,updated:0,unchanged:0});
  assert.notEqual(x.items[0].sourceId,x.items[1].sourceId);
  assert.equal(new Set(x.items.map(i=>i.canonicalUrl)).size,2);
  assert.equal(x.databaseWrites,0);assert.equal(x.eventsGenerated,0);assert.equal(x.contradictionsGenerated,0);
  assert(!JSON.stringify(x).includes('NEVER DISCLOSE FULL TEXT'));
  assert(calls.every(([url,init])=>url.startsWith('https://www.gov.uk/')&&init.method==='GET'&&init.redirect==='error'));
  const previous=x.items.map(i=>({sourceId:i.sourceId,sourceItemId:i.sourceItemId,canonicalUrl:i.canonicalUrl,metadataHash:i.metadataHash}));
  const replay=await discoverGovUkHousingPublishers({fetcher,at,previous});
  assert.deepEqual(replay.counts,{new:0,updated:0,unchanged:2});
});
test('normalize harmless publisher spacing and reject dangerous control characters',async()=>{
  const {fetcher}=fixture({ministryTitle:'  Ministry  housing'+String.fromCharCode(10)+' safety announcement  '});
  const x=await discoverGovUkHousingPublishers({fetcher,at});
  assert.equal(x.items.find(i=>i.sourceId==='govuk_mhclg_official').title,'Ministry housing safety announcement');
  const bad=fixture({ministryTitle:'bad'+String.fromCharCode(0)+'title'});
  await assert.rejects(discoverGovUkHousingPublishers({fetcher:bad.fetcher,at}),/MULTISOURCE_MINISTRY_TITLE_INVALID/);
});
test('reject claimed second publisher when official Content API identity differs',async()=>{
  const {fetcher}=fixture({ministryName:'Unrelated Publisher'});
  await assert.rejects(discoverGovUkHousingPublishers({fetcher,at}),/MULTISOURCE_MINISTRY_ORIGIN_DENIED/);
});
test('reject same GOV.UK canonical article as evidence for two independent publishers',async()=>{
  const {fetcher}=fixture({shared:true});
  await assert.rejects(discoverGovUkHousingPublishers({fetcher,at}),/MULTISOURCE_NO_INDEPENDENT_MINISTRY_ITEMS/);
});
test('reject denied robots and stale rights policy',async()=>{
  const {fetcher}=fixture({robots:'User-agent: *\nDisallow: /api/\n'});
  await assert.rejects(discoverGovUkHousingPublishers({fetcher,at}),/DISCOVERY_ROBOTS_SEARCH_DENIED/);
  await assert.rejects(discoverGovUkHousingPublishers({fetcher,at:new Date('2026-12-01T00:00:00Z')}),/MULTISOURCE_RIGHTS_REVIEW_EXPIRED/);
});
