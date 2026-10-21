import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowByRobots,checkIneRobots} from './chile-ine-robots-preflight.mjs';
test('only exact reviewed news paths, no content requests or database writes',async()=>{
  const seen=[];
  const fetcher=async(url,init)=>{
    seen.push([url,init]);
    return new Response('User-agent: *\nDisallow: /private/\nAllow: /sala-de-prensa/\n',
      {headers:{'content-type':'text/plain'}});
  };
  const r=await checkIneRobots({fetcher});
  assert.equal(r.robotsVerified,true);assert.equal(r.pathsAllowed,2);assert.equal(r.dbWrites,0);
  assert.equal(r.newsFetched,false);assert.equal(r.sourceActivated,false);
  assert.deepEqual(seen.map(x=>x[0]),['https://www.ine.gob.cl/robots.txt']);
  assert.equal(seen[0][1].redirect,'error');
});
test('deny disallowed or ambiguous site rules without making new requests',async()=>{
  assert.equal(allowByRobots('User-agent: *\nDisallow: /sala-de-prensa/\n','/sala-de-prensa/noticias'),false);
  assert.throws(()=>allowByRobots('User-agent: *\nDisallow: /*\n','/sala-de-prensa/noticias'),/INE_ROBOTS_COMPLEX_RULE_REVIEW/);
});
test('custom user-agent rules take precedence over wildcard',()=>{
  const txt='User-agent: *\nAllow: /\nUser-agent: DialektikNewsSourcePreflight\nDisallow: /sala-de-prensa/\n';
  assert.equal(allowByRobots(txt,'/sala-de-prensa/noticias'),false);
});
test('404, HTML, redirects and oversized robots fail closed',async()=>{
  const cases=[new Response('',{status:404,headers:{'content-type':'text/plain'}}),
    new Response('<html></html>',{headers:{'content-type':'text/html'}}),
    new Response('User-agent: *\nAllow: /\n',{headers:{'content-type':'text/plain','content-length':'300000'}})];
  for(const response of cases)
    await assert.rejects(checkIneRobots({fetcher:async()=>response}),/INE_ROBOTS_NOT_VERIFIED|INE_ROBOTS_SIZE_INVALID/);
});
