import type { LLMEnvelopeExtension } from '../llm-shadow/llm.contracts.js';
import type {
  DerivedSemanticObservation,
  NativeArticleProposal,
  DurableCandidateApplicability,
} from './ephemeral.provider';
/** Access, retention and processing are independent operational contracts. */
export const CONTENT_ACCESS_MODES = [
  'METADATA_ONLY',
  'EXCERPT_EPHEMERAL',
  'FULLTEXT_EPHEMERAL',
  'FULLTEXT_PERSISTED',
] as const;
export type ContentAccessMode = (typeof CONTENT_ACCESS_MODES)[number];
export type SemanticProcessingState =
  | 'NOT_ELIGIBLE'
  | 'ELIGIBLE_UNPROCESSED'
  | 'PROCESSING'
  | 'PROCESSED_SHADOW'
  | 'PROCESSING_FAILED';
export interface ContentRights {
  readonly metadataStorage: boolean;
  readonly excerptStorage: boolean;
  readonly fulltextAcquisition: boolean;
  readonly fulltextMachineProcessing: boolean;
  readonly fulltextPersistence: boolean;
  readonly derivedSemanticPersistence: boolean;
  readonly minimalEvidenceFragment: boolean;
  readonly redisplay: boolean;
  readonly externalSourceLink: boolean;
  readonly localProcessing?: boolean;
  readonly externalAiTransmission?: boolean;
}
export interface ContentAccessPolicy {
  readonly policyId: string;
  readonly sourceId: string;
  readonly accessMode: ContentAccessMode;
  readonly active: boolean;
  readonly rights: ContentRights;
  /** Independently authorized aggregate evidence budget, never body permission. */
  readonly evidenceMaxCodepoints: number;
}
export interface ObservedArticleMetadata {
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly sourceId: string;
  readonly canonicalUrl: string;
  readonly publisherItemId: string | null;
  readonly publishedAt: string;
  readonly availableAt: string;
  readonly modifiedAt: string | null;
  readonly acquiredAt: string;
  readonly language: string | null;
  readonly title: string;
  readonly contentEncoding: 'utf-8';
}
/** Trusted provider-only transient projection. Never serialize this input. */
export interface FrozenDecisionArticle {
  readonly article_id: string;
  readonly position: number;
  readonly available_at: string;
  readonly published_at: string;
  readonly source_id: string;
  readonly language: string | null;
  readonly title: string;
  readonly body: string;
  readonly syndication_group: null;
}
export interface SemanticProviderIdentity {
  readonly providerType: string;
  readonly providerVersion: string;
  readonly candidateCommit: string | null;
  readonly runtime?: Readonly<{ python: string; model: string }>;
}
export interface EphemeralSemanticProvider {
  readonly identity: SemanticProviderIdentity;
  observe: (input: FrozenDecisionArticle, signal: AbortSignal) => Promise<unknown>;
}
export type ReproducibilityClass =
  | 'FULL_REPLAYABLE'
  | 'HASH_VERIFIABLE_REFETCH_REQUIRED'
  | 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE';
export interface FrozenFieldIdentity {
  readonly inputHash: string;
  readonly titleHash: string;
  readonly bodyCodepoints: number;
  readonly titleCodepoints: number;
  readonly normalizationVersion: string;
  readonly offsetConvention: 'unicode_code_point_v1';
}
export interface ProviderEvidenceLocator {
  readonly field: 'title' | 'excerpt' | 'body';
  readonly start: number;
  readonly end: number;
  readonly sourceSha256: string;
  readonly spanSha256: string;
}
export interface EvidenceFingerprint extends ProviderEvidenceLocator {
  readonly articleVersionId: string;
  /** SHA256 of complete acquisition bytes (legacy SQL input_hash). */
  readonly acquiredContentHash: string;
  /** SHA256 of the exact normalized body field, distinct from acquisition. */
  readonly normalizedInputHash: string;
  readonly normalizationVersion: string;
  readonly providerRunId: string;
  /** Empty unless separately allowed, bounded, and derived from exact source. */
  readonly retainedQuote: string | null;
}
/** Current implemented envelope has authenticated provenance, not invented claims. */
export interface SemanticEnvelope {
  readonly llm?: LLMEnvelopeExtension;
  readonly authority: 'SHADOW_NOT_AUTHORITATIVE';
  readonly metadata: ObservedArticleMetadata;
  readonly accessMode: Exclude<ContentAccessMode, 'METADATA_ONLY'>;
  readonly policyId: string;
  readonly acquiredContentHash: string;
  readonly normalizedInput: FrozenFieldIdentity;
  readonly provider: SemanticProviderIdentity;
  readonly providerRunId: string;
  readonly processedAt: string;
  readonly reproducibilityClass: ReproducibilityClass;
  readonly evidence: readonly EvidenceFingerprint[];
  readonly observations: readonly DerivedSemanticObservation[];
  readonly articleProposals?: readonly NativeArticleProposal[];
  readonly candidateApplicability?: readonly DurableCandidateApplicability[];
}
export interface EphemeralProcessingRequest {
  readonly metadata: ObservedArticleMetadata;
  readonly policy: ContentAccessPolicy;
  readonly permanentExclusionVerified: boolean;
  readonly providerRunId: string;
  readonly position: number;
}
export interface ParsedOriginalContent {
  readonly title: string;
  /** Ownership transfers to the pipeline; caller must retain no copies. */
  readonly body: Buffer;
  readonly completeOriginalText: boolean;
}
export interface EphemeralSafeLog {
  readonly articleId: string;
  readonly canonicalUrl: string;
  readonly state: SemanticProcessingState;
  readonly code: string;
  readonly length: number | null;
  readonly inputHash: string | null;
}
export interface EphemeralPipelineDependencies {
  /** Ownership transfers to the pipeline, including late timeout results. */
  acquire: (signal: AbortSignal) => Promise<Buffer>;
  parse: (acquired: Uint8Array, signal: AbortSignal) => Promise<ParsedOriginalContent>;
  readonly provider: EphemeralSemanticProvider;
  persist: (envelope: SemanticEnvelope, signal: AbortSignal) => Promise<void>;
  resolveVersionId?: (envelope: SemanticEnvelope, signal: AbortSignal) => Promise<string>;
  onFailure?: (receipt: SemanticProcessingFailureReceipt, signal: AbortSignal) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxAcquiredBytes?: number;
  readonly maxBodyBytes?: number;
  onState?: (state: SemanticProcessingState) => Promise<void>;
  log?: (event: EphemeralSafeLog) => void;
}

export type SemanticProcessingErrorCode =
  | 'RIGHTS_DENIED'
  | 'ACQUISITION_FAILED'
  | 'PARSE_FAILED'
  | 'NORMALIZATION_FAILED'
  | 'INPUT_INVALID'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_FAILED'
  | 'MAPPING_FAILED'
  | 'PERSISTENCE_FAILED';
/** Declared provider provenance does not assert that a provider executed. */
export interface SemanticProcessingFailureReceipt {
  readonly articleId: string;
  readonly sourceId: string;
  readonly policyId: string;
  readonly provider: SemanticProviderIdentity;
  readonly errorCode: SemanticProcessingErrorCode;
  readonly acquiredContentHash: string | null;
  readonly normalizedInputHash: string | null;
  readonly titleInputHash: string | null;
  readonly failedAt: string;
}
