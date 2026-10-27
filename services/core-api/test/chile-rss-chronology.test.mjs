import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composeChileRssChronology} from '../dist/live/chile-rss-chronology.js';

const now=new Date('2026-10-27T02:00:00.000Z');
const dayItem=(slug,date='2026-10-27T01:00:00.000Z')=>({
 id:'https://www.diarioeldia.cl/noticias/2026/10/26/'+slug,
 publisher:'Diario El Día',
 original_url:'https://www.diarioeldia.cl/noticias/2026/10/26/'+slug,
 headline:'Titular Diario El Día '+slug,
 published_at:date,
});
const coopItem=(slug,date='2026-10-27T01:30:00.000Z')=>({
 content_id:'notional-id-'+slug,
 publisher:'Cooperativa.cl',
 canonical_url:'https://www.cooperativa.cl/noticias/pais/'+slug,
 headline:'Titular Cooperativa '+slug,
 published_at:date,
});
const ok=value=>({status:'fulfilled',value});
const bad=()=>({status:'rejected',reason:new Error('unavailable')});
const dia=(items)=>({mode:'LIVE_RSS_ORIGINAL_LINK_PREVIEW',
 persisted:false,items});
const coop=(items)=>({mode:'SOURCE_RSS_LINKS_READ_ONLY_BETA',
 persisted:false,items});
test('strict chronological merge preserves source identity without grouping occurrences',()=>{
 const data=composeChileRssChronology(
   ok(dia([dayItem('one'),dayItem('older','2026-10-26T17:00:00.000Z')])),
   ok(coop([coopItem('two'),coopItem('three','2026-10-26T23:00:00.000Z')]))
 ,now);
 assert.deepEqual(data.items.map(x=>x.publisher),
  ['Cooperativa.cl','Diario El Día','Cooperativa.cl','Diario El Día']);
 assert.equal(data.publisher_count,2);
 assert.equal(data.sources.length,2);
 assert.equal(data.persisted,false);
 assert.equal(data.full_articles_downloaded,false);
 assert.equal(data.story_text_republished,false);
 assert.equal(data.semantic_grouping_performed,false);
 assert.equal(data.contradictions_generated,false);
 assert.equal(data.independent_events_claimed,0);
 assert.ok(data.items.every(x=>x.original_url.startsWith('https://')));
});
test('one broken upstream does not hide real links from other publisher',()=>{
 const data=composeChileRssChronology(ok(dia([dayItem('one')])),bad(),now);
 assert.equal(data.publisher_count,1);
 assert.equal(data.items.length,1);
 assert.equal(data.sources[1].status,'UNAVAILABLE');
 assert.equal(data.sources[0].status,'AVAILABLE');
});
test('both sources unavailable fail rather than pretending timeline updated',()=>{
 assert.throws(()=>composeChileRssChronology(bad(),bad(),now));
});
test('invalid foreign source is not silently retained alongside good data',()=>{
 const forged=coopItem('wrong');forged.canonical_url='https://evil.example/stolen';
 const data=composeChileRssChronology(
   ok(dia([dayItem('real')])),ok(coop([forged])),now);
 assert.equal(data.sources[1].status,'UNAVAILABLE');
 assert.equal(data.items.length,1);
 assert.equal(data.items[0].publisher,'Diario El Día');
});
test('duplicates inside one publisher are removed only by exact source URL',()=>{
 const data=composeChileRssChronology(
   ok(dia([dayItem('same'),dayItem('same')])),
   ok(coop([coopItem('same')]))
 ,now);
 assert.equal(data.items.length,2);
 assert.notEqual(data.items[0].item_key,data.items[1].item_key);
});
test('old or future headlines fail source as a unit',()=>{
 const stale=dayItem('old','2026-01-01T01:00:00.000Z');
 const data=composeChileRssChronology(ok(dia([stale])),ok(coop([coopItem('current')])),now);
 assert.equal(data.sources[0].status,'UNAVAILABLE');
 assert.equal(data.items.length,1);
});
