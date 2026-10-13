import { verifyLLMEnvelope } from '../llm-shadow/llm.envelope.js';
import type { LLMEnvelopeExtension } from '../llm-shadow/llm.contracts.js';
import { FROZEN_V10_11_IDENTITY } from '../semantic-shadow/shadow.contracts';
import type {
  EvidenceFingerprint,
  EphemeralProcessingRequest,
  ProviderEvidenceLocator,
  SemanticProviderIdentity,
} from './ephemeral.contracts';
import type { EphemeralArticleContent } from './ephemeral.content';
import { FROZEN_NORMALIZATION_VERSION } from './ephemeral.normalization';

export const NATIVE_ACTIONS = [
  'update_occurrence',
  'new_occurrence_in_existing_thread',
  'new_thread',
  'ambiguous',
] as const;
export const NATIVE_REASONS = [
  'llm_grounded_same_occurrence',
  'llm_grounded_same_thread',
  'llm_bounded_singleton',
  'llm_abstention',
  'no_bounded_occurrence_observation',
  'multi_observation_article_requires_decomposition',
  'multiple_identity_matches',
  'occurrence_thread_incompatibility',
  'no_automatic_occurrence_reparent',
  'unique_occurrence_match',
  'thread_match_all_children_distinct',
  'occurrence_identity_unknown',
  'thread_identity_unknown',
  'unresolved_prior_thread_comparison',
  'unresolved_prior_occurrence_comparison',
  'grounded_process_distinct_from_all_prior',
] as const;
/** Native per-Article action is independent from identity comparisons. */
export interface NativeArticleProposal {
  readonly action: (typeof NATIVE_ACTIONS)[number];
  readonly reasonCode: (typeof NATIVE_REASONS)[number];
  readonly proposedOccurrenceKey: string | null;
  readonly proposedThreadKey: string | null;
  readonly partialOccurrenceCreation: boolean;
}
/** This typed scope trace can exist with no identity comparison. */
export interface DurableCandidateApplicability {
  readonly scope: 'OCCURRENCE' | 'THREAD';
  readonly targetKey: string;
  readonly outcome: 'APPLICABLE' | 'INAPPLICABLE' | 'UNKNOWN_APPLICABILITY';
}
export interface DerivedSemanticObservation {
  readonly observationKey: string;
  readonly decision: 'MATCH' | 'DISTINCT' | 'UNKNOWN';
  readonly applicability: 'APPLICABLE' | 'INAPPLICABLE' | 'UNKNOWN_APPLICABILITY';
  readonly proposedOccurrenceKey: string | null;
  readonly proposedThreadKey: string | null;
}
export interface MappedSemanticOutput {
  readonly llm?: LLMEnvelopeExtension;
  readonly evidence: readonly EvidenceFingerprint[];
  readonly observations: readonly DerivedSemanticObservation[];
  readonly articleProposals: readonly NativeArticleProposal[];
  readonly candidateApplicability: readonly DurableCandidateApplicability[];
}
function objectWithKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MAPPING_FAILED');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).sort().join(',') !== [...keys].sort().join(','))
    throw new Error('MAPPING_FAILED');
  return result;
}
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export function assertProviderIdentity(identity: SemanticProviderIdentity): void {
  if (
    !keyPattern.test(identity.providerType) ||
    identity.providerType.length > 64 ||
    !keyPattern.test(identity.providerVersion) ||
    !(identity.candidateCommit === null || /^[0-9a-f]{40}$/.test(identity.candidateCommit))
  )
    throw new Error('INPUT_INVALID');
  if (
    identity.providerType === 'v10_11' &&
    (identity.candidateCommit !== FROZEN_V10_11_IDENTITY.commit ||
      identity.providerVersion !== FROZEN_V10_11_IDENTITY.version ||
      identity.runtime?.python !== FROZEN_V10_11_IDENTITY.runtime.python ||
      identity.runtime.model !== FROZEN_V10_11_IDENTITY.runtime.model)
  )
    throw new Error('INPUT_INVALID');
  if (
    identity.providerType === 'authored_stub' &&
    (identity.candidateCommit !== null || identity.runtime !== undefined)
  )
    throw new Error('INPUT_INVALID');
}
export function mapEphemeralProviderOutput(
  raw: unknown,
  content: EphemeralArticleContent,
  request: EphemeralProcessingRequest,
): MappedSemanticOutput {
  const extras =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const output = objectWithKeys(raw, [
    'evidence',
    'observations',
    ...(Object.hasOwn(extras, 'llm') ? ['llm'] : []),
    ...(Object.hasOwn(extras, 'articleProposals') ? ['articleProposals'] : []),
    ...(Object.hasOwn(extras, 'candidateApplicability') ? ['candidateApplicability'] : []),
  ]);
  const rawProposals = output.articleProposals ?? [];
  const rawApplicability = output.candidateApplicability ?? [];
  if (
    !Array.isArray(rawProposals) ||
    rawProposals.length > 1 ||
    !Array.isArray(rawApplicability) ||
    rawApplicability.length > 4096
  )
    throw new Error('MAPPING_FAILED');
  if (
    !Array.isArray(output.evidence) ||
    output.evidence.length > 256 ||
    !Array.isArray(output.observations) ||
    output.observations.length > 256
  )
    throw new Error('MAPPING_FAILED');
  const evidence = output.evidence.map((unknownLocator) => {
    const row = objectWithKeys(unknownLocator, [
      'field',
      'start',
      'end',
      'sourceSha256',
      'spanSha256',
    ]);
    if (
      !(row.field === 'title' || row.field === 'body') ||
      typeof row.start !== 'number' ||
      typeof row.end !== 'number' ||
      typeof row.sourceSha256 !== 'string' ||
      typeof row.spanSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.sourceSha256) ||
      !/^[a-f0-9]{64}$/.test(row.spanSha256)
    )
      throw new Error('MAPPING_FAILED');
    const locator: ProviderEvidenceLocator = {
      field: row.field,
      start: row.start,
      end: row.end,
      sourceSha256: row.sourceSha256,
      spanSha256: row.spanSha256,
    };
    content.verifyLocator(locator);
    return Object.freeze({
      ...locator,
      articleVersionId: request.metadata.articleVersionId,
      acquiredContentHash: content.acquiredContentHash,
      normalizedInputHash: content.normalizedInput.inputHash,
      normalizationVersion: FROZEN_NORMALIZATION_VERSION,
      providerRunId: request.providerRunId,
      retainedQuote: null,
    });
  });
  const observations = output.observations.map((unknownObservation) => {
    const row = objectWithKeys(unknownObservation, [
      'observationKey',
      'decision',
      'applicability',
      'proposedOccurrenceKey',
      'proposedThreadKey',
    ]);
    if (
      typeof row.observationKey !== 'string' ||
      !keyPattern.test(row.observationKey) ||
      !(row.decision === 'MATCH' || row.decision === 'DISTINCT' || row.decision === 'UNKNOWN') ||
      !(
        row.applicability === 'APPLICABLE' ||
        row.applicability === 'INAPPLICABLE' ||
        row.applicability === 'UNKNOWN_APPLICABILITY'
      ) ||
      !(
        row.proposedOccurrenceKey === null ||
        (typeof row.proposedOccurrenceKey === 'string' &&
          keyPattern.test(row.proposedOccurrenceKey))
      ) ||
      !(
        row.proposedThreadKey === null ||
        (typeof row.proposedThreadKey === 'string' && keyPattern.test(row.proposedThreadKey))
      )
    )
      throw new Error('MAPPING_FAILED');
    content.assertNoCompleteBodyRetention(row.observationKey);
    if (row.proposedOccurrenceKey !== null)
      content.assertNoCompleteBodyRetention(row.proposedOccurrenceKey);
    if (row.proposedThreadKey !== null)
      content.assertNoCompleteBodyRetention(row.proposedThreadKey);
    return Object.freeze({
      observationKey: row.observationKey,
      decision: row.decision,
      applicability: row.applicability,
      proposedOccurrenceKey: row.proposedOccurrenceKey,
      proposedThreadKey: row.proposedThreadKey,
    });
  });
  if (new Set(observations.map((row) => row.observationKey)).size !== observations.length)
    throw new Error('MAPPING_FAILED');
  const proposalKey = (rawKey: unknown): string | null => {
    if (rawKey === null) return null;
    if (typeof rawKey !== 'string' || !keyPattern.test(rawKey)) throw new Error('MAPPING_FAILED');
    content.assertNoCompleteBodyRetention(rawKey);
    return rawKey;
  };
  const articleProposals = rawProposals.map((rawProposal): NativeArticleProposal => {
    const row = objectWithKeys(rawProposal, [
      'action',
      'reasonCode',
      'proposedOccurrenceKey',
      'proposedThreadKey',
      'partialOccurrenceCreation',
    ]);
    if (
      !(NATIVE_ACTIONS as readonly unknown[]).includes(row.action) ||
      !(NATIVE_REASONS as readonly unknown[]).includes(row.reasonCode) ||
      typeof row.partialOccurrenceCreation !== 'boolean'
    )
      throw new Error('MAPPING_FAILED');
    return Object.freeze({
      action: row.action as NativeArticleProposal['action'],
      reasonCode: row.reasonCode as NativeArticleProposal['reasonCode'],
      proposedOccurrenceKey: proposalKey(row.proposedOccurrenceKey),
      proposedThreadKey: proposalKey(row.proposedThreadKey),
      partialOccurrenceCreation: row.partialOccurrenceCreation,
    });
  });
  const candidateApplicability = rawApplicability.map((rawScope): DurableCandidateApplicability => {
    const row = objectWithKeys(rawScope, ['scope', 'targetKey', 'outcome']);
    if (
      !(row.scope === 'OCCURRENCE' || row.scope === 'THREAD') ||
      !(
        row.outcome === 'APPLICABLE' ||
        row.outcome === 'INAPPLICABLE' ||
        row.outcome === 'UNKNOWN_APPLICABILITY'
      )
    )
      throw new Error('MAPPING_FAILED');
    const targetKey = proposalKey(row.targetKey);
    if (targetKey === null) throw new Error('MAPPING_FAILED');
    return Object.freeze({ scope: row.scope, targetKey, outcome: row.outcome });
  });
  return Object.freeze({
    ...(Object.hasOwn(output, 'llm')
      ? { llm: verifyLLMEnvelope(output.llm, content, request) }
      : {}),
    articleProposals: Object.freeze(articleProposals),
    candidateApplicability: Object.freeze(candidateApplicability),
    evidence: Object.freeze(evidence),
    observations: Object.freeze(observations),
  });
}
