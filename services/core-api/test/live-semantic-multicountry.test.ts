import { describe, expect, it } from "vitest";
import {
  canPairAcrossOutlets,
  editorialLeanBonus,
  interleaveByCountry,
  preclusterLiveSemanticArticles,
  type SemanticPreclusterArticle,
} from "../src/semantic/live-semantic-precluster.js";
import { hasStrongPairOverlap } from "../src/semantic/live-semantic-scheduler-prefilter.js";

const item = (
  articleId: string,
  sourceId: string,
  countryCode: string,
  mediaGroup: string,
  headline: string,
): SemanticPreclusterArticle => ({
  articleId, sourceId, countryCode, mediaGroup, headline,
  publishedAt: new Date("2026-11-14T15:00:00.000Z"),
  eventKey: "", eventTitle: headline, eventSummary: "",
});

describe("multi-country candidate pairing", () => {
  it("never pairs across countries nor two outlets of one media group", () => {
    const pairs = preclusterLiveSemanticArticles([
      item("a1", "s-elpais-rss", "ES", "es-el-pais", "Sánchez anuncia reforma fiscal de Hacienda en el Congreso"),
      item("a2", "s-elpais-yt", "ES", "es-el-pais", "Sánchez anuncia reforma fiscal de Hacienda en el Congreso"),
      item("a3", "s-abc", "ES", "es-abc", "Sánchez defiende reforma fiscal de Hacienda ante el Congreso"),
      item("a4", "s-clarin", "AR", "ar-clarin", "Sánchez anuncia reforma fiscal de Hacienda en el Congreso"),
    ], "2026-11-14");
    const keys = pairs.map((pair) => [pair.left.articleId, pair.right.articleId].sort().join("-")).sort();
    expect(keys).toEqual(["a1-a3", "a2-a3"]);
  });

  it("treats sources without a profile as Chilean outlets of their own", () => {
    expect(canPairAcrossOutlets({}, {})).toBe(true);
    expect(canPairAcrossOutlets({ countryCode: "CL" }, {})).toBe(true);
    expect(canPairAcrossOutlets({ countryCode: "US" }, {})).toBe(false);
    expect(canPairAcrossOutlets({ countryCode: "US", mediaGroup: "us-fox-news" }, { countryCode: "US", mediaGroup: "us-fox-news" })).toBe(false);
  });

  it("ranks pairs that cross the editorial spectrum first", () => {
    expect(editorialLeanBonus("progresista/izquierda", "conservador/derecha")).toBe(2);
    expect(editorialLeanBonus("centro-izquierda", "centro/agencia neutral")).toBe(1);
    expect(editorialLeanBonus("centro-derecha", "periodismo de investigacion/economico")).toBe(1);
    expect(editorialLeanBonus("centro-derecha", "conservador/derecha")).toBe(0);
    expect(editorialLeanBonus(null, "centro")).toBe(0);
  });

  it("spreads the model budget round-robin across CL, ES, AR and US", () => {
    const ranked = ["US1", "US2", "US3", "CL1", "ES1", "ES2", "AR1"];
    expect(interleaveByCountry(ranked, (id) => id.slice(0, 2))).toEqual(["CL1", "ES1", "AR1", "US1", "ES2", "US2", "US3"]);
  });

  it("keeps English Title Case headlines on distinct names, not common words", () => {
    const fox = "Senate Republicans Block Ukraine Aid Package After Shutdown Talks";
    const msnbc = "Senate Republicans Block Ukraine Aid Package, Democrats Say";
    expect(hasStrongPairOverlap(fox, "Republicans blocked the Ukraine aid package in the Senate vote.",
      msnbc, "Democrats said Republicans blocked the Ukraine aid package.")).toBe(true);
    expect(hasStrongPairOverlap("What We Know About The Latest Report Today", "What they said this week about the report.",
      "What You Need To Know About The Latest Video Today", "What they said this week about the video.")).toBe(false);
    const pairs = preclusterLiveSemanticArticles([
      item("u1", "s-fox", "US", "us-fox-news", "What Happens Next After The Latest Report"),
      item("u2", "s-npr", "US", "us-npr", "What Happens Next After The Latest Video"),
    ], "2026-11-14");
    expect(pairs).toEqual([]);
  });
});
