import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  TitleOnlyProjectionReceipt,
  TitleOnlyProjectionReceiptWriter,
} from './llm.title-only-projection.js';

const ARTICLE_ID = '01M4CRBAXJPQEMJVXPKH1EY1N6';
const ARTICLE_VERSION_ID = '01M4CRBAXJX973BQ21979KQJ8W';
const PROVIDER = 'llm_cloudflare_workers_ai';
const MODEL = '@cf/openai/gpt-oss-20b';
const RECEIPT_KEYS = Object.freeze([
  'runId',
  'attemptedAt',
  'provider',
  'model',
  'scope',
  'sourceId',
  'articleId',
  'articleVersionId',
  'projectionVersionId',
  'projectionSha256',
  'state',
  'status',
  'attemptCount',
  'httpStatus',
  'latencyMs',
  'schemaValid',
  'applicability',
  'eventNuggetCount',
  'factCount',
  'groundedFactCount',
  'unsupportedFactCount',
  'validEvidenceReferenceCount',
  'invalidEvidenceReferenceCount',
  'schemaIssueCode',
  'responseEnvelopeVariant',
  'completionStatus',
  'usage',
  'persistence',
  'errorCategory',
  'realNewsBodyTransmitted',
  'bodyPersisted',
  'promptPersisted',
  'rawResponsePersisted',
  'liveAuthority',
  'v10_11Executions',
  'finalHoldoutExecutions',
]);

function fail(): never {
  throw new Error('TITLE_ONLY_RECEIPT_INVALID');
}

function safeCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeReceipt(value: TitleOnlyProjectionReceipt): TitleOnlyProjectionReceipt {
  const receipt = value as unknown as Record<string, unknown>;
  if (Object.keys(receipt).sort().join('\0') !== [...RECEIPT_KEYS].sort().join('\0')) fail();
  if (
    !/^[A-Za-z0-9-]{16,64}$/u.test(String(receipt.runId)) ||
    !Number.isFinite(Date.parse(String(receipt.attemptedAt))) ||
    receipt.provider !== PROVIDER ||
    receipt.model !== MODEL ||
    receipt.scope !== 'TITLE_ONLY' ||
    receipt.articleId !== ARTICLE_ID ||
    receipt.articleVersionId !== ARTICLE_VERSION_ID ||
    receipt.sourceId !== '01M4CQTXP483R30JDW6EJQ6ADQ' ||
    !/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(String(receipt.projectionVersionId)) ||
    !/^[0-9a-f]{64}$/u.test(String(receipt.projectionSha256)) ||
    !['ATTEMPT_PENDING', 'RESPONSE_RECEIVED', 'UNKNOWN_SENT'].includes(String(receipt.state)) ||
    ![
      'PENDING',
      'VALIDATED_PERSISTED',
      'VALIDATED_EPHEMERAL_ONLY',
      'CORE_REJECTED',
      'PROVIDER_FAILED',
    ].includes(String(receipt.status)) ||
    receipt.attemptCount !== 1 ||
    !(
      receipt.httpStatus === null ||
      (Number.isSafeInteger(receipt.httpStatus) &&
        Number(receipt.httpStatus) >= 100 &&
        Number(receipt.httpStatus) <= 599)
    ) ||
    !(
      receipt.latencyMs === null ||
      (Number.isSafeInteger(receipt.latencyMs) && Number(receipt.latencyMs) >= 0)
    ) ||
    !(receipt.schemaValid === null || typeof receipt.schemaValid === 'boolean') ||
    !(
      receipt.applicability === null ||
      (typeof receipt.applicability === 'string' &&
        ['OBSERVATION_AVAILABLE', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE', 'AMBIGUOUS'].includes(
          receipt.applicability,
        ))
    ) ||
    !safeCount(receipt.eventNuggetCount) ||
    !safeCount(receipt.factCount) ||
    !safeCount(receipt.groundedFactCount) ||
    !safeCount(receipt.unsupportedFactCount) ||
    !safeCount(receipt.validEvidenceReferenceCount) ||
    !safeCount(receipt.invalidEvidenceReferenceCount) ||
    !(
      receipt.schemaIssueCode === null ||
      (typeof receipt.schemaIssueCode === 'string' &&
        /^[A-Z0-9_:-]{1,80}$/u.test(receipt.schemaIssueCode))
    ) ||
    !(
      receipt.responseEnvelopeVariant === null ||
      (typeof receipt.responseEnvelopeVariant === 'string' &&
        [
          'CLOUDFLARE_RUN_RESPONSE',
          'CLOUDFLARE_RUN_CHAT_COMPLETION',
          'CLOUDFLARE_RUN_RESPONSES_API',
          'UNKNOWN',
          'NOT_PARSED',
        ].includes(receipt.responseEnvelopeVariant))
    ) ||
    !(
      receipt.completionStatus === null ||
      (typeof receipt.completionStatus === 'string' &&
        ['COMPLETE', 'INCOMPLETE', 'UNKNOWN'].includes(receipt.completionStatus))
    ) ||
    !['NOT_AUTHORIZED', 'PERSISTED', 'NOT_APPLICABLE'].includes(String(receipt.persistence)) ||
    !(
      receipt.errorCategory === null ||
      (typeof receipt.errorCategory === 'string' && /^LLM_[A-Z_]+$/u.test(receipt.errorCategory))
    ) ||
    receipt.realNewsBodyTransmitted !== false ||
    receipt.bodyPersisted !== false ||
    receipt.promptPersisted !== false ||
    receipt.rawResponsePersisted !== false ||
    receipt.liveAuthority !== 'UNASSIGNED' ||
    receipt.v10_11Executions !== 0 ||
    receipt.finalHoldoutExecutions !== 0
  )
    fail();
  if (receipt.usage !== null) {
    if (!isRecord(receipt.usage)) fail();
    const usage = receipt.usage;
    if (
      Object.keys(usage).sort().join('\0') !==
        ['inputTokens', 'outputTokens', 'totalTokens'].sort().join('\0') ||
      !safeCount(usage.inputTokens) ||
      !safeCount(usage.outputTokens) ||
      !safeCount(usage.totalTokens)
    )
      fail();
  }
  return Object.freeze({ ...value });
}

async function createDurableJson(path: string, value: unknown): Promise<void> {
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await access(path);
      throw new Error('TITLE_ONLY_RECEIPT_ALREADY_EXISTS');
    } catch (error) {
      if (error instanceof Error && error.message === 'TITLE_ONLY_RECEIPT_ALREADY_EXISTS')
        throw error;
      if (
        error === null ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
    await rename(temporary, path);
    if (process.platform !== 'win32') {
      const directory = await open(parent, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function summary(receipt: TitleOnlyProjectionReceipt, phase: 'PENDING' | 'FINAL') {
  return Object.freeze({
    runId: receipt.runId,
    provider: receipt.provider,
    model: receipt.model,
    scope: receipt.scope,
    articleId: receipt.articleId,
    articleVersionId: receipt.articleVersionId,
    projectionVersionId: receipt.projectionVersionId,
    projectionSha256: receipt.projectionSha256,
    phase,
    reservedRequestBudget: 1,
    attemptReservations: 1,
    responsesReceived: receipt.state === 'RESPONSE_RECEIVED' ? 1 : 0,
    unknownSent: receipt.state === 'UNKNOWN_SENT' ? 1 : 0,
    potentiallySent: 1,
    resultStatus: receipt.status,
    persistence: receipt.persistence,
    realNewsBodyTransmitted: false,
    bodyPersisted: false,
    promptPersisted: false,
    rawResponsePersisted: false,
    liveAuthority: 'UNASSIGNED',
    v10_11Executions: 0,
    finalHoldoutExecutions: 0,
  });
}

/**
 * A directory reservation makes this exact ArticleVersion/projection one-shot.
 * A crash leaves the reservation and pending receipt in place; it is never
 * interpreted as an unsent request or reused for another attempt.
 */
export class DurableTitleOnlyProjectionReceiptWriter implements TitleOnlyProjectionReceiptWriter {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private directory(receipt: TitleOnlyProjectionReceipt): string {
    return resolve(this.root, ARTICLE_ID, ARTICLE_VERSION_ID, receipt.projectionSha256);
  }

  async writePending(value: TitleOnlyProjectionReceipt): Promise<void> {
    const receipt = sanitizeReceipt(value);
    if (receipt.state !== 'ATTEMPT_PENDING' || receipt.status !== 'PENDING') fail();
    const directory = this.directory(receipt);
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory, { recursive: false });
    await createDurableJson(join(directory, 'attempt.pending.json'), receipt);
    await createDurableJson(join(directory, 'summary.pending.json'), summary(receipt, 'PENDING'));
  }

  async writeCompleted(value: TitleOnlyProjectionReceipt): Promise<void> {
    const receipt = sanitizeReceipt(value);
    if (receipt.state === 'ATTEMPT_PENDING' || receipt.status === 'PENDING') fail();
    const directory = this.directory(receipt);
    const pending = sanitizeReceipt(
      JSON.parse(
        await readFile(join(directory, 'attempt.pending.json'), 'utf8'),
      ) as TitleOnlyProjectionReceipt,
    );
    if (pending.runId !== receipt.runId || pending.projectionSha256 !== receipt.projectionSha256)
      fail();
    await createDurableJson(join(directory, 'attempt.result.json'), receipt);
    await createDurableJson(join(directory, 'summary.final.json'), summary(receipt, 'FINAL'));
  }
}
