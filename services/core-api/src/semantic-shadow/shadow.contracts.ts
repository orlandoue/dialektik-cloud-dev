/** This boundary never assigns an authoritative Event or Story. */
export const FROZEN_V10_11_IDENTITY = Object.freeze({
  commit: 'ea47eb75e955b9a51d15dc0135c81145130553ca',
  version: 'phase3v10.11-applicability-replay-v1',
  runtime: Object.freeze({ python: '3.11.9', model: 'none' }),
});
export const LIVE_EXCLUSION_REGISTRY_IDENTITY = 'product-live-shadow-exclusions-v1';
export const LIVE_EXCLUSION_CLASS = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2';
export const AUTHENTICATED_LIVE_REGISTRY_SHA256 =
  '02bd750f97fdbd2bc98e3d59f7a657e8dce12a63a754fc7bd1ccde933ba3f9f3';
export const REQUIRED_SOURCE_REPRESENTATION =
  'Publisher-authorized exact original full source text, separately identified original headline, stable Article/Source identity, canonical URL, original publication and first-availability timestamps with timezone, and declared language or honest absence. Preserve exact source hashes and offsets; authenticate permanent exclusion before execution.';

export interface ShadowCandidateIdentity {
  readonly commit: string;
  readonly version: string;
  readonly runtime: Readonly<{ python: string; model: string }>;
}

export interface ShadowSourceRepresentation {
  readonly articleId: string;
  readonly representation: 'feed_excerpt' | 'metadata_only' | 'full_source_text';
  readonly body: string | null;
  readonly fullSourceRightsAuthorized: boolean;
  readonly permanentExclusionVerified: boolean;
}

export interface ShadowInputGate {
  readonly classification: 'INVALID_FOR_CANDIDATE' | 'FULL_SOURCE_REPRESENTATION_PRESENT';
  readonly reasonCode:
    | 'FULL_SOURCE_REQUIRED'
    | 'FULL_SOURCE_RIGHTS_REQUIRED'
    | 'PERMANENT_EXCLUSION_REQUIRED'
    | null;
}

export interface ShadowPreflightArticle {
  readonly article_id: string;
  readonly headline: string;
  readonly canonical_url: string;
  readonly source_item_id: string | null;
  readonly published_at: string;
  readonly first_available_at: string;
  readonly language: string;
  readonly authorized_content_sha256: string | null;
  readonly authorized_content_signature: string | null;
  readonly permitted_representation_sha256: string;
  readonly source: Readonly<{ id: string; name: string }>;
  readonly representation: 'feed_excerpt';
  readonly body: null;
  readonly input_sufficiency: 'INVALID_FOR_CANDIDATE';
  readonly reason_code: 'FULL_SOURCE_REQUIRED';
  readonly exclusion_verified: boolean;
  readonly authoritative_semantic_assignment: 'UNASSIGNED';
}

export interface ShadowPreflight {
  readonly disposition: 'CURRENT_LIVE_INPUT_INSUFFICIENT_FOR_V10_11';
  readonly adapter_status: 'READY';
  readonly authority: 'NOT_AUTHORITATIVE';
  readonly candidate: typeof FROZEN_V10_11_IDENTITY & Readonly<{ execution_enabled: false }>;
  readonly input_contract: Readonly<{
    required_representation: 'FULL_SOURCE_TEXT';
    required_body_field: 'text';
    title_only_allowed: false;
    excerpt_substitution_allowed: false;
  }>;
  readonly registry: Readonly<{
    identity: typeof LIVE_EXCLUSION_REGISTRY_IDENTITY;
    expected_sha256: string;
    actual_sha256: string;
    row_count: number;
    authenticated: boolean;
  }>;
  readonly articles: readonly ShadowPreflightArticle[];
  readonly eligible_article_count: 0;
  readonly skipped_article_count: number;
  readonly counters: Readonly<{
    product_shadow_candidate_batches: 0;
    product_shadow_candidate_article_inputs: 0;
    determinism_replays: 0;
    final_holdout_candidate_executions: 0;
  }>;
  readonly observations: readonly never[];
  readonly proposed_occurrences: readonly never[];
  readonly proposed_threads: readonly never[];
  readonly unknown_result_count: 0;
  readonly required_source_representation: typeof REQUIRED_SOURCE_REPRESENTATION;
}
