import type { StructuredLLMTransport } from '../llm-shadow/llm.contracts.js';
import { isUlid } from '@dialektik/database';
import { sha256 } from '../llm-shadow/llm.schema.js';
import {
  validateHeadlineGrant,
  validateHeadlineInput,
  type HeadlineSemanticGrant,
} from './headline-semantic-runner.js';
import {
  HEADLINE_CONTEXT_PAIR_SCHEMA,
  verifyContextRelation,
  type ContextHeadline,
  type VerifiedContextRelation,
} from './headline-context-pairs.js';

export interface ContextPairHooks {
  withRightsLeases<T>(
    left: ContextHeadline,
    right: ContextHeadline,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T>;
  currentGrant(input: ContextHeadline): Promise<HeadlineSemanticGrant | null>;
  reserveAttempt(
    left: ContextHeadline,
    right: ContextHeadline,
    leftHash: string,
    rightHash: string,
  ): Promise<string>;
  finishAttempt(
    id: string,
    outcome: 'VALIDATED' | 'REJECTED' | 'UNKNOWN_SENT' | 'RIGHTS_REVOKED',
    relation?: VerifiedContextRelation,
  ): Promise<void>;
}

export class ContextPairRejectedError extends Error {
  constructor(readonly attemptId: string) {
    super('CONTEXT_MODEL_OUTPUT_REJECTED');
  }
}

/** One audited, provisional comparison; it never creates an Event or a contradiction. */
export async function analyzeContextPair(
  left: ContextHeadline,
  right: ContextHeadline,
  transport: StructuredLLMTransport,
  hooks: ContextPairHooks,
  signal: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<Readonly<{ attemptId: string; relation: VerifiedContextRelation }>> {
  validateHeadlineInput(left);
  validateHeadlineInput(right);
  const leftTime = Date.parse(left.publishedAt),
    rightTime = Date.parse(right.publishedAt);
  if (
    left.articleId >= right.articleId ||
    left.sourceId === right.sourceId ||
    !Number.isFinite(leftTime) ||
    !Number.isFinite(rightTime) ||
    Math.abs(leftTime - rightTime) > 72 * 60 * 60 * 1000
  )
    throw new Error('CONTEXT_PAIR_INVALID');
  if (transport.kind !== 'external' || transport.providerType !== 'llm_cloudflare_workers_ai')
    throw new Error('CONTEXT_PROVIDER_INVALID');
  if (signal.aborted) throw new Error('CONTEXT_ABORTED');
  return hooks.withRightsLeases(left, right, signal, async () => {
    async function verifyRights() {
      const [leftGrant, rightGrant] = await Promise.all([
        hooks.currentGrant(left),
        hooks.currentGrant(right),
      ]);
      validateHeadlineGrant(left, leftGrant, now());
      validateHeadlineGrant(right, rightGrant, now());
      if (leftGrant?.decisionId !== left.grantId || rightGrant?.decisionId !== right.grantId)
        throw new Error('CONTEXT_RIGHTS_DENIED');
    }
    await verifyRights();
    const attemptId = await hooks.reserveAttempt(
      left,
      right,
      sha256(left.headline),
      sha256(right.headline),
    );
    if (!isUlid(attemptId)) throw new Error('CONTEXT_ATTEMPT_INVALID');
    let recorded = false;
    try {
      const response = await transport.generate(
        'relation',
        {
          left: { title: left.headline, publishedAt: new Date(leftTime).toISOString() },
          right: { title: right.headline, publishedAt: new Date(rightTime).toISOString() },
        },
        HEADLINE_CONTEXT_PAIR_SCHEMA,
        signal,
      );
      if (signal.aborted) throw new Error('CONTEXT_ABORTED');
      try {
        await verifyRights();
      } catch {
        await hooks.finishAttempt(attemptId, 'RIGHTS_REVOKED');
        recorded = true;
        throw new Error('CONTEXT_RIGHTS_REVOKED');
      }
      let relation: VerifiedContextRelation;
      try {
        relation = verifyContextRelation(response.output, left.headline, right.headline);
      } catch {
        await hooks.finishAttempt(attemptId, 'REJECTED');
        recorded = true;
        throw new ContextPairRejectedError(attemptId);
      }
      await hooks.finishAttempt(attemptId, 'VALIDATED', relation);
      recorded = true;
      return Object.freeze({ attemptId, relation });
    } catch (error) {
      if (!recorded) await hooks.finishAttempt(attemptId, 'UNKNOWN_SENT');
      throw error;
    }
  });
}
