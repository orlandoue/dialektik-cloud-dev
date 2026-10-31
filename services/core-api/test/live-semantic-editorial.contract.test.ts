import { describe, expect, it } from "vitest";
import { parseSemanticPromotionDecision, parseSemanticRejection } from "../src/semantic/live-semantic-editorial.contract.js";

const groupId = "01M6A34PHJ4NP75N9SM0YBP5CX";
const articleA = "01M4YDQK00EVART00000000001";
const articleB = "01M4YDQK00EVART00000000002";
const pairId = "01M4YDQK00EVART00000000003";
const valid = {
  groupId,
  title: "Un acontecimiento cubierto por dos fuentes",
  reason: "Ambas citas describen el mismo hecho.",
  claims: [{ articleId: articleA, ordinal: 2 }, { articleId: articleB, ordinal: 1 }],
};

describe("explicit semantic editorial decisions", () => {
  it("keeps each selected article and claim ordinal and defaults to no conflicts", () => {
    expect(parseSemanticPromotionDecision(valid)).toEqual({ ...valid, approvedConflictPairIds: [] });
    expect(parseSemanticPromotionDecision({ ...valid, approvedConflictPairIds: [pairId] }).approvedConflictPairIds)
      .toEqual([pairId]);
  });

  it("rejects promotion without an explicit selection and rejects duplicate or malformed selections", () => {
    expect(() => parseSemanticPromotionDecision({ groupId })).toThrow();
    expect(() => parseSemanticPromotionDecision({ ...valid, claims: [valid.claims[0], valid.claims[0]] })).toThrow();
    expect(() => parseSemanticPromotionDecision({ ...valid, claims: [{ articleId: articleA, ordinal: 4 }, valid.claims[1]] })).toThrow();
    expect(() => parseSemanticPromotionDecision({ ...valid, approvedConflictPairIds: [pairId, pairId] })).toThrow();
  });

  it("requires a recorded reason for a rejection", () => {
    expect(parseSemanticRejection({ groupId, reason: "Son hechos distintos." })).toEqual({
      groupId, reason: "Son hechos distintos.",
    });
    expect(() => parseSemanticRejection({ groupId, reason: "no" })).toThrow();
  });
});
