import { inspect } from 'node:util';
import type {
  EphemeralSemanticProvider,
  FrozenDecisionArticle,
  FrozenFieldIdentity,
  ObservedArticleMetadata,
  ParsedOriginalContent,
  ProviderEvidenceLocator,
} from './ephemeral.contracts';
import {
  decodeOriginalUtf8,
  normalizeFrozenFields,
  sha256Bytes,
  verifyEvidenceLocator,
} from './ephemeral.normalization';

/** Owns transferred acquisition/body buffers; no public body getter or serializer. */
export class EphemeralArticleContent {
  #acquired: Buffer | null;
  #body: Buffer | null;
  #disposed = false;
  readonly metadata: ObservedArticleMetadata;
  readonly acquiredContentHash: string;
  readonly normalizedInput: FrozenFieldIdentity;
  constructor(metadata: ObservedArticleMetadata, acquired: Buffer, parsed: ParsedOriginalContent) {
    this.metadata = Object.freeze({
      articleId: metadata.articleId,
      articleVersionId: metadata.articleVersionId,
      sourceId: metadata.sourceId,
      canonicalUrl: metadata.canonicalUrl,
      publisherItemId: metadata.publisherItemId,
      publishedAt: metadata.publishedAt,
      availableAt: metadata.availableAt,
      modifiedAt: metadata.modifiedAt,
      acquiredAt: metadata.acquiredAt,
      language: metadata.language,
      title: metadata.title,
      contentEncoding: metadata.contentEncoding,
    });
    this.#acquired = acquired;
    this.#body = parsed.body;
    try {
      if (!parsed.completeOriginalText || parsed.title !== metadata.title)
        throw new Error('INPUT_INVALID');
      this.acquiredContentHash = sha256Bytes(acquired);
      this.normalizedInput = normalizeFrozenFields(metadata.title, decodeOriginalUtf8(parsed.body));
    } catch {
      this.dispose();
      throw new Error('INPUT_INVALID');
    }
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  private assertOpen(): void {
    if (this.#disposed || this.#body === null) throw new Error('CONTENT_SCOPE_DISPOSED');
  }
  private openBody(): Buffer {
    this.assertOpen();
    const body = this.#body;
    if (body === null) throw new Error('CONTENT_SCOPE_DISPOSED');
    return body;
  }
  /** Only trusted provider implementations may consume the transient input. */
  observe(
    provider: EphemeralSemanticProvider,
    position: number,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.assertOpen();
    const readBody = (): string => {
      this.assertOpen();
      if (signal.aborted) throw new Error('CONTENT_SCOPE_DISPOSED');
      return decodeOriginalUtf8(this.openBody());
    };
    const input: FrozenDecisionArticle = Object.freeze({
      article_id: this.metadata.articleId,
      position,
      available_at: this.metadata.availableAt,
      published_at: this.metadata.publishedAt,
      source_id: this.metadata.sourceId,
      language: this.metadata.language,
      title: this.metadata.title,
      get body(): string {
        return readBody();
      },
      syndication_group: null,
      toJSON: () => ({ article_id: this.metadata.articleId, body: '[EPHEMERAL_REDACTED]' }),
      [inspect.custom]: () => ({
        article_id: this.metadata.articleId,
        body: '[EPHEMERAL_REDACTED]',
      }),
    });
    return provider.observe(input, signal);
  }
  /** Closed textual key fields must never become an alternate body column. */
  assertNoCompleteBodyRetention(value: string): void {
    const body = decodeOriginalUtf8(this.openBody());
    if (value.includes(body)) throw new Error('MAPPING_FAILED');
  }
  /** Validates hashes and code-point bounds without returning source text. */
  verifyLocator(locator: ProviderEvidenceLocator): void {
    this.assertOpen();
    const original =
      locator.field === 'title' ? this.metadata.title : decodeOriginalUtf8(this.openBody());
    verifyEvidenceLocator(locator, original);
  }
  verifyLLMFactFingerprint(locator: ProviderEvidenceLocator, role: string, expected: string): void {
    this.verifyLocator(locator);
    const original =
      locator.field === 'title' ? this.metadata.title : decodeOriginalUtf8(this.openBody());
    const value = Array.from(original).slice(locator.start, locator.end).join('');
    const normalized = role === 'external_id' ? value : value.normalize('NFC').toLowerCase();
    if (sha256Bytes(Buffer.from(normalized, 'utf8')) !== expected)
      throw new Error('MAPPING_FAILED');
  }
  dispose(): void {
    this.#acquired?.fill(0);
    this.#body?.fill(0);
    this.#acquired = null;
    this.#body = null;
    this.#disposed = true;
  }
  toJSON(): object {
    return {
      articleId: this.metadata.articleId,
      acquiredContentHash: this.acquiredContentHash,
      normalizedInput: this.normalizedInput,
      disposed: this.#disposed,
      body: '[EPHEMERAL_REDACTED]',
    };
  }
  [inspect.custom](): object {
    return this.toJSON();
  }
}
