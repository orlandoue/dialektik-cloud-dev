import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchChileUsgsObservations} from '../dist/live/chile-usgs-seismic-observations.js';

const url='https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
const fixed = new Date('2026-10-26T21:00:00.000Z');
function feature(id, place='50 km W of Valparaíso, Chile',updated=Date.parse('2026-10-26T19:01:00Z')) {
 return {type:'Feature',id,properties:{
   mag:4.2,place,time:Date.parse('2026-10-26T19:00:00Z'),updated,
   url:'https://earthquake.usgs.gov/earthquakes/eventpage/'+id,
   type:'earthquake',status:'reviewed'},
  geometry:{type:'Point',coordinates:[-72.1743,-33.0605,19.048]}};
}
function feed(features) {
 return {type:'FeatureCollection',metadata:{generated:fixed.getTime(),
    url,status:200,count:features.length},features};
}
function mock(payload,opts={}) {
 return async (requested,init)=>{
   assert.equal(requested,url);
   assert.equal(init.method,'GET');
   assert.equal(init.redirect,'error');
   assert.equal(init.credentials,'omit');
   assert.ok(init.headers['User-Agent'].includes('Dialektik'));
   return new Response(JSON.stringify(payload),{
     status:opts.status??200,
     headers:{'Content-Type':opts.mime??'application/geo+json'},
   });
 };
}
test('returns genuine-looking official observation only from one source',async()=>{
 const data=await fetchChileUsgsObservations(mock(feed([
  feature('us6000u4x2'),feature('us6000u4x3','5 km NW of Geysers, California'),
 ])),fixed);
 assert.equal(data.mode,'OFFICIAL_LIVE_SEISMIC_OBSERVATIONS');
 assert.equal(data.items.length,1);
 assert.equal(data.items[0].observation_id,'us6000u4x2');
 assert.equal(data.items[0].occurrence_key,'usgs:earthquake:us6000u4x2');
 assert.equal(data.items[0].magnitude,4.2);
 assert.equal(data.items[0].source_status,'reviewed');
 assert.equal(data.items[0].independent_publisher_count,1);
 assert.equal(data.items[0].contradiction_count,0);
 assert.equal(data.cross_publisher_grouping,false);
 assert.equal(data.is_emergency_alert,false);
 assert.equal(data.persisted,false);
 assert.ok(data.rights_url.includes('usgs.gov'));
});
test('cannot merge two USGS ids just because location and magnitude match',async()=>{
 const data=await fetchChileUsgsObservations(mock(feed([
   feature('us6000u4x2'),feature('us6000u4x3')
 ])),fixed);
 assert.equal(data.items.length,2);
 assert.notEqual(data.items[0].occurrence_key,data.items[1].occurrence_key);
 assert.ok(data.items.every(item=>item.independent_publisher_count===1));
});
test('duplicate ids, spoofed canonical URL and wrong coordinates fail closed',async()=>{
 for(const invalid of [
  [feature('us6000u4x2'),feature('us6000u4x2')],
  [{...feature('us6000u4x2'),properties:{...feature('us6000u4x2').properties,url:'https://evil.example/earthquake'}}],
  [{...feature('us6000u4x2'),geometry:{type:'Point',coordinates:[-110,32,5]}}],
  [{...feature('us6000u4x2'),properties:{...feature('us6000u4x2').properties,updated:fixed.getTime()+60_000_000}}],
 ]) {
   await assert.rejects(fetchChileUsgsObservations(mock(feed(invalid)),fixed));
 }
});
test('transport and source metadata cannot be spoofed',async()=>{
 await assert.rejects(fetchChileUsgsObservations(mock(feed([feature('us6000u4x2')]),
   {mime:'text/html'}),fixed));
 await assert.rejects(fetchChileUsgsObservations(mock(feed([feature('us6000u4x2')]),
   {status:503}),fixed));
 const fake=feed([feature('us6000u4x2')]);
 fake.metadata.url='https://untrusted.example/feed.json';
 await assert.rejects(fetchChileUsgsObservations(mock(fake),fixed));
});
test('data are observations, not journalistic articles, corroborations or contradictions',async()=>{
 const result=await fetchChileUsgsObservations(mock(feed([feature('us6000u4x2')])),fixed);
 assert.equal(result.category,'OFFICIAL_OBSERVATIONS_NOT_NEWS');
 assert.equal(result.contradictions_generated,false);
 assert.equal(result.items[0].publisher_market,'US');
 assert.equal(result.items[0].location_context,'CHILE_USGS_LABEL_AND_BOUNDS');
 assert.equal(Object.hasOwn(result,'articles'),false);
 assert.equal(Object.hasOwn(result,'positions'),false);
});
