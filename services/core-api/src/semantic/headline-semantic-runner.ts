import type { StructuredLLMTransport, VerifiedExtraction } from '../llm-shadow/llm.contracts.js';
import { sha256 } from '../llm-shadow/llm.schema.js';
import { assertUnicodeScalars } from '../ephemeral/ephemeral.normalization.js';
import {
  groundHeadlineExtraction,
  HEADLINE_EXTRACTION_SCHEMA,
} from './headline-extraction-contract.js';

export interface HeadlineSemanticInput {
  readonly articleId: string;
  readonly versionId: string;
  readonly sourceId: string;
  readonly policyId: string;
  readonly canonicalDomain: string;
  readonly canonicalUrl: string;
  readonly headline: string;
}

export interface HeadlineSemanticGrant {
  readonly sourceId: string;
  readonly policyId: string;
  readonly decisionId: string;
  readonly approvedBy: string;
  readonly authorizationReference: string;
  readonly rightsEvidenceUrl: string;
  readonly active: boolean;
  readonly rightsReviewStatus: 'APPROVED' | 'PENDING' | 'REVOKED';
  readonly storagePolicy: 'METADATA_ONLY' | 'METADATA_AND_FEED_EXCERPT';
  /** Explicit source-specific approval for sending titles to this provider. */
  readonly allowCloudflareHeadline: boolean;
  readonly allowDerivedEditorialReview: boolean;
  readonly validFrom: string;
  readonly expiresAt: string | null;
}

export interface HeadlineSemanticHooks {
  /** The lease protects the source decision from revocation during transmission. */
  withRightsLease<T>(
    input: HeadlineSemanticInput,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T>;
  currentGrant(input: HeadlineSemanticInput): Promise<HeadlineSemanticGrant | null>;
  /** Must durably reserve a single attempt before the provider receives text. */
  reserveAttempt(input: HeadlineSemanticInput, titleHash: string): Promise<string>;
  finishAttempt(
    attemptId: string,
    outcome: 'VALIDATED' | 'REJECTED' | 'UNKNOWN_SENT' | 'RIGHTS_REVOKED',
    extraction?: VerifiedExtraction,
    rejectionCode?: HeadlineRejectionCode,
  ): Promise<void>;
}

export type HeadlineRejectionCode =
  | 'MODEL_SCHEMA'
  | 'MODEL_EVIDENCE'
  | 'MODEL_UNBOUNDED'
  | 'MODEL_CHRONOLOGY'
  | 'MODEL_VALIDATION';

export class HeadlineModelOutputRejectedError extends Error {
  constructor(
    readonly attemptId: string,
    readonly rejectionCode: HeadlineRejectionCode,
  ) {
    super('HEADLINE_MODEL_OUTPUT_REJECTED');
    this.name = 'HeadlineModelOutputRejectedError';
  }
}

function rejectionCode(error: unknown): HeadlineRejectionCode {
  const message = error instanceof Error ? error.message : '';
  if (message === 'LLM_SCHEMA_INVALID') return 'MODEL_SCHEMA';
  if (message === 'LLM_EVIDENCE_INVALID') return 'MODEL_EVIDENCE';
  if (
    message === 'LLM_UNBOUNDED_OBSERVATION' ||
    message === 'LLM_UNBOUNDED_THREAD' ||
    message === 'LLM_UNSUPPORTED_FACT'
  )
    return 'MODEL_UNBOUNDED';
  if (message === 'LLM_CHRONOLOGY_INVALID') return 'MODEL_CHRONOLOGY';
  return 'MODEL_VALIDATION';
}

export interface HeadlineSemanticResult {
  readonly attemptId: string;
  readonly extraction: VerifiedExtraction;
}

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export function validateHeadlineInput(input: HeadlineSemanticInput): void {
  if (
    !ULID.test(input.articleId) ||
    !ULID.test(input.versionId) ||
    !ULID.test(input.sourceId) ||
    !HASH.test(input.policyId) ||
    !input.headline.trim() ||
    Array.from(input.headline).length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(input.headline) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(input.canonicalDomain)
  )
    throw new Error('HEADLINE_INPUT_INVALID');
  try {
    assertUnicodeScalars(input.headline);
  } catch {
    throw new Error('HEADLINE_INPUT_INVALID');
  }
  let url: URL;
  try {
    url = new URL(input.canonicalUrl);
  } catch {
    throw new Error('HEADLINE_URL_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    ![input.canonicalDomain, `www.${input.canonicalDomain}`].includes(url.hostname)
  ) {
    throw new Error('HEADLINE_URL_INVALID');
  }
}

export function validateHeadlineGrant(
  input: HeadlineSemanticInput,
  grant: HeadlineSemanticGrant | null,
  now: Date,
): void {
  let evidence: URL | null = null;
  try {
    if (grant !== null) evidence = new URL(grant.rightsEvidenceUrl);
  } catch {
    /* denied below */
  }
  if (
    grant === null ||
    grant.sourceId !== input.sourceId ||
    grant.policyId !== input.policyId ||
    !ULID.test(grant.decisionId) ||
    !ULID.test(grant.approvedBy) ||
    !grant.authorizationReference.trim() ||
    grant.authorizationReference.length > 256 ||
    evidence === null ||
    evidence.protocol !== 'https:' ||
    evidence.username ||
    evidence.password ||
    evidence.hostname === 'supabase.com' ||
    !grant.active ||
    grant.rightsReviewStatus !== 'APPROVED' ||
    grant.storagePolicy !== 'METADATA_ONLY' ||
    !grant.allowCloudflareHeadline ||
    !grant.allowDerivedEditorialReview ||
    !Number.isFinite(Date.parse(grant.validFrom)) ||
    Date.parse(grant.validFrom) > now.getTime() ||
    (grant.expiresAt !== null &&
      (!Number.isFinite(Date.parse(grant.expiresAt)) ||
        Date.parse(grant.expiresAt) <= now.getTime()))
  )
    throw new Error('HEADLINE_RIGHTS_DENIED');
}

/** One audited model attempt over a title; it never acquires or sends article bodies. */
export async function analyzeHeadlineForReview(
  input: HeadlineSemanticInput,
  transport: StructuredLLMTransport,
  hooks: HeadlineSemanticHooks,
  signal: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<HeadlineSemanticResult> {
  validateHeadlineInput(input);
  if (transport.kind !== 'external' || transport.providerType !== 'llm_cloudflare_workers_ai')
    throw new Error('HEADLINE_PROVIDER_INVALID');
  if (signal.aborted) throw new Error('HEADLINE_ABORTED');
  return hooks.withRightsLease(input, signal, async () => {
    validateHeadlineGrant(input, await hooks.currentGrant(input), now());
    const titleHash = sha256(input.headline);
    const attemptId = await hooks.reserveAttempt(input, titleHash);
    if (!ULID.test(attemptId)) throw new Error('HEADLINE_ATTEMPT_INVALID');
    let recorded = false;
    try {
      const response = await transport.generate(
        'extraction',
        {
          title: input.headline,
          body: '',
        },
        HEADLINE_EXTRACTION_SCHEMA,
        signal,
      );
      if (signal.aborted) throw new Error('HEADLINE_ABORTED');
      try {
        validateHeadlineGrant(input, await hooks.currentGrant(input), now());
      } catch {
        await hooks.finishAttempt(attemptId, 'RIGHTS_REVOKED');
        recorded = true;
        throw new Error('HEADLINE_RIGHTS_REVOKED');
      }
      let extraction: VerifiedExtraction;
      try {
        extraction = groundHeadlineExtraction(response.output, input.headline);
      } catch (error) {
        const code = rejectionCode(error);
        await hooks.finishAttempt(attemptId, 'REJECTED', undefined, code);
        recorded = true;
        throw new HeadlineModelOutputRejectedError(attemptId, code);
      }
      await hooks.finishAttempt(attemptId, 'VALIDATED', extraction);
      recorded = true;
      return Object.freeze({ attemptId, extraction });
    } catch (error) {
      if (!recorded) await hooks.finishAttempt(attemptId, 'UNKNOWN_SENT');
      throw error;
    }
  });
}
