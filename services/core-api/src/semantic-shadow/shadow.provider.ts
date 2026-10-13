import {
  FROZEN_V10_11_IDENTITY,
  type ShadowCandidateIdentity,
  type ShadowInputGate,
  type ShadowSourceRepresentation,
} from './shadow.contracts.js';

export function assertFrozenShadowIdentity(identity: ShadowCandidateIdentity): void {
  if (
    identity.commit !== FROZEN_V10_11_IDENTITY.commit ||
    identity.version !== FROZEN_V10_11_IDENTITY.version ||
    identity.runtime.python !== FROZEN_V10_11_IDENTITY.runtime.python ||
    identity.runtime.model !== FROZEN_V10_11_IDENTITY.runtime.model
  ) {
    throw new Error('FROZEN_CANDIDATE_IDENTITY_MISMATCH');
  }
}

export function classifyFrozenShadowInput(input: ShadowSourceRepresentation): ShadowInputGate {
  // The V10.11 launcher does not set title_only. Never read an excerpt as body.
  if (
    input.representation !== 'full_source_text' ||
    input.body === null ||
    input.body.trim().length === 0
  ) {
    return { classification: 'INVALID_FOR_CANDIDATE', reasonCode: 'FULL_SOURCE_REQUIRED' };
  }
  if (!input.fullSourceRightsAuthorized) {
    return { classification: 'INVALID_FOR_CANDIDATE', reasonCode: 'FULL_SOURCE_RIGHTS_REQUIRED' };
  }
  if (!input.permanentExclusionVerified) {
    return { classification: 'INVALID_FOR_CANDIDATE', reasonCode: 'PERMANENT_EXCLUSION_REQUIRED' };
  }
  // This establishes source representation only, not complete frozen wire input
  // eligibility, batch authority or an enabled candidate transport.
  return { classification: 'FULL_SOURCE_REPRESENTATION_PRESENT', reasonCode: null };
}

/**
 * Product-safe transport contract only. No candidate imports, launcher or default
 * transport exists. Current LIVE input never reaches this seam. Registering a
 * real launcher/output mapper requires a separately authenticated eligible batch.
 */
export interface FrozenShadowTransport {
  invoke(input: ShadowSourceRepresentation, signal: AbortSignal): Promise<unknown>;
}

export class FrozenShadowInputBoundary {
  constructor(
    private readonly identity: ShadowCandidateIdentity = FROZEN_V10_11_IDENTITY,
    private readonly transport?: FrozenShadowTransport,
  ) {}

  observe(input: ShadowSourceRepresentation): Promise<never> {
    return Promise.resolve().then(() => {
      assertFrozenShadowIdentity(this.identity);
      const gate = classifyFrozenShadowInput(input);
      if (gate.classification === 'INVALID_FOR_CANDIDATE')
        throw new Error(gate.reasonCode ?? 'INVALID_INPUT');
      if (this.transport === undefined) throw new Error('CANDIDATE_TRANSPORT_UNAVAILABLE');
      // The representation gate alone does not authenticate the complete frozen
      // input/output mapping or a locked batch receipt. No transport is invoked,
      // including a supplied future transport, before those gates are registered.
      throw new Error('FROZEN_INPUT_OUTPUT_MAPPING_NOT_REGISTERED');
    });
  }
}
