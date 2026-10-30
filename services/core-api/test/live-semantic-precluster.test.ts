import { describe, expect, it } from "vitest";
import {
  canAddSemanticPairToClique,
  preclusterLiveSemanticArticles,
} from "../src/semantic/live-semantic-precluster.js";

function article(
  articleId: string,
  sourceId: string,
  publishedAt: string,
  headline: string,
) {
  return {
    articleId,
    sourceId,
    publishedAt: new Date(publishedAt),
    headline,
    eventKey: "",
    eventTitle: "",
    eventSummary: "",
  };
}

describe("live semantic 48 hour pre-clustering", () => {
  it("uses the Santiago calendar window and a specific shared named entity", () => {
    const pairs = preclusterLiveSemanticArticles(
      [
        article("01M4YDQK000000000000000001", "source-a", "2026-10-29T03:05:00.000Z", "Caso Monsalve: Fiscalía amplía diligencias"),
        article("01M4YDQK000000000000000002", "source-b", "2026-10-31T02:55:00.000Z", "Interior informa nuevas diligencias del caso Monsalve"),
        article("01M4YDQK000000000000000003", "source-c", "2026-10-31T03:05:00.000Z", "Caso Monsalve: nueva audiencia"),
      ],
      "2026-10-29",
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.clusterKey).toBe("entity:monsalve");
  });

  it("does not use generic topics or compare articles from the same source", () => {
    const pairs = preclusterLiveSemanticArticles(
      [
        article("01M4YDQK000000000000000001", "source-a", "2026-10-29T13:00:00.000Z", "Servel prepara elecciones municipales"),
        article("01M4YDQK000000000000000002", "source-a", "2026-10-29T14:00:00.000Z", "Servel informa calendario electoral"),
        article("01M4YDQK000000000000000003", "source-b", "2026-10-29T15:00:00.000Z", "Temblor se percibe en la zona norte"),
      ],
      "2026-10-29",
    );

    expect(pairs).toEqual([]);
  });

  it("keeps bridge articles out unless every cross-pair confirms the same incident", () => {
    const confirmed = new Set([
      "article-a\narticle-b",
      "article-b\narticle-c",
    ]);
    expect(
      canAddSemanticPairToClique(
        ["article-a", "article-b"],
        "article-b",
        "article-c",
        confirmed,
      ),
    ).toBe(false);
    confirmed.add("article-a\narticle-c");
    expect(
      canAddSemanticPairToClique(
        ["article-a", "article-b"],
        "article-b",
        "article-c",
        confirmed,
      ),
    ).toBe(true);
  });
});
