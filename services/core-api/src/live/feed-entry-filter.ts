/**
 * Pre-persistence trimming of a publisher feed. Whole <item>/<entry> blocks are
 * removed from the XML text, so what remains is still the publisher's own
 * markup and goes through the same rights-gated parser as before.
 */

const BLOCK = /<(item|entry)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

/** Titles of continuous streams and live programmes, not single occurrences. */
export const YOUTUBE_LIVE_TITLE =
  /(?:\ben vivo\b|\ben directo\b|\blive\b|🔴|\b24\s*\/\s*7\b|\bse[nñ]al en vivo\b|\btransmisi[oó]n en vivo\b|\bwatch live\b)/iu;

/** VOD pieces between 90 seconds and 45 minutes keep the day's events apart. */
export const YOUTUBE_MIN_SECONDS = 90;
export const YOUTUBE_MAX_SECONDS = 45 * 60;

export interface FeedBlock {
  readonly text: string;
  readonly title: string;
  readonly link: string;
  readonly videoId: string | null;
  readonly publishedAt: number;
}

function tag(block: string, name: string): string {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'iu').exec(block);
  return (match?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1').trim();
}

export function feedBlocks(payload: string): FeedBlock[] {
  return [...payload.matchAll(BLOCK)].map((match) => {
    const text = match[0];
    const href = /<link\b[^>]*href="([^"]+)"/iu.exec(text)?.[1];
    const link = href ?? tag(text, 'link');
    const videoId = tag(text, 'yt:videoId') || null;
    const date = Date.parse(tag(text, 'published') || tag(text, 'pubDate') || tag(text, 'updated') || tag(text, 'dc:date'));
    return {
      text,
      title: tag(text, 'title'),
      link,
      videoId: videoId !== null && VIDEO_ID.test(videoId) ? videoId : null,
      publishedAt: Number.isFinite(date) ? date : 0,
    };
  });
}

/** Removes the blocks for which `keep` is false, preserving the rest verbatim. */
export function retainFeedBlocks(payload: string, keep: (block: FeedBlock) => boolean): { payload: string; removed: number } {
  const blocks = feedBlocks(payload);
  const drop = new Set(blocks.filter((block) => !keep(block)).map((block) => block.text));
  if (drop.size === 0) return { payload, removed: 0 };
  let removed = 0;
  const next = payload.replace(BLOCK, (text) => {
    if (!drop.has(text)) return text;
    removed += 1;
    return '';
  });
  return { payload: next, removed };
}

/** Keeps only the newest `max` items, so prolific outlets do not flood the queue. */
export function capNewestFeedBlocks(payload: string, max: number): { payload: string; removed: number } {
  const blocks = feedBlocks(payload);
  if (blocks.length <= max) return { payload, removed: 0 };
  const newest = new Set(
    [...blocks].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, max).map((block) => block.text),
  );
  return retainFeedBlocks(payload, (block) => newest.has(block.text));
}

export interface YouTubeVideoDetails {
  readonly durationSeconds: number | null;
  readonly live: boolean;
}

/** ISO 8601 duration as YouTube reports it (PT#H#M#S, P#DT…). */
export function isoDurationSeconds(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(value);
  if (!match) return null;
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0));
  return (d ?? 0) * 86_400 + (h ?? 0) * 3_600 + (m ?? 0) * 60 + (s ?? 0);
}

/**
 * Optional Data API check (videos.list, 1 quota unit per 50 videos): live or
 * upcoming broadcasts and durations. Without a key, or on any failure, the
 * Atom heuristics alone apply.
 */
export async function fetchYouTubeVideoDetails(
  ids: readonly string[],
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadonlyMap<string, YouTubeVideoDetails>> {
  const details = new Map<string, YouTubeVideoDetails>();
  const valid = [...new Set(ids.filter((id) => VIDEO_ID.test(id)))];
  if (apiKey === null || apiKey.trim().length === 0 || valid.length === 0) return details;
  for (let offset = 0; offset < valid.length; offset += 50) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'contentDetails,snippet');
    url.searchParams.set('id', valid.slice(offset, offset + 50).join(','));
    url.searchParams.set('key', apiKey.trim());
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return details;
      const body = (await response.json()) as { items?: unknown };
      for (const item of Array.isArray(body.items) ? body.items : []) {
        const record = item as { id?: unknown; contentDetails?: { duration?: unknown }; snippet?: { liveBroadcastContent?: unknown } };
        if (typeof record.id !== 'string') continue;
        const duration = typeof record.contentDetails?.duration === 'string'
          ? isoDurationSeconds(record.contentDetails.duration) : null;
        const broadcast = record.snippet?.liveBroadcastContent;
        details.set(record.id, { durationSeconds: duration, live: broadcast === 'live' || broadcast === 'upcoming' });
      }
    } catch {
      return details;
    }
  }
  return details;
}

export interface YouTubeFilterOutcome {
  readonly payload: string;
  readonly shorts: number;
  readonly live: number;
  readonly duration: number;
}

/**
 * Drops Shorts (their Atom link is /shorts/), live or upcoming streams and,
 * when the duration is known, pieces outside 90 s – 45 min.
 */
export function filterYouTubeAtom(
  payload: string,
  details: ReadonlyMap<string, YouTubeVideoDetails> = new Map(),
): YouTubeFilterOutcome {
  let shorts = 0;
  let live = 0;
  let duration = 0;
  const result = retainFeedBlocks(payload, (block) => {
    if (/youtube\.com\/shorts\//iu.test(block.link)) { shorts += 1; return false; }
    const known = block.videoId === null ? undefined : details.get(block.videoId);
    if (known?.live === true || YOUTUBE_LIVE_TITLE.test(block.title)) { live += 1; return false; }
    if (known?.durationSeconds != null && (known.durationSeconds < YOUTUBE_MIN_SECONDS || known.durationSeconds > YOUTUBE_MAX_SECONDS)) {
      if (known.durationSeconds < YOUTUBE_MIN_SECONDS) shorts += 1; else duration += 1;
      return false;
    }
    return true;
  });
  return { payload: result.payload, shorts, live, duration };
}
