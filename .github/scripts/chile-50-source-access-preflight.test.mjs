import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateInventory,probeRobots,preflight} from './chile-50-source-access-preflight.mjs';
const catalog=JSON.parse(readFileSync('app/assets/source-universe/candidate-registry.v1.json'));
test('all fifty audited candidates retained as non-operational',()=>{
 const items=validateInventory(catalog);
 assert.equal(items.length,50);
 assert.equal(new Set(items.map(x=>x.domain)).size,50);
 assert.ok(items.every(x=>x.robotsUrl==='https://'+x.domain+'/robots.txt'));
});
test('invented authorization and duplicate domains fail closed',()=>{
 const clone=JSON.parse(JSON.stringify(catalog));
 clone.candidates[0].currentAssessment.operational.acquisitionEnabled=true;
 assert.throws(()=>validateInventory(clone),/INVENTORY_SOURCE_UNSAFE/);
 const d=JSON.parse(JSON.stringify(catalog));
 d.candidates[1].identity.canonicalDomain=d.candidates[0].identity.canonicalDomain;
 assert.throws(()=>validateInventory(d),/INVENTORY_SOURCE_UNSAFE/);
});
test('robots-only probes do not fetch media or license them',async()=>{
 const two=validateInventory(catalog).slice(0,2);
 const called=[];
 const fetcher=async(url,opt)=>{
   called.push({url,opt});
   return new Response('User-agent: *\nDisallow: /private\n',{status:200,
     headers:{'content-type':'text/plain'}});
 };
 const report=await preflight(two,fetcher);
 assert.equal(report.checkedRobots,2);
 assert.equal(report.publisherRightsApproved,0);
 assert.equal(report.acquisitionEnabled,0);
 assert.equal(report.newsPublished,0);
 assert.equal(report.dbWrites,0);
 assert.ok(called.every(x=>x.url.endsWith('/robots.txt')));
 assert.ok(called.every(x=>x.opt.redirect==='manual'));
 assert.ok(report.results.every(x=>x.robotsStatus==='TEXT_RULES_REQUIRE_MANUAL_REVIEW'));
 assert.ok(report.results.every(x=>!x.permissionGranted));
});
test('HTML soft 404 and redirects never count as authorization',async()=>{
 const candidate=validateInventory(catalog)[0];
 const soft=await probeRobots(candidate,async()=>new Response('<html>Error 404</html>',{
   status:200,headers:{'Content-Type':'text/html'}}));
 assert.equal(soft.robotsStatus,'HTML_SOFT_ERROR');
 const redirect=await probeRobots(candidate,async()=>new Response(null,{
   status:302,headers:{location:'https://elsewhere.example/robots.txt'}}));
 assert.equal(redirect.robotsStatus,'REDIRECT_REVIEW_REQUIRED');
 assert.equal(soft.permissionGranted,false);
 assert.equal(redirect.permissionGranted,false);
});

test('same-site www redirect reads robots but still does not grant permission',async()=>{
  const item=validateInventory(catalog)[0];
  let calls=0;
  const result=await probeRobots(item,async(url)=>{
    calls++;
    if(calls===1)return new Response(null,{status:301,
      headers:{location:'https://www.'+item.domain+'/robots.txt'}});
    assert.equal(url,'https://www.'+item.domain+'/robots.txt');
    return new Response('User-agent: *\nDisallow: /restricted',{
      status:200,headers:{'content-type':'text/plain'}});
  });
  assert.equal(calls,2);
  assert.equal(result.robotsStatus,'TEXT_RULES_REQUIRE_MANUAL_REVIEW');
  assert.equal(result.permissionGranted,false);
});
