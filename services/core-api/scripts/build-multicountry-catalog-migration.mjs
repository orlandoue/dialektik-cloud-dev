#!/usr/bin/env node
// Generates packages/database/src/migration/087_multicountry_media_catalog.data.ts
// from the verified CSV and its verification record. Deterministic: running it
// twice produces the same file, and a test checks the committed file is current.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from './catalog-csv.mjs';

const root = new URL('../../../', import.meta.url);
const csv = parseCsv(readFileSync(new URL('services/core-api/data/verified_multicountry_sources.csv', root), 'utf8'));
const verification = JSON.parse(readFileSync(new URL('services/core-api/data/verified_multicountry_sources.verification.json', root), 'utf8'));

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Stable ULID-shaped identity: fixed time prefix, hashed randomness. */
export function catalogSourceId(slug, type) {
  const digest = createHash('sha256').update(`dialektik-media-catalog-source-v1\n${slug}\n${type}`).digest();
  let bits = 0n;
  for (const byte of digest.subarray(0, 14)) bits = (bits << 8n) | BigInt(byte);
  let random = '';
  for (let i = 0; i < 16; i++) { random = CROCKFORD[Number(bits & 31n)] + random; bits >>= 5n; }
  return `01M5MC0000${random}`;
}

const LAW = {
  CL: 'https://www.bcn.cl/leychile/navegar?idNorma=28933',
  ES: 'https://www.boe.es/buscar/act.php?id=BOE-A-1996-8930',
  AR: 'https://servicios.infoleg.gob.ar/infolegInternet/anexos/40000-44999/42755/texact.htm',
  US: 'https://www.copyright.gov/title17/92chap1.html#107',
};
const NEWSPAPERS = new Set(['cl-diario-financiero', 'es-el-pais', 'es-el-mundo', 'es-abc', 'es-la-vanguardia', 'es-cinco-dias',
  'ar-clarin', 'ar-la-nacion', 'ar-pagina12', 'ar-perfil', 'ar-ambito-financiero', 'ar-el-cronista', 'ar-tiempo-argentino',
  'us-the-new-york-times', 'us-the-washington-post', 'us-the-wall-street-journal', 'us-new-york-post']);
const AGENCIES = new Set(['es-agencia-efe', 'us-ap', 'us-reuters']);
const kind = (row) => row.category === 'television' ? 'tv' : row.category === 'radio' ? 'radio'
  : AGENCIES.has(row.media_group_slug) ? 'wire_agency' : NEWSPAPERS.has(row.media_group_slug) ? 'daily_newspaper' : 'digital_native';
// The corporate connection only accepts the publisher's domain (or www.) as
// feed host; any other host (subdomain or CDN) is recorded explicitly.
function feedHost(youtube, check, row, domain) {
  if (youtube || check.status !== 'ACTIVE') return null;
  const feed = new URL(check.endpoint ?? row.feed_url).hostname.toLowerCase();
  return feed === domain || feed === `www.${domain}` ? null : feed;
}
const host = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./u, '');

const byKey = new Map(verification.rows.map((row) => [`${row.media_group_slug}|${row.source_type}`, row]));
const entries = csv.map((row) => {
  const check = byKey.get(`${row.media_group_slug}|${row.source_type}`);
  if (!check) throw new Error(`missing verification for ${row.media_group_slug} ${row.source_type}`);
  const youtube = row.source_type === 'YOUTUBE';
  const short = row.media_group_slug.slice(3);
  const domain = youtube ? 'youtube.com' : host(row.website_url);
  return {
    slug: row.media_group_slug,
    type: row.source_type,
    country: row.country_code,
    display_name: row.display_name,
    feed_url: row.feed_url,
    website_url: row.website_url,
    handle: row.youtube_handle || null,
    catalog_channel_id: row.youtube_channel_id || null,
    channel_id: check.channel_id ?? (row.youtube_channel_id || null),
    lean: row.editorial_lean,
    category: row.category,
    language: row.language,
    catalog_active: row.is_active === 'true',
    status: check.status,
    reason: check.reason ?? null,
    endpoint: youtube || check.status !== 'ACTIVE' ? null : (check.endpoint ?? row.feed_url),
    feed_host: feedHost(youtube, check, row, domain),
    duplicate_of: check.duplicate_of ?? null,
    existing_registry_key: check.registry_key ?? null,
    source_id: check.status === 'EXISTING_SOURCE' || check.status === 'DUPLICATE_CHANNEL' ? null : catalogSourceId(row.media_group_slug, row.source_type),
    source_name: youtube ? `${row.display_name} (YouTube)` : row.display_name,
    source_kind: kind(row),
    canonical_domain: domain,
    allowed_domains: [domain, `www.${domain}`],
    registry_key: `catalog-${row.country_code.toLowerCase()}-${youtube ? 'yt' : 'rss'}-${short}-v1`,
    rights_url: LAW[row.country_code],
    authorization_reference: `DIALEKTIK-OWNER-CATALOG-2026-11-${row.media_group_slug.toUpperCase()}-${row.source_type}`,
  };
});

// Sources already in production before the catalog: same country, a media
// group and, where the owner's catalog names the medium, its editorial lean.
const lean = (slug) => csv.find((row) => row.media_group_slug === slug)?.editorial_lean ?? null;
const existing = [
  ['chile-rss-biobiochile-v1', 'cl-biobiochile', 'BioBioChile', 'RSS'],
  ['chile-yt-biobiochile-v1', 'cl-biobiochile', 'BioBioChile', 'YOUTUBE'],
  ['chile-rss-ciperchile-v1', 'cl-ciper', 'CIPER Chile', 'RSS'],
  ['chile-yt-ciperchile-v1', 'cl-ciper', 'CIPER Chile', 'YOUTUBE'],
  ['chile-rss-cooperativa-v1', 'cl-cooperativa', 'Cooperativa', 'RSS'],
  ['chile-yt-cooperativa-v1', 'cl-cooperativa', 'Cooperativa', 'YOUTUBE'],
  ['chile-rss-diarioeldia-v1', 'cl-diario-el-dia', 'Diario El Día', 'RSS'],
  ['chile-rss-elmostrador-v1', 'cl-el-mostrador', 'El Mostrador', 'SITEMAP'],
  ['chile-yt-elmostrador-v1', 'cl-el-mostrador', 'El Mostrador', 'YOUTUBE'],
  ['chile-rss-emol-v1', 'cl-emol', 'Emol', 'RSS'],
  ['chile-rss-latercera-v1', 'cl-la-tercera', 'La Tercera', 'RSS'],
  ['chile-yt-latercera-v1', 'cl-la-tercera', 'La Tercera', 'YOUTUBE'],
  ['chile-yt-24horas-tvn-v1', 'cl-24-horas-tvn', '24 Horas TVN', 'YOUTUBE'],
  ['chile-yt-adnradio-v1', 'cl-adn', 'ADN Radio', 'YOUTUBE'],
  ['chile-yt-agriculturatv-v1', 'cl-radio-agricultura', 'Radio Agricultura', 'YOUTUBE'],
  ['chile-yt-canal9biobio-v1', 'cl-canal-9-biobio', 'Canal 9 Bío Bío', 'YOUTUBE'],
  ['chile-yt-chvnoticias-v1', 'cl-chv-noticias', 'CHV Noticias', 'YOUTUBE'],
  ['chile-yt-cnnchile-v1', 'cl-cnn-chile', 'CNN Chile', 'YOUTUBE'],
  ['chile-yt-dflive-v1', 'cl-diario-financiero', 'Diario Financiero', 'YOUTUBE'],
  ['chile-yt-elciudadano-v1', 'cl-el-ciudadano', 'El Ciudadano', 'YOUTUBE'],
  ['chile-yt-eldesconcierto-v1', 'cl-el-desconcierto', 'El Desconcierto', 'YOUTUBE'],
  ['chile-yt-ellibero-v1', 'cl-el-libero', 'El Líbero', 'YOUTUBE'],
  ['chile-yt-fastcheckcl-v1', 'cl-fast-check', 'Fast Check CL', 'YOUTUBE'],
  ['chile-yt-infinita-v1', 'cl-radio-infinita', 'Radio Infinita', 'YOUTUBE'],
  ['chile-yt-lavozdelosquesobran-v1', 'cl-la-voz-de-los-que-sobran', 'La Voz de los que Sobran', 'YOUTUBE'],
  ['chile-yt-meganoticias-v1', 'cl-meganoticias', 'Meganoticias', 'YOUTUBE'],
  ['chile-yt-pauta-v1', 'cl-radio-pauta', 'Radio Pauta', 'YOUTUBE'],
  ['chile-yt-radioduna-v1', 'cl-radio-duna', 'Radio Duna', 'YOUTUBE'],
  ['chile-yt-radiouchile-v1', 'cl-radio-uchile', 'Radio Universidad de Chile', 'YOUTUBE'],
  ['chile-yt-sinfiltrostv-v1', 'cl-sin-filtros', 'Sin Filtros', 'YOUTUBE'],
  ['chile-yt-t13-v1', 'cl-t13', 'T13', 'YOUTUBE'],
  ['chile-yt-tele13radio-v1', 'cl-t13', 'T13', 'YOUTUBE'],
  ['chile-yt-theclinic-v1', 'cl-the-clinic', 'The Clinic', 'YOUTUBE'],
  ['chile-yt-turno-copano-v1', 'cl-turno-copano', 'Turno / Copano.News', 'YOUTUBE'],
  ['chile-yt-viax-v1', 'cl-via-x', 'Vía X', 'YOUTUBE'],
  ['chile-yt-camaradiputados-v1', 'cl-camara-diputados', 'Cámara de Diputadas y Diputados', 'OFFICIAL'],
  ['chile-yt-tvsenado-v1', 'cl-senado', 'TV Senado', 'OFFICIAL'],
  ['chile-yt-poderjudicial-v1', 'cl-poder-judicial', 'Poder Judicial', 'OFFICIAL'],
  ['chile-yt-voceriagob-v1', 'cl-gobierno', 'Gobierno de Chile', 'OFFICIAL'],
  ['chile-official-gobcl-v1', 'cl-gobierno', 'Gobierno de Chile', 'OFFICIAL'],
  ['chile-official-bcentral-v1', 'cl-banco-central', 'Banco Central de Chile', 'OFFICIAL'],
  ['chile-official-csn-v1', 'cl-csn', 'Centro Sismológico Nacional', 'OFFICIAL'],
  ['chile-official-senapred-v1', 'cl-senapred', 'SENAPRED', 'OFFICIAL'],
].map(([registry_key, slug, name, modality]) => ({ registry_key, slug, name, modality, country: 'CL', lean: lean(slug) }));

const body = `// Generated by services/core-api/scripts/build-multicountry-catalog-migration.mjs.
// Do not edit by hand: change the CSV or its verification record and regenerate.
export const MEDIA_CATALOG_ENTRIES = ${JSON.stringify(entries, null, 1)} as const;

export const EXISTING_SOURCE_PROFILES = ${JSON.stringify(existing, null, 1)} as const;
`;
const target = new URL('packages/database/src/migration/087_multicountry_media_catalog.data.ts', root);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== body) {
    console.error('087_multicountry_media_catalog.data.ts is stale: run this script without --check.');
    process.exit(1);
  }
  console.log('catalog migration data is current');
} else {
  writeFileSync(target, body);
  console.log(`entries=${entries.length} existing_profiles=${existing.length}`);
}
