import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CloudflareWorkersAITransport } from '../llm-shadow/llm.cloudflare.js';
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

/** One explicitly requested, rights-gated title analysis; no autonomous publication. */
@Injectable()
export class HeadlineAnalysisService {
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
      // Provider errors and database details never become API responses or logs.
      throw new ServiceUnavailableException('Headline analysis could not be completed.');
    } finally {
      transport.dispose();
    }
  }
}
