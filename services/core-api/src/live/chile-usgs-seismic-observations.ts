/**
 * USGS official earthquake observations for Chile, one source and one
 * USGS-authoritative occurrence identity per event. NOT newsroom Articles,
 * cross-publisher grouping, emergency alerts or contradictions.
 *
 * Source: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 * Rights: https://www.usgs.gov/information-policies-and-instructions/acknowledging-or-crediting-usgs
 * Keep names/IDs/times from the issuer; never invent a second corroborator.
 */
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
const RIGHTS_URL =
  'https://www.usgs.gov/information-policies-and-instructions/acknowledging-or-crediting-usgs';
const MAX_BYTES = 5_000_000;
const MAX_EVENTS = 30;
const CACHE_MS = 180_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
type RecordValue = Record<string, unknown>;
type Fetcher = typeof fetch;

export interface SeismicObservation {
  readonly observation_id: string;
  readonly occurrence_key: string;
  readonly publisher: 'U.S. Geological Survey';
  readonly publisher_market: 'US';
  readonly location_context: 'CHILE_USGS_LABEL_AND_BOUNDS';
  readonly description: string;
  readonly magnitude: number;
  readonly longitude: number;
  readonly latitude: number;
  readonly depth_km: number;
  readonly occurred_at: string;
  readonly revised_at: string;
  readonly source_status: 'reviewed' | 'automatic';
  readonly canonical_url: string;
  readonly independent_publisher_count: 1;
  readonly contradiction_count: 0;
}
function object(input: unknown): RecordValue {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw Error('USGS_RESPONSE_INVALID');
  }
  return input as RecordValue;
}
function decode(data: unknown, now: Date): SeismicObservation[] {
  const root = object(data);
  const meta = object(root.metadata);
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features) ||
      root.features.length > 20_000 || root.features.length < 1 ||
      !Number.isSafeInteger(meta.generated) ||
      Math.abs(now.getTime() - Number(meta.generated)) > 2 * 86_400_000 ||
      meta.url !== FEED_URL || meta.status !== 200) {
    throw Error('USGS_COLLECTION_CONTRACT_INVALID');
  }
  const out: SeismicObservation[] = [], ids = new Set<string>();
  for (const raw of root.features) {
    const item = object(raw), prop = object(item.properties), geo = object(item.geometry);
    if (typeof prop.place !== 'string' || !/\bChile\b/iu.test(prop.place)) continue;
    const id = item.id;
    if (typeof id !== 'string' || !/^[a-z]{2,5}[a-z0-9]{5,22}$/u.test(id) ||
        ids.has(id) || geo.type !== 'Point' || !Array.isArray(geo.coordinates) ||
        geo.coordinates.length < 3 || geo.coordinates.length > 4) {
      throw Error('USGS_IDENTITY_INVALID');
    }
    const [lng,lat,depth] = geo.coordinates;
    if (![lng,lat,depth,prop.mag,prop.time,prop.updated].every(
      x => typeof x === 'number' && Number.isFinite(x)) ||
      Number(lng) < -80 || Number(lng) > -65 || Number(lat) < -58 ||
      Number(lat) > -17 || Number(depth) < -5 || Number(depth) > 800 ||
      Number(prop.mag) < -2 || Number(prop.mag) > 10 ||
      !Number.isSafeInteger(prop.time) || !Number.isSafeInteger(prop.updated) ||
      Number(prop.time) > now.getTime() + MAX_FUTURE_SKEW_MS ||
      Number(prop.updated) > now.getTime() + MAX_FUTURE_SKEW_MS ||
      Number(prop.updated) < Number(prop.time) ||
      Number(prop.time) < now.getTime() - 9 * 86_400_000 ||
      prop.url !== 'https://earthquake.usgs.gov/earthquakes/eventpage/' + id ||
      !['reviewed','automatic'].includes(String(prop.status)) ||
      typeof prop.type !== 'string' || prop.type !== 'earthquake' ||
      prop.place.trim().length < 3 || prop.place.length > 180 ||
      /[\u0000-\u001f\u007f]/u.test(prop.place)) {
      throw Error('USGS_OBSERVATION_INVALID');
    }
    ids.add(id);
    out.push(Object.freeze({
      observation_id:id,
      occurrence_key:'usgs:earthquake:' + id,
      publisher:'U.S. Geological Survey',
      publisher_market:'US',
      location_context:'CHILE_USGS_LABEL_AND_BOUNDS',
      description:prop.place,
      magnitude:Number(prop.mag),
      longitude:Number(lng),
      latitude:Number(lat),
      depth_km:Number(depth),
      occurred_at:new Date(Number(prop.time)).toISOString(),
      revised_at:new Date(Number(prop.updated)).toISOString(),
      source_status:prop.status as 'reviewed'|'automatic',
      canonical_url:String(prop.url),
      independent_publisher_count:1,
      contradiction_count:0,
    }));
  }
  out.sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at) ||
      a.observation_id.localeCompare(b.observation_id));
  return out.slice(0,MAX_EVENTS);
}
async function getJson(fetcher: Fetcher): Promise<unknown> {
  const res = await fetcher(FEED_URL, {
    method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(12_000),
    headers:{Accept:'application/geo+json, application/json',
      'User-Agent':'DialektikSeismicObservations/1.0'},
  });
  const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
  const header = res.headers.get('content-length');
  if (res.status !== 200 || !contentType.includes('json') ||
      (res.url && res.url !== FEED_URL) ||
      (header && (!/^\d+$/u.test(header) || Number(header) > MAX_BYTES)) || !res.body) {
    await res.body?.cancel();
    throw Error('USGS_TRANSPORT_INVALID');
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let used = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      used += part.value.byteLength;
      if (used > MAX_BYTES) {
        await reader.cancel();
        throw Error('USGS_RESPONSE_TOO_LARGE');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(used);
  let offset = 0;
  for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all)); }
  finally { all.fill(0); }
}
/** Stateless source read. The returned JSON is not stored in PostgreSQL. */
export async function fetchChileUsgsObservations(
  fetcher: Fetcher=fetch, now=new Date(),
) {
  const found = decode(await getJson(fetcher),now);
  return Object.freeze({
    mode:'OFFICIAL_LIVE_SEISMIC_OBSERVATIONS' as const,
    source:'U.S. Geological Survey' as const,
    rights_url:RIGHTS_URL,
    source_feed_url:FEED_URL,
    market_country:'CL' as const,
    category:'OFFICIAL_OBSERVATIONS_NOT_NEWS' as const,
    inspected_at:now.toISOString(),
    persisted:false as const,
    automatic_same_id_grouping:true as const,
    cross_publisher_grouping:false as const,
    contradictions_generated:false as const,
    is_emergency_alert:false as const,
    items:Object.freeze(found),
  });
}
let cache: Promise<Awaited<ReturnType<typeof fetchChileUsgsObservations>>> | null=null;
let expiresAt=0;
/** Bounded in-memory coalescing keeps upstream to <= 1 request/3min per service. */
export function latestChileUsgsObservations(now=new Date()) {
  const timestamp=now.getTime();
  if (!cache || timestamp>=expiresAt) {
    const current=fetchChileUsgsObservations(fetch,now);
    cache=current.catch(error=>{if(cache===current)cache=null;throw error;});
    expiresAt=timestamp+CACHE_MS;
  }
  return cache;
}
