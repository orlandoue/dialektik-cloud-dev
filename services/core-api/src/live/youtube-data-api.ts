import { createHash } from "node:crypto";

const API_ROOT = "https://www.googleapis.com/youtube/v3";
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/u;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const MAX_DESCRIPTION_CHARACTERS = 700;

export interface YouTubeApiChannel {
  readonly sourceId: string;
  readonly channelUrl: string;
  readonly feedEndpoint: string;
  readonly publisherName: string;
}

export interface YouTubeApiItem {
  readonly canonicalUrl: string;
  readonly discoveredUrl: string;
  readonly headline: string;
  readonly excerpt: string | null;
  readonly author: string | null;
  readonly language: "es";
  readonly publishedAt: string;
  readonly modifiedAt: null;
  readonly originalPublishedAt: string;
  readonly originalModifiedAt: null;
  readonly declaredUpstream: string;
  readonly rawPayloadHash: string;
  readonly sourceItemId: string;
}

export interface YouTubeApiResult {
  readonly channelId: string;
  readonly apiEndpoint: string;
  readonly items: readonly YouTubeApiItem[];
}

export class YouTubeDataApiError extends Error {
  public constructor(readonly code: string) {
    super(code);
    this.name = "YouTubeDataApiError";
  }
}

function channelIdFromUrl(channelUrl: string): string | null {
  const match = channelUrl.match(
    /(?:^|\/)channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/u,
  );
  return match?.[1] ?? null;
}

function legacyUsername(feedEndpoint: string): string | null {
  try {
    const url = new URL(feedEndpoint);
    return url.searchParams.get("user");
  } catch {
    return null;
  }
}

export function youtubePlaylistId(channelId: string): string {
  if (!CHANNEL_ID.test(channelId))
    throw new YouTubeDataApiError("CHANNEL_ID_INVALID");
  return `UU${channelId.slice(2)}`;
}

export function youtubePlaylistItemsEndpoint(channelId: string): string {
  const url = new URL(`${API_ROOT}/playlistItems`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("playlistId", youtubePlaylistId(channelId));
  url.searchParams.set("maxResults", "10");
  return url.toString();
}

async function requestJson(
  endpoint: URL,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  endpoint.searchParams.set("key", apiKey);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new YouTubeDataApiError("YOUTUBE_API_NETWORK_ERROR");
  }
  if (!response.ok)
    throw new YouTubeDataApiError(`YOUTUBE_API_HTTP_${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json"))
    throw new YouTubeDataApiError("YOUTUBE_API_CONTENT_TYPE_INVALID");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new YouTubeDataApiError("YOUTUBE_API_RESPONSE_INVALID");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new YouTubeDataApiError("YOUTUBE_API_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

async function resolveChannelId(
  channel: YouTubeApiChannel,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const fromUrl = channelIdFromUrl(channel.channelUrl);
  if (fromUrl !== null) return fromUrl;

  const username = legacyUsername(channel.feedEndpoint);
  if (username === null || !/^[A-Za-z0-9._-]{1,100}$/u.test(username))
    throw new YouTubeDataApiError("CHANNEL_ID_UNAVAILABLE");

  const byUsername = new URL(`${API_ROOT}/channels`);
  byUsername.searchParams.set("part", "id");
  byUsername.searchParams.set("forUsername", username);
  const usernameResult = await requestJson(byUsername, apiKey, fetchImpl);
  const usernameItems = Array.isArray(usernameResult.items)
    ? usernameResult.items
    : [];
  const usernameId = (usernameItems[0] as { id?: unknown } | undefined)?.id;
  if (typeof usernameId === "string" && CHANNEL_ID.test(usernameId))
    return usernameId;

  const byHandle = new URL(`${API_ROOT}/channels`);
  byHandle.searchParams.set("part", "id");
  byHandle.searchParams.set(
    "forHandle",
    username.startsWith("@") ? username : `@${username}`,
  );
  const handleResult = await requestJson(byHandle, apiKey, fetchImpl);
  const handleItems = Array.isArray(handleResult.items)
    ? handleResult.items
    : [];
  const handleId = (handleItems[0] as { id?: unknown } | undefined)?.id;
  if (typeof handleId !== "string" || !CHANNEL_ID.test(handleId))
    throw new YouTubeDataApiError("CHANNEL_ID_UNRESOLVED");
  return handleId;
}

export async function fetchYouTubeDataApiItems(
  channel: YouTubeApiChannel,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeApiResult> {
  if (apiKey.trim().length === 0)
    throw new YouTubeDataApiError("YOUTUBE_API_KEY_MISSING");
  const channelId = await resolveChannelId(channel, apiKey.trim(), fetchImpl);
  const endpoint = youtubePlaylistItemsEndpoint(channelId);
  const response = await requestJson(
    new URL(endpoint),
    apiKey.trim(),
    fetchImpl,
  );
  const rawItems = Array.isArray(response.items) ? response.items : [];
  if (rawItems.length > 10)
    throw new YouTubeDataApiError("YOUTUBE_API_ITEM_COUNT_INVALID");

  const items = rawItems.flatMap((raw): YouTubeApiItem[] => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      return [];
    const object = raw as Record<string, unknown>;
    const snippet = object.snippet;
    if (
      snippet === null ||
      typeof snippet !== "object" ||
      Array.isArray(snippet)
    )
      return [];
    const data = snippet as Record<string, unknown>;
    const resource = data.resourceId;
    const videoId =
      resource !== null &&
      typeof resource === "object" &&
      !Array.isArray(resource)
        ? (resource as Record<string, unknown>).videoId
        : null;
    if (
      data.channelId !== channelId ||
      typeof videoId !== "string" ||
      !VIDEO_ID.test(videoId) ||
      typeof data.title !== "string" ||
      data.title.trim().length === 0 ||
      Array.from(data.title).length > 500 ||
      typeof data.publishedAt !== "string" ||
      !Number.isFinite(Date.parse(data.publishedAt))
    )
      return [];

    const description =
      typeof data.description === "string" ? data.description.trim() : "";
    const excerpt =
      Array.from(description).slice(0, MAX_DESCRIPTION_CHARACTERS).join("") ||
      null;
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const author =
      typeof data.channelTitle === "string"
        ? data.channelTitle.slice(0, 200)
        : null;
    const normalizedPayload = JSON.stringify(object);
    return [
      {
        canonicalUrl,
        discoveredUrl: endpoint,
        headline: data.title.trim(),
        excerpt,
        author,
        language: "es",
        publishedAt: new Date(data.publishedAt).toISOString(),
        modifiedAt: null,
        originalPublishedAt: data.publishedAt,
        originalModifiedAt: null,
        declaredUpstream: channel.publisherName,
        rawPayloadHash: createHash("sha256")
          .update(normalizedPayload, "utf8")
          .digest("hex"),
        sourceItemId: videoId,
      },
    ];
  });
  return { channelId, apiEndpoint: endpoint, items };
}
