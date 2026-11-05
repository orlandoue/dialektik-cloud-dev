import { validateJointScope } from './live-semantic-scope.contract.js';

export interface AutoGuardArticle {
  readonly sourceId: string;
  readonly textOriginal: string;
  readonly selectedQuote: string;
  readonly publishedAt: Date;
  readonly category: string | null;
}

/** Validate the exact selected provenance before any automated promotion.
 * A positive result is necessary, never a substitute for the database gates.
 */
export function validateAutoScope(raw: unknown, left: AutoGuardArticle, right: AutoGuardArticle) {
  if (left.sourceId === right.sourceId || !left.sourceId || !right.sourceId)
    throw new Error('AUTO_SCOPE_SOURCES_INVALID');
  const elapsed = Math.abs(left.publishedAt.getTime() - right.publishedAt.getTime());
  if (!Number.isFinite(elapsed) || elapsed > 48 * 60 * 60 * 1000)
    throw new Error('AUTO_SCOPE_WINDOW_INVALID');
  if (!left.category || !right.category || left.category !== right.category)
    throw new Error('AUTO_SCOPE_CATEGORY_INVALID');
  const result = validateJointScope(raw, left.textOriginal, right.textOriginal);
  if (!result.scopeAligned || result.left.quotedText !== left.selectedQuote ||
      result.right.quotedText !== right.selectedQuote)
    throw new Error('AUTO_SCOPE_PROVENANCE_INVALID');
  return result;
}
