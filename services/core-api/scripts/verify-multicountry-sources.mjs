#!/usr/bin/env node
// Checks every row of the verified multi-country catalog against the live web:
// RSS rows must answer 200 with RSS/Atom items and no redirect (production
// fetches with redirect:'error'); YouTube rows must resolve to a UC… channel
// whose native Atom feed answers. Prints one JSON line per row and a summary.
import { readFileSync } from 'node:fs';

const CSV = new URL('../data/verified_multicountry_sources.csv', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; DialektikSourceVerifier/1.0)';
const CHANNEL = /UC[A-Za-z0-9_-]{22}/u;

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

async function get(url, accept) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept, 'accept-language': 'es,en;q=0.8', cookie: 'CONSENT=YES+1; SOCS=CAI' },
      signal: AbortSignal.timeout(20_000),
    });
    const body = response.status >= 300 && response.status < 400 ? '' : await response.text();
    return { status: response.status, location: response.headers.get('location'), type: response.headers.get('content-type') ?? '', body, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, location: null, type: '', body: '', ms: Date.now() - started, error: String(error?.cause?.code ?? error?.name ?? error) };
  }
}

function feedStats(body) {
  const items = (body.match(/<item[\s>]/gu) ?? []).length + (body.match(/<entry[\s>]/gu) ?? []).length;
  const dates = [...body.matchAll(/<(?:pubDate|published|updated|dc:date)>([^<]+)</gu)]
    .map((m) => Date.parse(m[1].trim())).filter(Number.isFinite).sort((a, b) => b - a);
  const newest = dates[0] ?? null;
  const oldest = dates.at(-1) ?? null;
  const spanHours = newest && oldest && newest > oldest ? (newest - oldest) / 3_600_000 : null;
  return {
    items,
    newest: newest ? new Date(newest).toISOString() : null,
    per_day: spanHours && items > 1 ? Math.round((items / spanHours) * 24) : null,
    shorts: (body.match(/youtube\.com\/shorts\//gu) ?? []).length,
  };
}

async function followRss(url) {
  let current = url;
  const hops = [];
  for (let i = 0; i < 4; i++) {
    const r = await get(current, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
    if (r.status >= 300 && r.status < 400 && r.location) {
      hops.push(r.status);
      current = new URL(r.location, current).toString();
      continue;
    }
    return { ...r, final: current, hops };
  }
  return { status: 0, final: current, hops, body: '', type: '', error: 'TOO_MANY_REDIRECTS' };
}

async function resolveChannel(row) {
  if (CHANNEL.test(row.youtube_channel_id)) return { id: row.youtube_channel_id, via: 'catalog' };
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (key) {
    const api = new URL('https://www.googleapis.com/youtube/v3/channels');
    api.searchParams.set('part', 'id');
    api.searchParams.set('forHandle', row.youtube_handle);
    api.searchParams.set('key', key);
    const r = await get(api.toString(), 'application/json');
    const id = r.status === 200 ? JSON.parse(r.body).items?.[0]?.id : null;
    if (id && CHANNEL.test(id)) return { id, via: 'api_forHandle' };
  }
  let page = await get(`https://www.youtube.com/${row.youtube_handle}`, 'text/html');
  if (page.status >= 300 && page.status < 400 && page.location) page = await get(new URL(page.location, 'https://www.youtube.com').toString(), 'text/html');
  const canonical = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/u.exec(page.body)?.[1]
    ?? /"externalId":"(UC[A-Za-z0-9_-]{22})"/u.exec(page.body)?.[1]
    ?? /<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"/u.exec(page.body)?.[1];
  return canonical ? { id: canonical, via: 'channel_page' } : { id: null, via: `unresolved_http_${page.status}` };
}

const rows = parseCsv(readFileSync(CSV, 'utf8'));
const results = [];
for (const row of rows) {
  const base = { country: row.country_code, slug: row.media_group_slug, type: row.source_type };
  if (row.source_type === 'RSS') {
    const r = await followRss(row.feed_url);
    const stats = feedStats(r.body);
    const ok = r.status === 200 && stats.items > 0;
    results.push({ ...base, ok, status: r.status, redirected: r.hops.length > 0, final_url: r.final, https: r.final.startsWith('https://'), content_type: r.type.split(';')[0], ...stats, error: r.error ?? null, ms: r.ms });
  } else {
    const channel = await resolveChannel(row);
    let feed = { status: 0, body: '' };
    if (channel.id) feed = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, 'application/atom+xml');
    const stats = feedStats(feed.body);
    const title = /<title>([^<]+)<\/title>/u.exec(feed.body)?.[1] ?? null;
    results.push({ ...base, ok: feed.status === 200 && stats.items > 0, handle: row.youtube_handle, channel_id: channel.id, resolved_via: channel.via, catalog_id_matches: row.youtube_channel_id === '' || row.youtube_channel_id === channel.id, feed_status: feed.status, channel_title: title, ...stats });
  }
  console.log(JSON.stringify(results.at(-1)));
}
const failed = results.filter((r) => !r.ok);
console.log(`SUMMARY total=${results.length} ok=${results.length - failed.length} failed=${failed.length}`);
for (const r of failed) console.log(`FAILED ${r.country} ${r.type} ${r.slug} status=${r.status ?? r.feed_status} via=${r.resolved_via ?? ''} ${r.error ?? ''}`);
console.log(`RESOLVED_CHANNELS ${JSON.stringify(Object.fromEntries(results.filter((r) => r.type === 'YOUTUBE' && r.channel_id).map((r) => [`${r.slug}`, r.channel_id])))}`);
console.log(`REDIRECTED_FEEDS ${JSON.stringify(results.filter((r) => r.redirected).map((r) => [r.slug, r.final_url]))}`);
