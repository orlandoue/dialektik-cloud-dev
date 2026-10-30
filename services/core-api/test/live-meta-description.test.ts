import { describe, expect, it } from "vitest";
import { fetchMetaDescription, parseMetaDescription } from "../src/live/meta-description.js";

describe("live page metadata fallback", () => {
  it("decodes the public description and bounds it to 700 characters", () => {
    const description = `A &quot;verified&quot; claim ${"noticia ".repeat(100)}`;
    const result = parseMetaDescription(
      `<html><head><meta property="og:description" content="${description}"></head><body>ignored</body></html>`,
    );

    expect(result).not.toBeNull();
    expect(Array.from(result ?? "").length).toBeLessThanOrEqual(700);
    expect(result).toContain('A "verified" claim');
  });

  it("honors robots.txt before requesting an article page", async () => {
    const requests: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nDisallow: /private/\n", { status: 200 });
      return new Response('<meta name="description" content="Should not be fetched">', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    const result = await fetchMetaDescription(
      "https://meta-robots-denied.test/private/story",
      ["meta-robots-denied.test"],
      fakeFetch,
    );

    expect(result).toBeNull();
    expect(requests).toEqual(["https://meta-robots-denied.test/robots.txt"]);
  });

  it("fails closed if robots.txt cannot be read and rejects non-allowlisted hosts", async () => {
    let requests = 0;
    const fakeFetch = (async () => {
      requests += 1;
      throw new Error("network unavailable");
    }) as typeof fetch;

    expect(
      await fetchMetaDescription("https://meta-robots-error.test/story", ["meta-robots-error.test"], fakeFetch),
    ).toBeNull();
    expect(
      await fetchMetaDescription("https://outside.test/story", ["allowed.test"], fakeFetch),
    ).toBeNull();
    expect(requests).toBe(1);
  });
});
