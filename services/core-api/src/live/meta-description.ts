import { cleanLiveText } from "./live.adapter.js";

const USER_AGENT = "DialektikLiveMetadata/1.0";
const MAX_ROBOTS_BYTES = 64 * 1024;
const MAX_HTML_HEAD_BYTES = 128 * 1024;
const MAX_DESCRIPTION_CHARACTERS = 700;
const FETCH_TIMEOUT_MS = 5000;

const robotsCache = new Map<string, { expiresAt: number; rules: string | null }>();

function boundedBody(
  response: Response,
  maximum: number,
  allowTruncatedPrefix = false,
): Promise<string | null> {
  return (async () => {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (bytes < maximum) {
        const part = await reader.read();
        if (part.done) break;
        const remaining = maximum - bytes;
        if (part.value.byteLength > remaining) {
          if (!allowTruncatedPrefix) return null;
          chunks.push(part.value.slice(0, remaining));
          bytes = maximum;
          break;
        }
        bytes += part.value.byteLength;
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(joined);
  })();
}

function robotsDisallows(htmlUrl: URL, robotsText: string | null): boolean {
  if (robotsText === null) return true;
  const applicable: Array<{ path: string; allow: boolean; length: number }> = [];
  let userAgentMatches = false;
  let currentGroupHasRules = false;
  let activeGroup = false;
  const lines = robotsText.split(/\r?\n/u);
  for (const line of lines) {
    const value = line.replace(/#.*/u, "").trim();
    if (!value) continue;
    const separator = value.indexOf(":");
    if (separator < 0) continue;
    const directive = value.slice(0, separator).trim().toLowerCase();
    const content = value.slice(separator + 1).trim();
    if (directive === "user-agent") {
      if (currentGroupHasRules) {
        activeGroup = false;
        currentGroupHasRules = false;
      }
      const agent = content.toLowerCase();
      activeGroup = agent === "*" || USER_AGENT.toLowerCase().includes(agent);
      if (activeGroup) userAgentMatches = true;
      continue;
    }
    if (directive !== "allow" && directive !== "disallow") continue;
    if (activeGroup && (directive === "allow" || content.length > 0)) {
      currentGroupHasRules = true;
      if (content.startsWith("/")) {
        applicable.push({
          path: content.replace(/\*.*$/u, ""),
          allow: directive === "allow",
          length: content.replace(/\*.*$/u, "").length,
        });
      }
    }
  }
  if (!userAgentMatches) return false;
  const pathname = `${htmlUrl.pathname}${htmlUrl.search}`;
  const match = applicable
    .filter((rule) => pathname.startsWith(rule.path))
    .sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow))[0];
  return match?.allow === false;
}

function metaAttributes(tag: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name && value !== undefined) attrs[name] = value;
  }
  return attrs;
}

export function parseMetaDescription(html: string): string | null {
  const head = html.slice(0, MAX_HTML_HEAD_BYTES).split(/<\/head\s*>/iu, 1)[0] ?? "";
  for (const match of head.matchAll(/<meta\b[^>]*>/giu)) {
    const attrs = metaAttributes(match[0]);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key !== "og:description" && key !== "description" && key !== "twitter:description")
      continue;
    const clean = cleanLiveText(attrs.content ?? null);
    if (clean === null) continue;
    const characters = Array.from(clean);
    if (characters.length <= MAX_DESCRIPTION_CHARACTERS) return clean;
    const bounded = characters.slice(0, MAX_DESCRIPTION_CHARACTERS).join("");
    const boundary = bounded.lastIndexOf(" ");
    return (boundary >= 500 ? bounded.slice(0, boundary) : bounded).trim();
  }
  return null;
}

async function robotsFor(origin: string, fetcher: typeof fetch): Promise<string | null> {
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.rules;
  try {
    const response = await fetcher(`${origin}/robots.txt`, {
      method: "GET",
      headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      robotsCache.set(origin, { expiresAt: Date.now() + 10 * 60_000, rules: null });
      return null;
    }
    const text = await boundedBody(response, MAX_ROBOTS_BYTES);
    robotsCache.set(origin, { expiresAt: Date.now() + 10 * 60_000, rules: text });
    return text;
  } catch {
    robotsCache.set(origin, { expiresAt: Date.now() + 10 * 60_000, rules: null });
    return null;
  }
}

/** Reads only a bounded HTML head; the page is never persisted or sent to an AI provider. */
export async function fetchMetaDescription(
  rawUrl: string,
  allowedDomains: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowedDomains.includes(url.hostname) ||
    url.hostname === "localhost" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(url.hostname)
  )
    return null;
  const robots = await robotsFor(url.origin, fetcher);
  if (robotsDisallows(url, robots)) return null;
  try {
    const response = await fetcher(url.toString(), {
      method: "GET",
      headers: { Accept: "text/html", "User-Agent": USER_AGENT },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status !== 200 || !/text\/html/iu.test(response.headers.get("content-type") ?? ""))
      return null;
    const html = await boundedBody(response, MAX_HTML_HEAD_BYTES, true);
    return html ? parseMetaDescription(html) : null;
  } catch {
    return null;
  }
}
