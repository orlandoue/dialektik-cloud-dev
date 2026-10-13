import { ServiceUnavailableException } from '@nestjs/common';
import type { LLMConfig, StructuredLLMTransport } from '../llm-shadow/llm.contracts.js';
import { MAX_LIVE_FEED_BYTES } from '../live/live.adapter.js';

export const PERSONAL_OWNER_FEED_READER = Symbol('PERSONAL_OWNER_FEED_READER');
export const PERSONAL_OWNER_JOB_DISPATCHER = Symbol('PERSONAL_OWNER_JOB_DISPATCHER');
export const PERSONAL_OWNER_LLM_TRANSPORT_FACTORY = Symbol('PERSONAL_OWNER_LLM_TRANSPORT_FACTORY');

export interface PersonalOwnerFeedValidators {
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface PersonalOwnerFeedReadResult {
  readonly status: 200 | 304;
  readonly content: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly retryAfterMs: number | null;
}

export class PersonalOwnerFeedReadFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs: number | null = null,
    readonly httpStatus: number | null = null,
  ) {
    super(code);
  }
}

export interface PersonalOwnerFeedReader {
  read(endpoint: string, signal?: AbortSignal): Promise<string>;
  readConditional?(
    endpoint: string,
    validators: PersonalOwnerFeedValidators,
    signal?: AbortSignal,
  ): Promise<PersonalOwnerFeedReadResult>;
}

export type PersonalOwnerProviderMode = 'disabled' | 'mock' | 'cloudflare';

export interface PersonalOwnerLLMTransportSelection {
  readonly config: LLMConfig;
  readonly transport: StructuredLLMTransport;
}

export interface PersonalOwnerLLMTransportFactory {
  create(modelId: string): PersonalOwnerLLMTransportSelection;
}

export interface PersonalOwnerJobDispatcher {
  readonly providerMode: PersonalOwnerProviderMode;
  enqueue(jobId: string): void;
  cancelJob(jobId: string): void;
  cancelSource(sourceId: string): void;
  cancelOwner(ownerId: string): void;
}

export class GuardedPersonalOwnerFeedReader implements PersonalOwnerFeedReader {
  async read(endpoint: string, signal = new AbortController().signal): Promise<string> {
    const result = await this.readConditional(endpoint, { etag: null, lastModified: null }, signal);
    if (result.content === null)
      throw new ServiceUnavailableException('PUBLISHER_FEED_NOT_MODIFIED');
    return result.content;
  }

  async readConditional(
    endpoint: string,
    validators: PersonalOwnerFeedValidators,
    signal = new AbortController().signal,
  ): Promise<PersonalOwnerFeedReadResult> {
    if (process.env.DIALEKTIK_PERSONAL_OWNER_ACQUISITION_MODE !== 'live')
      throw new ServiceUnavailableException('PUBLISHER_ACQUISITION_DISABLED');
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new ServiceUnavailableException('PUBLISHER_ENDPOINT_INVALID');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new ServiceUnavailableException('PUBLISHER_ENDPOINT_INVALID');
    const timeout = AbortSignal.timeout(12_000);
    const headers = new Headers({
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    });
    if (validators.etag) headers.set('if-none-match', validators.etag);
    if (validators.lastModified) headers.set('if-modified-since', validators.lastModified);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.any([signal, timeout]),
      headers,
    }).catch(() => {
      throw new PersonalOwnerFeedReadFailure('PUBLISHER_FEED_FETCH_FAILED');
    });
    const etag = safeFeedValidator(response.headers.get('etag'), 512);
    const lastModified = safeFeedValidator(response.headers.get('last-modified'), 128);
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    if (response.status === 304) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 304, content: null, etag, lastModified, retryAfterMs };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new PersonalOwnerFeedReadFailure(
        'PUBLISHER_FEED_FETCH_FAILED',
        retryAfterMs,
        response.status,
      );
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_LIVE_FEED_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new PersonalOwnerFeedReadFailure(
        'PUBLISHER_FEED_TOO_LARGE',
        retryAfterMs,
        response.status,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new PersonalOwnerFeedReadFailure('PUBLISHER_FEED_EMPTY', retryAfterMs);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_LIVE_FEED_BYTES) throw new Error('PUBLISHER_FEED_TOO_LARGE');
        chunks.push(value);
      }
      return {
        status: 200,
        content: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
        etag,
        lastModified,
        retryAfterMs,
      };
    } catch (error) {
      throw new PersonalOwnerFeedReadFailure(
        error instanceof Error && error.message === 'PUBLISHER_FEED_TOO_LARGE'
          ? 'PUBLISHER_FEED_TOO_LARGE'
          : 'PUBLISHER_FEED_INVALID',
        retryAfterMs,
        response.status,
      );
    } finally {
      for (const chunk of chunks) chunk.fill(0);
      await reader.cancel().catch(() => undefined);
    }
  }
}

function safeFeedValidator(value: string | null, maxLength: number): string | null {
  if (
    !value ||
    value.length > maxLength ||
    /[\r\n]/u.test(value) ||
    value.includes(String.fromCharCode(0))
  )
    return null;
  return value;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(86_400_000, Math.max(0, Math.round(seconds * 1000)));
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.min(86_400_000, Math.max(0, at - Date.now()));
}

export const DISABLED_PERSONAL_OWNER_JOB_DISPATCHER: PersonalOwnerJobDispatcher = Object.freeze({
  providerMode: 'disabled',
  enqueue: () => undefined,
  cancelJob: () => undefined,
  cancelSource: () => undefined,
  cancelOwner: () => undefined,
});
