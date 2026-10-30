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
    expect(pairs[0]?.clusterKey).toBe("entity:monsalve:incident:diligencias");
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

  it("rejects shared politicians and broad topics when the incidents differ", () => {
    const pairs = preclusterLiveSemanticArticles(
      [
        {
          ...article("01M4YDQK000000000000000011", "source-a", "2026-10-29T13:00:00.000Z", "Diseñador Sergio Arias contó cómo llegó a vestir a Kast"),
          eventKey: "kasts-wardrobe-designer",
          eventTitle: "Sergio Arias on Kast's wardrobe",
          eventSummary: "Sergio Arias, Kast's wardrobe designer, shares his experience and criticizes the style of Kast's predecessors.",
        },
        {
          ...article("01M4YDQK000000000000000012", "source-b", "2026-10-29T14:00:00.000Z", "Partido Republicano pierde la paciencia con la UDI y RN"),
          eventKey: "kast-government-criticism",
          eventTitle: "Kast's Government Criticism",
          eventSummary: "Kast's government criticized for its actions.",
        },
        {
          ...article("01M4YDQK000000000000000013", "source-c", "2026-10-29T15:00:00.000Z", "Desempleo sube a 9,8% en España"),
          eventKey: "desempleo-en-espana-2024",
          eventTitle: "Desempleo en España",
          eventSummary: "La tasa de desempleo en España sube a 9,8%.",
        },
        {
          ...article("01M4YDQK000000000000000014", "source-d", "2026-10-29T16:00:00.000Z", "Desempleo regional llega al 9%"),
          eventKey: "desempleo-regional-llega-al-9",
          eventTitle: "Desempleo regional llega al 9%",
          eventSummary: "El desempleo regional alcanza el 9%.",
        },
      ],
      "2026-10-29",
    );

    expect(pairs).toEqual([]);
  });

  it("retains same-incident Codelco and exact Zverev event signatures", () => {
    const pairs = preclusterLiveSemanticArticles(
      [
        {
          ...article("01M4YDQK000000000000000021", "source-a", "2026-10-29T13:00:00.000Z", "Codelco despide a ocho ejecutivos por cifras erróneas de producción"),
          eventKey: "codelco-executives-fired",
          eventTitle: "Codelco fires eight executives",
          eventSummary: "Codelco fires eight executives over incorrect copper production figures.",
        },
        {
          ...article("01M4YDQK000000000000000022", "source-b", "2026-10-29T14:00:00.000Z", "Desvinculan a ocho altos cargos de Codelco por irregularidades en producción"),
          eventKey: "codelco-production-irregularities",
          eventTitle: "Codelco Production Irregularities",
          eventSummary: "Codelco executives and professionals were let go due to irregularities in production records.",
        },
        {
          ...article("01M4YDQK000000000000000023", "source-c", "2026-10-29T15:00:00.000Z", "Alexander Zverev hace historia y es número uno"),
          eventKey: "zverev-becomes-world-number-one",
          eventTitle: "Alexander Zverev becomes world number one",
          eventSummary: "Alexander Zverev becomes world number one after winning a match.",
        },
        {
          ...article("01M4YDQK000000000000000024", "source-d", "2026-10-29T16:00:00.000Z", "Zverev se convierte en el número uno del tenis"),
          eventKey: "zverev-becomes-world-number-one",
          eventTitle: "Zverev becomes world number one",
          eventSummary: "Alexander Zverev becomes the world number one in tennis.",
        },
      ],
      "2026-10-29",
    );

    expect(pairs).toHaveLength(2);
    expect(pairs.map((pair) => pair.clusterKey)).toContain(
      "entity:codelco:incident:executives-produccion",
    );
    expect(pairs.map((pair) => pair.clusterKey)).toContain(
      "signature:zverev-becomes-world-number-one",
    );
  });
});
