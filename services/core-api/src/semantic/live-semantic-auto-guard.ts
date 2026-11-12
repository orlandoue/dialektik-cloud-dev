import { validateLiveStancePairAssessment } from './live-semantic-production.contract.js';
import { isSportsText } from './live-semantic-scheduler-prefilter.js';

export interface AutoGuardArticle {
  readonly sourceId: string;
  readonly textOriginal: string;
  readonly selectedQuote: string;
  readonly start: number;
  readonly end: number;
  readonly publishedAt: Date;
}

/** Necessary checks before calling the canonical promotion transaction. */
export function validateAutoScope(raw: unknown, left: AutoGuardArticle, right: AutoGuardArticle) {
  if (!left.sourceId || !right.sourceId || left.sourceId === right.sourceId)
    throw new Error('AUTO_SCOPE_SOURCES_INVALID');
  const elapsed = Math.abs(left.publishedAt.getTime() - right.publishedAt.getTime());
  if (!Number.isFinite(elapsed) || elapsed > 48 * 60 * 60 * 1000)
    throw new Error('AUTO_SCOPE_WINDOW_INVALID');
  for (const article of [left, right]) {
    if (!article.selectedQuote || !Number.isInteger(article.start) || !Number.isInteger(article.end) ||
        article.start < 0 || article.end <= article.start ||
        Array.from(article.textOriginal).slice(article.start, article.end).join('') !== article.selectedQuote)
      throw new Error('AUTO_SCOPE_PROVENANCE_INVALID');
  }
  // Shared with the pre-model filter so a mixed pair never reaches the model.
  if (isSportsText(left.textOriginal) !== isSportsText(right.textOriginal)) throw new Error('AUTO_SCOPE_TOPIC_INVALID');
  const result = validateLiveStancePairAssessment(raw);
  if (!result.sameEvent || result.sameEventConfidence < 70 || result.ratioComparable < 60 || result.relation === 'NOT_COMPARABLE')
    throw new Error('AUTO_SCOPE_ASSESSMENT_INVALID');
  return result;
}
