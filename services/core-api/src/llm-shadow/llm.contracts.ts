import type { ProviderEvidenceLocator } from '../ephemeral/ephemeral.contracts.js';
import type { SemanticObservationProvider } from '../semantic/semantic.contracts.js';
import type {
  EphemeralSemanticProvider,
  FrozenDecisionArticle,
} from '../ephemeral/ephemeral.contracts.js';

export const OBSERVATION_STATUSES = [
  'OBSERVATION_AVAILABLE',
  'INSUFFICIENT_EVIDENCE',
  'NOT_APPLICABLE',
  'AMBIGUOUS',
] as const;
export const FACT_ROLES = [
  'action',
  'participant',
  'date',
  'end_date',
  'location',
  'external_id',
  'process',
  'topic',
] as const;
export const RELATION_DECISIONS = [
  'SAME_OCCURRENCE',
  'DIFFERENT_OCCURRENCE_SAME_THREAD',
  'DIFFERENT_THREAD',
  'UNKNOWN',
  'NOT_APPLICABLE',
] as const;
export const IDENTITY_OUTCOMES = ['SAME', 'DISTINCT', 'UNKNOWN', 'NOT_APPLICABLE'] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];
export type FactRole = (typeof FACT_ROLES)[number];
export type ProcessingRoute =
  | 'EXTERNAL_LLM_PROCESSING_ALLOWED'
  | 'LOCAL_ONLY_PROCESSING'
  | 'NOT_ALLOWED';
export type LLMProviderType = 'llm_gemini' | 'llm_cloudflare_workers_ai' | 'authored_stub';
export interface LLMConfig {
  readonly model: string;
  readonly providerVersion: string;
  readonly configHash: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly evidenceResolverVersion?: string;
  readonly retrievalVersion: string;
  readonly graphVersion: string;
  readonly maxArticles: number;
  readonly maxCalls: number;
  readonly topK: number;
  readonly timeoutMs: number;
  readonly maxRetries: 0;
  readonly concurrency: 1;
  readonly maxOutputTokens: number;
}
export interface LLMUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly cost: null;
}
export type LLMResponseDiagnosticCategory =
  | 'CLOUDFLARE_ENVELOPE_INVALID'
  | 'PROVIDER_RESULT_MISSING'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_MODEL_MISMATCH'
  | 'RESPONSE_REDACTION_REJECTED'
  | 'ASSISTANT_CONTENT_MISSING'
  | 'ASSISTANT_CONTENT_EMPTY'
  | 'ASSISTANT_CONTENT_NON_JSON'
  | 'ASSISTANT_CONTENT_SCHEMA_INVALID'
  | 'ASSISTANT_OUTPUT_INCOMPLETE'
  | 'CORE_VALIDATION_FAILED';
export type LLMResponseFieldType =
  | 'MISSING'
  | 'NULL'
  | 'STRING'
  | 'OBJECT'
  | 'ARRAY'
  | 'NUMBER'
  | 'BOOLEAN';
export interface LLMProviderDiagnostics {
  readonly stage:
    | 'HTTP_TRANSPORT'
    | 'CLOUDFLARE_ENVELOPE'
    | 'PROVIDER_RESULT'
    | 'ASSISTANT_CONTENT'
    | 'JSON_DECODE'
    | 'SKILL_SCHEMA'
    | 'CORE_VALIDATION';
  readonly responseEnvelopeVariant:
    | 'CLOUDFLARE_RUN_RESPONSE'
    | 'CLOUDFLARE_RUN_CHAT_COMPLETION'
    | 'CLOUDFLARE_RUN_RESPONSES_API'
    | 'UNKNOWN'
    | 'NOT_PARSED';
  readonly diagnosticCategory: LLMResponseDiagnosticCategory | null;
  readonly completionStatus: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN';
  readonly contentCharacterCount: number | null;
  readonly jsonParseStatus:
    | 'NOT_ATTEMPTED'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'STRUCTURED_OBJECT'
    | 'NOT_APPLICABLE';
  readonly fieldTypes: Readonly<{
    resultResponse: LLMResponseFieldType;
    resultChoices: LLMResponseFieldType;
    firstChoiceMessage: LLMResponseFieldType;
    messageRole: LLMResponseFieldType;
    messageContent: LLMResponseFieldType;
    messageReasoningContent: LLMResponseFieldType;
  }>;
  readonly reasoningContentPresent: boolean | null;
  readonly finishReason:
    | 'STOP'
    | 'LENGTH'
    | 'CONTENT_FILTER'
    | 'TOOL_CALLS'
    | 'FUNCTION_CALL'
    | 'UNKNOWN'
    | 'NOT_APPLICABLE';
  readonly schemaIssueCode: string | null;
  readonly schemaErrorKeyword: string | null;
  readonly schemaErrorPath: string | null;
}
export interface LLMGeneration {
  readonly output: unknown;
  readonly usage: LLMUsage;
  readonly httpStatus?: number;
  readonly elapsedMs?: number;
  readonly providerDiagnostics?: LLMProviderDiagnostics;
}
export interface StructuredLLMTransport {
  readonly kind: 'external' | 'local';
  readonly name: string;
  /** Separate persisted identity for external providers; omitted transports keep legacy mapping. */
  readonly providerType?: LLMProviderType;
  dispose?: () => void;
  generate(
    stage: 'extraction' | 'relation',
    input: unknown,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<LLMGeneration>;
}
/** Same observation boundary, extended for grounded proposals rather than forced memberships. */
export interface LLMSemanticObservationProvider
  extends SemanticObservationProvider<FrozenDecisionArticle, unknown>,
    EphemeralSemanticProvider {
  observe(article: FrozenDecisionArticle, signal?: AbortSignal): Promise<unknown>;
}
export interface GroundedFact {
  readonly id: string;
  readonly role: FactRole;
  readonly valueHash: string;
  readonly retrievalHash: string;
  readonly evidence: ProviderEvidenceLocator;
  readonly isoDate: string | null;
}
export interface VerifiedExtraction {
  readonly status: ObservationStatus;
  readonly boundedOccurrence: boolean;
  readonly boundedThread: boolean;
  readonly facts: readonly GroundedFact[];
}
export interface RelationDecision {
  readonly decision: (typeof RELATION_DECISIONS)[number];
  readonly occurrence: (typeof IDENTITY_OUTCOMES)[number];
  readonly thread: (typeof IDENTITY_OUTCOMES)[number];
  readonly leftFacts: readonly string[];
  readonly rightFacts: readonly string[];
}
export interface RetainedRelation extends RelationDecision {
  readonly targetArticleId: string;
  readonly targetVersionId: string;
}
export interface LLMEnvelopeExtension {
  readonly mode: 'LLM_SEMANTIC_SHADOW';
  readonly config: LLMConfig;
  readonly route: ProcessingRoute;
  readonly extraction: VerifiedExtraction;
  readonly relations: readonly RetainedRelation[];
  readonly outputHash: string;
  readonly cacheKey: string;
  readonly usage: LLMUsage;
  readonly evidenceVerification: 'VERIFIED';
}
export interface RetrievalCandidate {
  readonly articleId: string;
  readonly versionId: string;
  readonly availableAt: string;
  readonly extraction: VerifiedExtraction;
  readonly occurrenceKey: string;
  readonly threadKey: string | null;
}
export interface ProposedGraph {
  readonly occurrences: readonly Readonly<{
    key: string;
    threadKey: string | null;
    articleIds: readonly string[];
    generationHash: string;
  }>[];
  readonly threads: readonly Readonly<{
    key: string;
    occurrenceKeys: readonly string[];
    articleIds: readonly string[];
    generationHash: string;
  }>[];
  readonly streamHashes: Readonly<Record<string, string>>;
}
