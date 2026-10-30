import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchYouTubeDataApiItems,
  YouTubeDataApiError,
} from "../../../services/core-api/dist/live/youtube-data-api.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalogFile = resolve(
  root,
  "packages/database/src/migration/054_chile_feed_excerpt_and_youtube_sources.ts",
);
const catalogText = readFileSync(catalogFile, "utf8");
const catalogMatch = catalogText.match(
  /const YOUTUBE_CHANNELS = (\[.*?\]) as const;/s,
);
if (!catalogMatch) throw new Error("YOUTUBE_CATALOG_NOT_FOUND");
const channels = JSON.parse(catalogMatch[1]);
if (
  channels.length !== 32 ||
  new Set(channels.map((entry) => entry.source_id)).size !== 32
)
  throw new Error("YOUTUBE_CATALOG_INVALID");

const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : item,
  );
const digest = (value) =>
  createHash("sha256").update(canonical(value), "utf8").digest("hex");
const dateInSantiago = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const targetDate = dateInSantiago(new Date());
const outputPath = resolve(process.argv[2] ?? "youtube-data-api-manifest.json");
const apiKey = process.env.YOUTUBE_API_KEY?.trim() ?? "";
const entries = [];

for (const channel of channels) {
  const base = {
    source_id: channel.source_id,
    policy_endpoint: channel.atom_feed_endpoint,
  };
  if (apiKey.length === 0) {
    entries.push({
      ...base,
      status: "skipped",
      error_code: "YOUTUBE_API_KEY_MISSING",
    });
    continue;
  }
  try {
    const result = await fetchYouTubeDataApiItems(
      {
        sourceId: channel.source_id,
        channelUrl: channel.channel_url,
        feedEndpoint: channel.atom_feed_endpoint,
        publisherName: channel.name,
      },
      apiKey,
    );
    entries.push({
      ...base,
      status: "succeeded",
      channel_id: result.channelId,
      discovery_channel: "official_api",
      discovery_url: result.apiEndpoint,
      items: result.items
        .filter(
          (item) => dateInSantiago(new Date(item.publishedAt)) === targetDate,
        )
        .map((item) => ({ ...item, channelId: result.channelId })),
    });
  } catch (error) {
    const code =
      error instanceof YouTubeDataApiError
        ? error.code
        : "YOUTUBE_API_REQUEST_FAILED";
    entries.push({ ...base, status: "failed", error_code: code });
  }
}

const manifest = {
  schema: "dialektik-youtube-data-api-manifest-v1",
  fetched_at: new Date().toISOString(),
  channels: entries,
};
manifest.sha256 = createHash("sha256")
  .update(canonical(manifest), "utf8")
  .digest("hex");
mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
writeFileSync(outputPath, JSON.stringify(manifest), { mode: 0o600 });

const succeeded = entries.filter(
  (entry) => entry.status === "succeeded",
).length;
const videos = entries.reduce(
  (total, entry) => total + (entry.items?.length ?? 0),
  0,
);
const skipped = entries.filter((entry) => entry.status === "skipped").length;
const failed = entries.filter((entry) => entry.status === "failed").length;
console.log(
  `YouTube Data API channels: ${succeeded}/32; videos: ${videos}; skipped: ${skipped}; failed: ${failed}.`,
);
