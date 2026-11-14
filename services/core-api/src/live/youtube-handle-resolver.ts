const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/u;
const HANDLE = /^@[A-Za-z0-9._-]{1,100}$/u;

export interface HandleResolution {
  readonly channelId: string | null;
  readonly status: string;
}

/**
 * One-time @handle → UC… resolution. channels.list?forHandle costs one quota
 * unit when a key is configured; otherwise the channel page's canonical link
 * is read. The resulting channel is then polled through its free Atom feed.
 */
export async function resolveYouTubeHandle(
  handle: string,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<HandleResolution> {
  if (!HANDLE.test(handle)) return { channelId: null, status: 'HANDLE_INVALID' };
  if (apiKey !== null && apiKey.trim().length > 0) {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'id');
    url.searchParams.set('forHandle', handle);
    url.searchParams.set('key', apiKey.trim());
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const body = (await response.json()) as { items?: { id?: unknown }[] };
        const id = body.items?.[0]?.id;
        if (typeof id === 'string' && CHANNEL_ID.test(id)) return { channelId: id, status: 'RESOLVED_API' };
        return { channelId: null, status: 'HANDLE_NOT_FOUND_API' };
      }
    } catch {
      // Fall back to the public channel page.
    }
  }
  try {
    const response = await fetchImpl(`https://www.youtube.com/${handle}`, {
      redirect: 'follow',
      headers: { accept: 'text/html', 'accept-language': 'es,en;q=0.8', cookie: 'CONSENT=YES+1; SOCS=CAI' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return { channelId: null, status: 'HANDLE_NOT_FOUND' };
    if (!response.ok) return { channelId: null, status: `CHANNEL_PAGE_HTTP_${response.status}` };
    const html = (await response.text()).slice(0, 2_000_000);
    const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/u.exec(html)?.[1]
      ?? /"externalId":"(UC[A-Za-z0-9_-]{22})"/u.exec(html)?.[1];
    return id ? { channelId: id, status: 'RESOLVED_PAGE' } : { channelId: null, status: 'CHANNEL_ID_NOT_FOUND' };
  } catch {
    return { channelId: null, status: 'CHANNEL_PAGE_UNREACHABLE' };
  }
}
