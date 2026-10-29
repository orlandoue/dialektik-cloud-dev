import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CloudflareWorkersAITransport } from '../llm-shadow/llm.cloudflare.js';
import {
  CLOUDFLARE_JSON_MODE_MODEL,
  createCloudflareProfile,
} from '../llm-shadow/llm.cloudflare-config.js';
import { HeadlineReviewService } from '../moderation/headline-review.service.js';
import { ModerationHttpError } from '../moderation/moderation-http.error.js';
import { HeadlineSemanticDatabaseService } from './headline-semantic-database.service.js';
import { contextPairConfigHash, HEADLINE_CONTEXT_PAIR_PROMPT } from './headline-context-pairs.js';
import { HeadlineContextRepository } from './headline-context-repository.js';
import { analyzeContextPair, ContextPairRejectedError } from './headline-context-runner.js';

@Injectable()
export class HeadlineContextAnalysisService {
  constructor(
    @Inject(HeadlineReviewService) private readonly reviews: HeadlineReviewService,
    @Inject(HeadlineSemanticDatabaseService)
    private readonly writer: HeadlineSemanticDatabaseService,
  ) {}

  async analyzeNext(authorization: string | undefined, raw: unknown) {
    const identity = await this.reviews.authorizeContextEditor(authorization);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 0
    )
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    const profile = createCloudflareProfile(CLOUDFLARE_JSON_MODE_MODEL, {
      maxArticles: 2,
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
        HEADLINE_CONTEXT_PAIR_PROMPT,
      );
    } catch {
      throw new ServiceUnavailableException('Context comparison is not configured.');
    }
    try {
      const repository = new HeadlineContextRepository(
        this.writer.database,
        identity.userId,
        profile.config.model,
        contextPairConfigHash(profile.config.configHash),
      );
      const pair = await repository.nextPair();
      if (!pair) return { status: 'NO_CANDIDATE' as const };
      const result = await analyzeContextPair(
        pair.left,
        pair.right,
        transport,
        repository.hooks(),
        AbortSignal.timeout(65000),
      );
      return {
        status: 'ANALYZED' as const,
        attemptId: result.attemptId,
        relation: result.relation.relation,
        modelRelation: result.relation.modelRelation,
      };
    } catch (error) {
      if (error instanceof ContextPairRejectedError)
        return { status: 'REJECTED' as const, attemptId: error.attemptId };
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (code === '23505' || code === '40001')
        throw new ModerationHttpError(409, 'MOD_STALE_CONTEXT');
      throw new ServiceUnavailableException('Context comparison could not be completed.');
    } finally {
      transport.dispose();
    }
  }
}
