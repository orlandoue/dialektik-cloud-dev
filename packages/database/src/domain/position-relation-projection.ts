import type { Ulid } from './ids';

/**
 * Non-persistent result shape from the authoritative model.
 *
 * There is deliberately no identity, publication state, confirmer, timestamp,
 * ranking, or severity field on this recalculable internal projection.
 */
export interface PositionRelationProjection {
  readonly event_id: Ulid;
  readonly position_a_id: Ulid;
  readonly position_b_id: Ulid;
  readonly position_a_assertion_ids: readonly Ulid[];
  readonly position_b_assertion_ids: readonly Ulid[];
  readonly comparable_assertion_pairs: readonly (readonly [Ulid, Ulid])[];
  readonly contributing_r05_ids: readonly Ulid[];
  readonly comparable_pairs: number;
  readonly conflict_pairs: number;
  readonly conflict_ratio: number | null;
  readonly outcome: 'non_comparable' | 'no_confirmed_conflict' | 'conflict_present';
  readonly threshold_rule: 'v1:any_confirmed_conflict';
  readonly requires_review: boolean;
  readonly publication_eligible: boolean;
  readonly projection_hash: string;
}
