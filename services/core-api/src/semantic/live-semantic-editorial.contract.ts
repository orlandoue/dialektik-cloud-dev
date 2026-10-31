import { isUlid } from "@dialektik/database";
import { ModerationHttpError } from "../moderation/moderation-http.error.js";

export interface SelectedSemanticClaim {
  readonly articleId: string;
  readonly ordinal: number;
}

export interface SemanticPromotionDecision {
  readonly groupId: string;
  readonly title: string;
  readonly reason: string;
  readonly claims: readonly SelectedSemanticClaim[];
  readonly approvedConflictPairIds: readonly string[];
}

function invalid(): never {
  throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

function reasonText(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const reason = value.trim();
  if (reason.length < 12 || reason.length > 500) return invalid();
  return reason;
}

export function parseSemanticPromotionDecision(raw: unknown): SemanticPromotionDecision {
  const value = record(raw);
  if (Object.keys(value).some((key) =>
    !["groupId", "title", "reason", "claims", "approvedConflictPairIds"].includes(key)))
    return invalid();
  if (typeof value.groupId !== "string" || !isUlid(value.groupId) ||
      typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 240 ||
      !Array.isArray(value.claims) || value.claims.length < 2 || value.claims.length > 150)
    return invalid();
  const claims = value.claims.map((rawClaim): SelectedSemanticClaim => {
    const claim = record(rawClaim);
    if (Object.keys(claim).length !== 2 || typeof claim.articleId !== "string" ||
        !isUlid(claim.articleId) || !Number.isInteger(claim.ordinal) ||
        Number(claim.ordinal) < 1 || Number(claim.ordinal) > 3)
      return invalid();
    return { articleId: claim.articleId, ordinal: Number(claim.ordinal) };
  });
  if (new Set(claims.map((claim) => `${claim.articleId}:${claim.ordinal}`)).size !== claims.length)
    return invalid();
  const pairs = value.approvedConflictPairIds ?? [];
  if (!Array.isArray(pairs) || pairs.length > 150 ||
      pairs.some((pair) => typeof pair !== "string" || !isUlid(pair)) ||
      new Set(pairs).size !== pairs.length)
    return invalid();
  return {
    groupId: value.groupId,
    title: value.title.trim(),
    reason: reasonText(value.reason),
    claims,
    approvedConflictPairIds: pairs as string[],
  };
}

export function parseSemanticRejection(raw: unknown): { groupId: string; reason: string } {
  const value = record(raw);
  if (Object.keys(value).length !== 2 || typeof value.groupId !== "string" || !isUlid(value.groupId))
    return invalid();
  return { groupId: value.groupId, reason: reasonText(value.reason) };
}

export function parseLegacyContradictionReview(raw: unknown): { publicationId: string; reason: string } {
  const value = record(raw);
  if (Object.keys(value).length !== 2 || typeof value.publicationId !== "string" || !isUlid(value.publicationId))
    return invalid();
  return { publicationId: value.publicationId, reason: reasonText(value.reason) };
}
