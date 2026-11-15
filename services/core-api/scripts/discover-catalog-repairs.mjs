#!/usr/bin/env node
// Looks for working replacements for catalog rows that failed verification:
// RSS autodiscovery and common feed paths on the publisher's site, and the
// YouTube channels the site links to (plus handle variants). Every candidate
// goes through the production parser. Also prints which field carries the
// copyright marker in feeds the rights guard rejects.
import { readFileSync } from 'node:fs';
import { parseCsv } from './catalog-csv.mjs';

const { parseLiveFeed } = await import('../dist/live/live.adapter.js');
const rows = parseCsv(readFileSync(new URL('../data/verified_multicountry_sources.csv', import.meta.url), 'utf8'));
const verification = JSON.parse(readFileSync(new URL('../data/verified_multicountry_sources.verification.json', import.meta.url), 'utf8'));
const status = new Map(verification.rows.map((r) => [`${r.media_group_slug}|${r.source_type}`, r.status]));
const UA = 'Mozilla/5.0 (compatible; DialektikSourceVerifier/1.0)';
const host = (url) => new URL(url).hostname.replace(/^www\./u, '');

async function get(url, accept = '*/*') {
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept, 'accept-language': 'es,en;q=0.8', cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: AbortSignal.timeout(15_000) });
    return { status: r.status, location: r.headers.get('location'), body: r.status >= 300 && r.status < 400 ? '' : (await r.text()).slice(0, 3_000_000) };
  } catch (e) { return { status: 0, body: '', location: null }; }
}
async function follow(url, accept) {
  let current = url;
  for (let i = 0; i < 4; i++) {
    const r = await get(current, accept);
    if (r.status >= 300 && r.status < 400 && r.location) { current = new URL(r.location, current).toString(); continue; }
    return { ...r, final: current };
  }
  return { status: 0, body: '', final: current };
}
function policy(domain, endpoint) {
  return { sourceId: '01M5MC0000000000000000TEST', registryKey: 'x', publisherName: 'x', canonicalDomain: domain, sourceType: 'other', publisherFamily: null, category: null, discoveryChannel: 'rss_atom', endpoint, rightsClass: 'LIVE_READY', storagePolicy: 'METADATA_AND_FEED_EXCERPT', active: true, rightsEvidenceUrl: 'https://example.org', rightsVerifiedAt: '2026-11-15T00:00:00.000Z', attribution: 'x', language: 'es', allowedArticleDomains: [domain, `www.${domain}`] };
}
function parse(body, domain, endpoint) {
  try {
    const items = parseLiveFeed(body, policy(domain, endpoint));
    const errors = {};
    for (const it of items) if (it.errorCode) errors[it.errorCode] = (errors[it.errorCode] ?? 0) + 1;
    const dates = items.map((it) => it.publishedAt?.getTime() ?? 0).filter(Boolean).sort((a, b) => b - a);
    return { parsed: items.length, accepted: items.filter((it) => it.errorCode === null).length, errors, newest: dates[0] ? new Date(dates[0]).toISOString().slice(0, 10) : null };
  } catch (e) { return { parsed: 0, accepted: 0, errors: { [String(e.message)]: 1 }, newest: null }; }
}
async function tryFeed(url, domain) {
  const r = await get(url, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
  if (r.status !== 200 || !/<(rss|feed|rdf:RDF)\b/iu.test(r.body.slice(0, 5000))) return null;
  return { url, ...parse(r.body, domain, url) };
}

// 1. Which fields carry the copyright marker.
const MARK = /(?:©|&(?:amp;)*(?:copy|#0*169|#x0*a9);|copyright|all rights reserved|courtesy of|credit\s*:)/iu;
for (const row of rows.filter((r) => r.source_type === 'RSS' && status.get(`${r.media_group_slug}|RSS`) === 'INACTIVE_RIGHTS_MARKER')) {
  const r = await follow(row.feed_url, 'application/rss+xml, application/xml, text/xml');
  const channel = /<channel\b[\s\S]*?(?=<item\b|<entry\b)/iu.exec(r.body)?.[0] ?? '';
  const channelMark = /<(copyright|dc:rights|rights)\b[^>]*>([\s\S]*?)<\//iu.exec(channel)?.[2]?.trim().slice(0, 120) ?? null;
  const firstItem = /<(item|entry)\b[\s\S]*?<\/\1>/iu.exec(r.body)?.[0] ?? '';
  const fields = [...firstItem.matchAll(/<([a-z:]+)\b[^>]*>([\s\S]*?)<\/\1>/giu)].filter((m) => MARK.test(m[2])).map((m) => `${m[1]}=${m[2].replace(/\s+/gu, ' ').slice(0, 80)}`);
  const items = [...r.body.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/giu)].map((m) => m[0]);
  const itemsWithMark = items.filter((it) => MARK.test(it.replace(/<link[\s\S]*?<\/link>/giu, ''))).length;
  console.log(`RIGHTS ${row.media_group_slug} channel=${JSON.stringify(channelMark)} items_with_marker=${itemsWithMark}/${items.length} first_item_fields=${JSON.stringify(fields)}`);
}

// 2. Replacements for unreachable feeds.
const COMMON = ['/feed/', '/rss', '/rss/', '/rss.xml', '/feed', '/arc/outboundfeeds/rss/', '/arc/outboundfeeds/rss/?outputType=xml', '/rss/portada.xml', '/rss/ultimas-noticias.xml', '/feeds/rss', '/index.rss', '/rss/home.xml'];
for (const row of rows.filter((r) => r.source_type === 'RSS' && ['INACTIVE_UNREACHABLE', 'INACTIVE_PARSER', 'INACTIVE_STALE'].includes(status.get(`${r.media_group_slug}|RSS`)))) {
  const domain = host(row.website_url);
  const home = await follow(row.website_url, 'text/html');
  const alternates = [...home.body.matchAll(/<link\b[^>]*type="application\/(?:rss|atom)\+xml"[^>]*>/giu)]
    .map((m) => /href="([^"]+)"/iu.exec(m[0])?.[1]).filter(Boolean).map((href) => new URL(href.replace(/&amp;/gu, '&'), home.final || row.website_url).toString());
  const candidates = [...new Set([...alternates, ...COMMON.map((p) => new URL(p, row.website_url).toString())])].slice(0, 16);
  const found = [];
  for (const url of candidates) { const f = await tryFeed(url, domain); if (f && f.accepted > 0) found.push(f); }
  found.sort((a, b) => (b.newest ?? '').localeCompare(a.newest ?? '') || b.accepted - a.accepted);
  console.log(`FEED ${row.media_group_slug} home=${home.status} alternates=${alternates.length} found=${JSON.stringify(found.slice(0, 3))}`);
}

// 3. Replacements for YouTube handles that did not resolve.
async function channelOf(handle) {
  const page = await follow(`https://www.youtube.com/${handle}`, 'text/html');
  if (page.status !== 200) return null;
  const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/u.exec(page.body)?.[1] ?? /"externalId":"(UC[A-Za-z0-9_-]{22})"/u.exec(page.body)?.[1];
  return id ?? null;
}
for (const row of rows.filter((r) => r.source_type === 'YOUTUBE' && status.get(`${r.media_group_slug}|YOUTUBE`) === 'PENDING_CHANNEL')) {
  const home = await follow(row.website_url, 'text/html');
  const linked = [...new Set([...home.body.matchAll(/youtube\.com\/(?:(@[A-Za-z0-9._-]{2,100})|channel\/(UC[A-Za-z0-9_-]{22})|c\/([A-Za-z0-9._-]{2,100})|user\/([A-Za-z0-9._-]{2,100}))/gu)]
    .map((m) => m[1] ?? m[2] ?? (m[3] ? `c/${m[3]}` : `user/${m[4]}`)))];
  const results = [];
  for (const ref of linked.slice(0, 6)) {
    let id = ref.startsWith('UC') ? ref : null;
    if (!id) id = await channelOf(ref);
    if (!id) continue;
    const feed = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, 'application/atom+xml');
    const title = /<title>([^<]+)<\/title>/u.exec(feed.body)?.[1] ?? null;
    const parsed = feed.status === 200 ? parse(feed.body, 'youtube.com', 'https://www.youtube.com/feeds/videos.xml?channel_id=' + id) : null;
    results.push({ ref, id, title, accepted: parsed?.accepted ?? 0, newest: parsed?.newest ?? null });
  }
  console.log(`YT ${row.media_group_slug} handle=${row.youtube_handle} home=${home.status} linked=${JSON.stringify(results)}`);
}
