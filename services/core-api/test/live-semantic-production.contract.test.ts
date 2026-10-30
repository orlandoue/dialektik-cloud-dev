import { describe, expect, it } from "vitest";
import {
  groundLiveClaim,
  validateLivePairAssessment,
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
});
