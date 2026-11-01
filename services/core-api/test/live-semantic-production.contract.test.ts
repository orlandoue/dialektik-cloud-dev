import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  groundLiveClaim,
  groundLiveClaims,
  validateLivePairAssessment,
  validateLiveStancePairAssessment,
  LIVE_STANCE_PAIR_PROMPT,
  LIVE_STANCE_PAIR_PROMPT_SHA256,
} from "../src/semantic/live-semantic-production.contract.js";

const claim = (quotedText: string) => ({
  status: "EXTRACTED",
  eventKey: "alza-ipom-2026",
  eventTitle: "Banco Central ajusta proyección de crecimiento",
  eventSummary: "El IPoM modifica el rango de crecimiento esperado para 2026.",
  quotedText,
  assertionText: "El IPoM modifica el rango de crecimiento para 2026.",
  positionSummary: "El Banco Central proyecta un menor crecimiento.",
});

describe("live semantic production grounding", () => {
  it("converts a literal quote to zero-based Unicode code-point offsets", () => {
    const text = "Titular 📰. La inflación continúa sobre la meta de 3%.";
    const quote = "La inflación continúa sobre la meta de 3%.";
    const result = groundLiveClaim(claim(quote), text, "Titular 📰");

    expect(result.quotedText).toBe(quote);
    expect(
      Array.from(text).slice(result.charStart!, result.charEnd!).join(""),
    ).toBe(quote);
    expect(result.charStart).toBe(Array.from("Titular 📰. ").length);
    expect(result.usedFallback).toBe(false);
  });

  it("falls back to an exact first excerpt sentence when the model alters the quote", () => {
    const text =
      "Titular. Cooperativa informó que la medida comenzará en enero. El anuncio fue publicado hoy.";
    const result = groundLiveClaim(
      claim("Cooperativa informo que comenzara en enero."),
      text,
      "Titular",
    );

    expect(result.quotedText).toBe(
      "Cooperativa informó que la medida comenzará en enero.",
    );
    expect(
      Array.from(text).slice(result.charStart!, result.charEnd!).join(""),
    ).toBe(result.quotedText);
    expect(result.usedFallback).toBe(true);
  });

  it("grounds multiple non-overlapping claims with exact Unicode offsets", () => {
    const text = "Titular. La ministra negó haber recibido la alerta. El fiscal afirmó que sí fue informada.";
    const result = groundLiveClaims({
      status: "EXTRACTED",
      eventKey: "ministra-alerta-fiscalia",
      eventTitle: "Investigación sobre alerta recibida",
      eventSummary: "La ministra y el fiscal describen de manera distinta si se recibió la alerta.",
      claims: [
        {
          quotedText: "La ministra negó haber recibido la alerta.",
          assertionText: "La ministra niega haber recibido la alerta.",
          positionSummary: "La ministra niega recepción de la alerta.",
        },
        {
          quotedText: "El fiscal afirmó que sí fue informada.",
          assertionText: "El fiscal sostiene que la ministra fue informada.",
          positionSummary: "La fiscalía afirma que la ministra recibió la alerta.",
        },
      ],
    }, text, "Titular");

    expect(result.claims).toHaveLength(2);
    for (const item of result.claims) {
      expect(Array.from(text).slice(item.charStart!, item.charEnd!).join("")).toBe(item.quotedText);
    }
  });

  it("rejects an inconsistent pair assessment", () => {
    expect(() =>
      validateLivePairAssessment({
        sameEvent: false,
        sameEventConfidence: 95,
        relation: "CONTRADICTORY",
        ratioConflicting: 80,
        ratioComparable: 90,
      }),
    ).toThrow("LIVE_SEMANTIC_SCHEMA_INVALID");
  });

  it("preserves conservative conflict and comparability scores", () => {
    expect(
      validateLivePairAssessment({
        sameEvent: true,
        sameEventConfidence: 82,
        relation: "CONTRADICTORY",
        ratioConflicting: 65,
        ratioComparable: 80,
      }),
    ).toEqual({
      sameEvent: true,
      sameEventConfidence: 82,
      relation: "CONTRADICTORY",
      ratioConflicting: 65,
      ratioComparable: 80,
    });
  });

  it("enforces distinct comparable ranges for stance divergence and contradiction", () => {
    const pair = { sameEvent: true, sameEventConfidence: 80, relation: "DIVERGENT", ratioConflicting: 40, ratioComparable: 75 };
    expect(validateLiveStancePairAssessment(pair)).toEqual(pair);
    expect(() => validateLiveStancePairAssessment({ ...pair, ratioConflicting: 55 })).toThrow();
    expect(() => validateLiveStancePairAssessment({ ...pair, relation: "CONTRADICTORY", ratioConflicting: 54 })).toThrow();
    expect(validateLiveStancePairAssessment({ ...pair, relation: "CONTRADICTORY", ratioConflicting: 55 }).relation).toBe("CONTRADICTORY");
    expect(() => validateLiveStancePairAssessment({ ...pair, ratioComparable: 59 })).toThrow();
    expect(() => validateLiveStancePairAssessment({ ...pair, relation: "NOT_COMPARABLE", ratioComparable: 80 })).toThrow();
  });

  it("binds the stance prompt to its declared version fingerprint", () => {
    expect(createHash("sha256").update(LIVE_STANCE_PAIR_PROMPT).digest("hex")).toBe(LIVE_STANCE_PAIR_PROMPT_SHA256);
  });
});
