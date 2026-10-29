import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  CloudflareWorkersAITransport,
  cloudflareDiagnosticsFromError,
} from '../llm-shadow/llm.cloudflare.js';
import {
  CLOUDFLARE_JSON_MODE_MODEL,
  createCloudflareProfile,
} from '../llm-shadow/llm.cloudflare-config.js';
import { HeadlineReviewService } from '../moderation/headline-review.service.js';
import { ModerationHttpError } from '../moderation/moderation-http.error.js';
import { HeadlineSemanticDatabaseService } from './headline-semantic-database.service.js';
import { HeadlineSemanticRepository } from './headline-semantic-repository.js';
import {
  analyzeHeadlineForReview,
  HeadlineModelOutputRejectedError,
} from './headline-semantic-runner.js';
import { HEADLINE_EXTRACTION_PROMPT, headlineConfigHash } from './headline-extraction-contract.js';

const SAFE_PROVIDER_FAILURES = new Set([
  'LLM_ABORTED',
  'LLM_CREDENTIAL_REJECTED',
  'LLM_FREE_NEURON_QUOTA_EXHAUSTED',
  'LLM_MODEL_REQUIRES_PAID_PLAN',
  'LLM_MODEL_UNAVAILABLE',
  'LLM_PROVIDER_CAPACITY_EXCEEDED',
  'LLM_PROVIDER_FAILED',
  'LLM_PROVIDER_INCOMPLETE',
  'LLM_PROVIDER_REJECTED',
  'LLM_RATE_LIMIT',
  'LLM_RESPONSE_BOUND',
  'LLM_RESPONSE_INVALID',
  'LLM_TIMEOUT',
  'LLM_TRANSPORT_FAILED',
]);

/** Only fixed diagnostic labels may enter logs; never log model text or inputs. */
export function headlineFailureDiagnostic(error: unknown): {
  readonly code: string;
  readonly category: string;
  readonly databaseCode: string;
} {
  const message = error instanceof Error ? error.message : '';
  const category = cloudflareDiagnosticsFromError(error)?.diagnosticCategory;
  const sqlState =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return {
    code: SAFE_PROVIDER_FAILURES.has(message) ? message : 'INTERNAL',
    category: typeof category === 'string' && /^[A-Z_]{1,64}$/.test(category) ? category : 'NONE',
    databaseCode:
      typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState) ? sqlState : 'NONE',
  };
}

/** A private editor receives a fixed operational category, never provider content. */
export function headlineFailureResponseCode(
  diagnostic: ReturnType<typeof headlineFailureDiagnostic>,
): string {
  if (diagnostic.code === 'LLM_RESPONSE_INVALID' && diagnostic.category !== 'NONE')
    return `MOD_HEADLINE_RESPONSE_${diagnostic.category}`;
  if (diagnostic.code !== 'INTERNAL') return `MOD_HEADLINE_${diagnostic.code.slice(4)}`;
  if (diagnostic.databaseCode === 'P0001') return 'MOD_HEADLINE_DATABASE_TRIGGER_REJECTED';
  if (diagnostic.databaseCode === '23514') return 'MOD_HEADLINE_DATABASE_CHECK_REJECTED';
  if (diagnostic.databaseCode === '23503') return 'MOD_HEADLINE_DATABASE_REFERENCE_REJECTED';
  if (diagnostic.databaseCode !== 'NONE') return 'MOD_HEADLINE_DATABASE_FAILURE';
  return 'MOD_HEADLINE_INTERNAL_FAILURE';
}

/** One explicitly requested, rights-gated title analysis; no autonomous publication. */
@Injectable()
export class HeadlineAnalysisService {
  private readonly logger = new Logger(HeadlineAnalysisService.name);
  constructor(
    @Inject(HeadlineReviewService)
    private readonly reviews: HeadlineReviewService,
    @Inject(HeadlineSemanticDatabaseService)
    private readonly writer: HeadlineSemanticDatabaseService,
  ) {}

  async analyzeNext(authorization: string | undefined, raw: unknown) {
    const identity = await this.reviews.authorizeEditor(authorization);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 0
    )
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');

    const profile = createCloudflareProfile(CLOUDFLARE_JSON_MODE_MODEL, {
      maxArticles: 1,
      maxCalls: 1,
      timeoutMs: 55000,
      maxRequestBytes: 16384,
    });
    let transport: CloudflareWorkersAITransport;
    try {
      transport = new CloudflareWorkersAITransport(
        profile,
        undefined,
        process.env,
        HEADLINE_EXTRACTION_PROMPT,
      );
    } catch {
      throw new ServiceUnavailableException('Headline analysis is not configured.');
    }
    try {
      const repository = new HeadlineSemanticRepository(
        this.writer.database,
        identity.userId,
        profile.config.model,
        headlineConfigHash(profile.config.configHash),
      );
      const input = (await repository.eligible(1))[0];
      if (!input) return { status: 'NO_ELIGIBLE' as const };
      const result = await analyzeHeadlineForReview(
        input,
        transport,
        repository.hooks(),
        AbortSignal.timeout(65000),
      );
      return {
        status: 'ANALYZED' as const,
        attemptId: result.attemptId,
        observation: result.extraction.status,
      };
    } catch (error) {
      if (error instanceof HeadlineModelOutputRejectedError)
        return {
          status: 'REJECTED' as const,
          attemptId: error.attemptId,
          reason: error.rejectionCode,
        };
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (code === '23505' || code === '40001')
        throw new ModerationHttpError(409, 'MOD_STALE_CONTEXT');
      const diagnostic = headlineFailureDiagnostic(error);
      this.logger.warn(
        `HEADLINE_ANALYSIS_FAILURE code=${diagnostic.code} category=${diagnostic.category} database=${diagnostic.databaseCode}`,
      );
      // Raw provider errors and database details never become API responses or logs.
      throw new ServiceUnavailableException({ code: headlineFailureResponseCode(diagnostic) });
    } finally {
      transport.dispose();
    }
  }
}
