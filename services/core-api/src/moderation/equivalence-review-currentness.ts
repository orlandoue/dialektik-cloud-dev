import type { CandidateClassState, ModerationTaskState } from '@dialektik/database';

export interface EquivalenceReviewSnapshotSignals {
  readonly candidateState: CandidateClassState;
  readonly taskState: ModerationTaskState;
  readonly eventIsCurrent: boolean;
  readonly everyArticleBelongsToEvent: boolean;
  readonly everyAssertionIsCurrent: boolean;
  readonly everyInterpretationIsCurrent: boolean;
  readonly everySpanIsCurrent: boolean;
  readonly memberCount: number;
  readonly phase5ProposalIsValid: boolean;
}

export type EquivalenceReviewStaleReason =
  | 'candidate_not_proposed'
  | 'task_not_active'
  | 'event_merged'
  | 'article_event_changed'
  | 'assertion_not_current'
  | 'interpretation_not_current'
  | 'span_tombstoned'
  | 'candidate_incomplete'
  | 'phase5_proposal_invalid';

export interface EquivalenceReviewCurrentness {
  readonly isCurrentSnapshot: boolean;
  readonly staleReasons: readonly EquivalenceReviewStaleReason[];
}

/** Read-side safety only. This function grants no permission and changes no state. */
export function assessEquivalenceReviewCurrentness(
  signals: Readonly<EquivalenceReviewSnapshotSignals>,
): EquivalenceReviewCurrentness {
  const staleReasons: EquivalenceReviewStaleReason[] = [];
  if (signals.candidateState !== 'proposed') staleReasons.push('candidate_not_proposed');
  if (signals.taskState !== 'pending' && signals.taskState !== 'escalated') {
    staleReasons.push('task_not_active');
  }
  if (!signals.eventIsCurrent) staleReasons.push('event_merged');
  if (!signals.everyArticleBelongsToEvent) staleReasons.push('article_event_changed');
  if (!signals.everyAssertionIsCurrent) staleReasons.push('assertion_not_current');
  if (!signals.everyInterpretationIsCurrent) staleReasons.push('interpretation_not_current');
  if (!signals.everySpanIsCurrent) staleReasons.push('span_tombstoned');
  if (signals.memberCount < 2) staleReasons.push('candidate_incomplete');
  if (!signals.phase5ProposalIsValid) staleReasons.push('phase5_proposal_invalid');

  return Object.freeze({
    isCurrentSnapshot: staleReasons.length === 0,
    staleReasons: Object.freeze(staleReasons),
  });
}
