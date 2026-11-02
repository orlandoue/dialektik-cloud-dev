import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchYouTubeDataApiItems,
  YouTubeDataApiError,
  youtubePlaylistId,
  youtubeApiKey,
  youtubeDataApiRssPayload,
} from "../dist/live/youtube-data-api.js";

const channelId = "UCkccyEbqhhM3uKOI6Shm-4Q";
const item = (id = "abcdefghijk", overrides = {}) => ({
  snippet: {
    channelId,
    title: "Noticia del canal",
    description: "x".repeat(800),
    publishedAt: "2026-10-30T12:00:00Z",
    channelTitle: "Canal de prueba",
    resourceId: { kind: "youtube#video", videoId: id },
    ...overrides,
  },
});
const jsonResponse = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
const source = {
  sourceId: "01M4YDQK00YT01MEGAN0T1C1AS",
  channelUrl: `https://www.youtube.com/channel/${channelId}`,
  feedEndpoint: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
  publisherName: "Canal de prueba",
};

test("maps official playlistItems responses to attributed bounded metadata", async () => {
  let requestUrl;
  const result = await fetchYouTubeDataApiItems(
    source,
    "test-key",
    async (url) => {
      requestUrl = new URL(url);
      return jsonResponse({ items: [item()] });
    },
  );

  assert.equal(youtubePlaylistId(channelId), "UU" + channelId.slice(2));
  assert.equal(result.channelId, channelId);
  assert.equal(result.items.length, 1);
  assert.equal(
    result.items[0].canonicalUrl,
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  assert.equal(result.items[0].excerpt.length, 700);
  assert.equal(result.items[0].sourceItemId, "abcdefghijk");
  assert.equal(result.apiEndpoint.includes("key="), false);
  assert.equal(
    requestUrl.searchParams.get("playlistId"),
    "UU" + channelId.slice(2),
  );
  assert.equal(requestUrl.searchParams.get("maxResults"), "10");
  assert.equal(requestUrl.searchParams.get("key"), "test-key");
  const payload = youtubeDataApiRssPayload(result, "Canal & prueba");
  assert.match(payload, /Canal &amp; prueba/u);
  assert.match(payload, /<guid isPermaLink="false">abcdefghijk<\/guid>/u);
  assert.match(payload, /<description>x{700}<\/description>/u);
});

test("filters videos whose snippet belongs to a different channel", async () => {
  const result = await fetchYouTubeDataApiItems(source, "test-key", async () =>
    jsonResponse({
      items: [item("abcdefghijk", { channelId: "UC0000000000000000000000" })],
    }),
  );
  assert.equal(result.items.length, 0);
});

test("resolves legacy username feeds with official channels.list requests", async () => {
  const calls = [];
  const legacy = {
    ...source,
    channelUrl: "https://www.youtube.com/user/cnnchile",
    feedEndpoint: "https://www.youtube.com/feeds/videos.xml?user=cnnchile",
  };
  const result = await fetchYouTubeDataApiItems(
    legacy,
    "test-key",
    async (url) => {
      const parsed = new URL(url);
      calls.push(parsed);
      if (
        parsed.pathname.endsWith("/channels") &&
        parsed.searchParams.has("forUsername")
      )
        return jsonResponse({ items: [] });
      if (parsed.pathname.endsWith("/channels"))
        return jsonResponse({ items: [{ id: channelId }] });
      return jsonResponse({ items: [item()] });
    },
  );

  assert.equal(result.channelId, channelId);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].searchParams.get("forUsername"), "cnnchile");
  assert.equal(calls[1].searchParams.get("forHandle"), "@cnnchile");
  assert.equal(result.items.length, 1);
});

test("rejects missing keys and malformed channel identifiers without leaking credentials", async () => {
  await assert.rejects(
    fetchYouTubeDataApiItems(source, ""),
    (error) =>
      error instanceof YouTubeDataApiError &&
      error.code === "YOUTUBE_API_KEY_MISSING",
  );
  assert.throws(
    () => youtubePlaylistId("UCbad"),
    (error) => error.code === "CHANNEL_ID_INVALID",
  );
});


test("resolves either configured key, preferring the dedicated key", () => {
  assert.equal(youtubeApiKey({ YOUTUBE_API_KEY: "  a  ", GOOGLE_API_KEY: "b" }), "a");
  assert.equal(youtubeApiKey({ YOUTUBE_API_KEY: " ", GOOGLE_API_KEY: " b " }), "b");
  assert.equal(youtubeApiKey({}), null);
});

test("decodes entities in YouTube titles and bounded descriptions", async () => {
  const result = await fetchYouTubeDataApiItems(source, "test-key", async () => jsonResponse({
    items: [item("abcdefghijk", { title: "Noticias &#34;Chile&#34; &amp; más", description: "Una &#39;cita&#39; &ndash; hoy" })],
  }));
  assert.equal(result.items[0].headline, 'Noticias "Chile" & más');
  assert.equal(result.items[0].excerpt, "Una 'cita' – hoy");
});
