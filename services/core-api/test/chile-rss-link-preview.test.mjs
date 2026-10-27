import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchChileRssLinkPreview,parseChileRssLinks} from '../dist/live/chile-rss-link-preview.js';

const now=new Date('2026-10-26T21:00:00Z');
const link='https://www.cooperativa.cl/noticias/pais/actualidad/nueva-publicacion/2026-10-26/010000.html';
const robots='User-agent: *\nAllow: /\nDisallow: /xml/\nSitemap: https://www.cooperativa.cl/noticias/sitemap_news.xml\n';
const xml='<?xml version="1.0" encoding="utf-8"?>'+
'<rss version="2.0"><channel><title>Cooperativa.cl | Noticias</title>'+
'<item><title>Información original de prueba</title><link>'+link+
'</link><pubDate>Mon, 26 Oct 2026 19:00:00 GMT</pubDate><description>Never expose full text.</description></item>'+
'<item><title>Otro titular de ejemplo</title><link>https://evil.example/attack</link>'+
'<pubDate>Mon, 26 Oct 2026 19:00:00 GMT</pubDate></item></channel></rss>';
const source='https://www.cooperativa.cl/noticias/site/tax/port/all/rss____1.xml';
const robotsUrl='https://www.cooperativa.cl/robots.txt';
function fetcher({rules=robots,feed=xml}={}){
 const calls=[];
 const mock=async(url,options)=>{
   calls.push({url,options});
   assert.equal(options.redirect,'error');
   assert.equal(options.method,'GET');
   assert.equal(url===source||url===robotsUrl,true);
   return new Response(url===robotsUrl?rules:feed,{status:200,
     headers:{'content-type':url===robotsUrl?'text/plain':'text/xml'}});
 };
 return {mock,calls};
}
test('read live RSS publisher originals but discard body and nonpublisher outbound URL',async()=>{
 const {mock,calls}=fetcher();
 const r=await fetchChileRssLinkPreview(mock,now);
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,robotsUrl);
 assert.equal(calls[1].url,source);
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].canonical_url,link);
 assert.equal(r.items[0].publisher,'Cooperativa.cl');
 assert.equal(r.items[0].headline,'Información original de prueba');
 assert.equal(r.items[0].published_at,'2026-10-26T19:00:00.000Z');
 assert.equal(Object.hasOwn(r.items[0],'description'),false);
 assert.equal(Object.hasOwn(r.items[0],'body'),false);
 assert.equal(r.persisted,false);
 assert.equal(r.content_republication_authorized,false);
 assert.equal(r.semantic_events_published,false);
 assert.equal(r.contradictions_generated,false);
});
test('robots disallow blocks RSS before requesting publisher content',async()=>{
 const {mock,calls}=fetcher({rules:'User-agent: *\nDisallow: /noticias/\n'});
 await assert.rejects(fetchChileRssLinkPreview(mock,now),/RSS_SOURCE_ROBOTS_NOT_VERIFIED/);
 assert.equal(calls.length,1);
});
test('malicious XML entities and renamed issuer are rejected',()=>{
 assert.throws(()=>parseChileRssLinks('<!DOCTYPE rss [<!ENTITY exploit SYSTEM "file:///etc/passwd">]>'+xml,now),/RSS_UNSAFE_XML/);
 assert.throws(()=>parseChileRssLinks(xml.replace('Cooperativa.cl','Fake News'),now),/RSS_PUBLISHER_NOT_PROVEN/);
});
test('old, repeated, non publisher, and future links cannot enter beta preview',()=>{
 const old=xml.replace('Mon, 26 Oct 2026 19:00:00 GMT','Mon, 05 Oct 2026 19:00:00 GMT');
 assert.equal(parseChileRssLinks(old,now).length,0);
 const duplicated=xml.replace('</channel>','<item><title>Información duplicada</title><link>'+link+'</link><pubDate>Mon, 26 Oct 2026 19:00:00 GMT</pubDate></item></channel>');
 assert.equal(parseChileRssLinks(duplicated,now).length,1);
});
