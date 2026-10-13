/** State Matrix dimensions remain independent types. They are not alternatives. */
export type EpistemicClass =
  | 'not_evaluable'
  | 'non_comparable'
  | 'no_evidence_yet'
  | 'inconclusive'
  | 'analysis_pending';

export type SystemState = 'success' | 'validation_error' | 'permission_denied' | 'offline';

export type NetworkState = 'live' | 'cached' | 'stale' | 'partial';

export type LoadingState = 'idle' | 'loading' | 'error';

export type PublicationState =
  | 'internal'
  | 'proposed'
  | 'published'
  | 'requires_review'
  | 'retracted';

export type ModerationState =
  | 'pending'
  | 'partially_accepted'
  | 'rejected'
  | 'escalated'
  | 'resolved';

export type InteractionState = 'default' | 'hover' | 'pressed' | 'focus' | 'disabled' | 'expanded';
