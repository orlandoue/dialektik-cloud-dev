import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeChileRss,fetchChileRssLinkedHeadlines} from '../dist/live/chile-publisher-rss-preview.js';
const now=new Date('2026-10-26T21:00:00.000Z');
const validLink='https://www.diarioeldia.cl/noticias/2026/10/26/real-source-story';
const entry=(link=validLink,title='Noticia verificada en el RSS de origen')=>
  '<item><title>'+title+'</title><link>'+link+'</link>'+
  '<pubDate>Mon, 26 Oct 2026 20:00:00 GMT</pubDate>'+
  '<description>DO NOT COPY ANY EXCERPT</description></item>';
const xml=items=> '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'+
  '<title>Diario El Día</title><link>https://www.diarioeldia.cl/</link>'+
  items+'</channel></rss>';
function mocked(xmlText,mime='text/xml'){
 return async(url,options)=>{
  assert.equal(url,'https://www.diarioeldia.cl/rss/noticias/');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  return new Response(xmlText,{status:200,headers:{'content-type':mime}});
 };
}
test('publishes only source headline, URL, date and no protected article content',async()=>{
 const result=await fetchChileRssLinkedHeadlines(mocked(xml(entry())),now);
 assert.equal(result.mode,'LIVE_RSS_ORIGINAL_LINK_PREVIEW');
 assert.equal(result.items.length,1);
 assert.equal(result.items[0].headline,'Noticia verificada en el RSS de origen');
 assert.equal(result.items[0].original_url,validLink);
 assert.equal(result.items[0].published_at,'2026-10-26T20:00:00.000Z');
 assert.equal(result.bodies_downloaded,false);
 assert.equal(result.excerpts_reproduced,false);
 assert.equal(result.persisted,false);
 assert.equal(result.events_detected,false);
 assert.equal(result.contradictions_detected,false);
 assert.equal(JSON.stringify(result).includes('DO NOT COPY ANY EXCERPT'),false);
});
test('do not treat different domains, HTTP or duplicated URLs as news',()=>{
 const cases=['https://evil.example/news','https://www.diarioeldia.cl.evil.example/fake',
    'http://www.diarioeldia.cl/noticias/unsafe'];
 for(const url of cases) assert.deepEqual(decodeChileRss(xml(entry(url)),now),[]);
 assert.equal(decodeChileRss(xml(entry()+entry()),now).length,1);
});
test('reject entities, DTD, HTML and stale results',()=>{
 assert.throws(()=>decodeChileRss('<!DOCTYPE rss><rss><channel>'+entry()+'</channel></rss>',now));
 assert.throws(()=>decodeChileRss('<html>403</html>',now));
 const stale=xml(entry().replace('Mon, 26 Oct 2026 20:00:00 GMT',
    'Mon, 01 Sep 2025 20:00:00 GMT'));
 assert.deepEqual(decodeChileRss(stale,now),[]);
});
test('wrong content-type cannot pass',async()=>{
 await assert.rejects(fetchChileRssLinkedHeadlines(mocked(xml(entry()),'text/html'),now));
});
