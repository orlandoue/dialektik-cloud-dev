import { createHash } from 'node:crypto';
import type {
  FrozenFieldIdentity,
  ObservedArticleMetadata,
  ProviderEvidenceLocator,
} from './ephemeral.contracts';

export const FROZEN_NORMALIZATION_VERSION = 'v10.11-original-fields-identity-v1';
export const OFFSET_CONVENTION = 'unicode_code_point_v1';
const awareTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export function sha256Utf8(text: string): string {
  assertUnicodeScalars(text);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
/** Reject surrogate corruption; never normalize combining marks or whitespace. */
export function assertUnicodeScalars(text: string): void {
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) throw new Error('NORMALIZATION_FAILED');
  }
}
export function decodeOriginalUtf8(bytes: Uint8Array): string {
  // ignoreBOM preserves an original U+FEFF rather than silently dropping it.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
export function codePointSlice(text: string, start: number, end: number): string {
  assertUnicodeScalars(text);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start)
    throw new Error('MAPPING_FAILED');
  const points = Array.from(text);
  if (end > points.length) throw new Error('MAPPING_FAILED');
  return points.slice(start, end).join('');
}
export function normalizeFrozenFields(title: string, originalBody: string): FrozenFieldIdentity {
  assertUnicodeScalars(title);
  assertUnicodeScalars(originalBody);
  if (title.trim().length === 0 || originalBody.trim().length === 0)
    throw new Error('INPUT_INVALID');
  return Object.freeze({
    inputHash: sha256Utf8(originalBody),
    titleHash: sha256Utf8(title),
    bodyCodepoints: Array.from(originalBody).length,
    titleCodepoints: Array.from(title).length,
    normalizationVersion: FROZEN_NORMALIZATION_VERSION,
    offsetConvention: OFFSET_CONVENTION,
  });
}
export function assertOriginalMetadata(metadata: ObservedArticleMetadata, position: number): void {
  const record = metadata as unknown as Record<string, unknown>;
  if (
    [
      'articleId',
      'articleVersionId',
      'sourceId',
      'canonicalUrl',
      'title',
      'contentEncoding',
      'publishedAt',
      'availableAt',
      'acquiredAt',
    ].some((key) => typeof record[key] !== 'string')
  )
    throw new Error('INPUT_INVALID');
  if (
    !metadata.articleId ||
    !metadata.articleVersionId ||
    !metadata.sourceId ||
    !metadata.title ||
    metadata.title.trim().length === 0 ||
    Array.from(metadata.title).length > 1024 ||
    metadata.articleId.length > 128 ||
    metadata.articleVersionId.length > 128 ||
    metadata.sourceId.length > 128 ||
    (metadata.language !== null && !/^[A-Za-z][A-Za-z0-9-]{0,34}$/.test(metadata.language)) ||
    (metadata.publisherItemId !== null &&
      (metadata.publisherItemId.length === 0 || metadata.publisherItemId.length > 512)) ||
    (metadata as unknown as Record<string, unknown>).contentEncoding !== 'utf-8' ||
    !Number.isSafeInteger(position) ||
    position < 1 ||
    !(metadata.language === null || typeof metadata.language === 'string') ||
    !(metadata.publisherItemId === null || typeof metadata.publisherItemId === 'string')
  )
    throw new Error('INPUT_INVALID');
  assertUnicodeScalars(metadata.title);
  for (const time of [
    metadata.publishedAt,
    metadata.availableAt,
    metadata.acquiredAt,
    metadata.modifiedAt,
  ]) {
    if (time !== null) {
      if (!awareTimestamp.test(time) || !Number.isFinite(Date.parse(time)))
        throw new Error('INPUT_INVALID');
      const year = Number(time.slice(0, 4)),
        month = Number(time.slice(5, 7)),
        day = Number(time.slice(8, 10));
      if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate()
      )
        throw new Error('INPUT_INVALID');
    }
  }
  if (Date.parse(metadata.acquiredAt) < Date.parse(metadata.availableAt))
    throw new Error('INPUT_INVALID');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(metadata.canonicalUrl);
  } catch {
    throw new Error('INPUT_INVALID');
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    metadata.canonicalUrl.length > 2048 ||
    parsedUrl.username ||
    parsedUrl.password
  )
    throw new Error('INPUT_INVALID');
}
export function verifyEvidenceLocator(locator: ProviderEvidenceLocator, original: string): string {
  const span = codePointSlice(original, locator.start, locator.end);
  if (sha256Utf8(original) !== locator.sourceSha256 || sha256Utf8(span) !== locator.spanSha256)
    throw new Error('MAPPING_FAILED');
  return span;
}
export interface RefetchVerification {
  readonly sourceVersionStatus: 'HASH_MATCH' | 'SOURCE_VERSION_CHANGED' | 'SOURCE_UNAVAILABLE';
  readonly reproducibilityClass:
    | 'HASH_VERIFIABLE_REFETCH_REQUIRED'
    | 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE';
  readonly offsetsUsable: boolean;
  readonly refetchedInputHash: string | null;
}
/** Body-field-only verifier; current-page locators require verifyRefetchedFields. */
export function verifyRefetchedInput(
  historicalHash: string,
  historicalNormalizationVersion: string,
  refetchedOriginalBody: string | null,
): RefetchVerification {
  if (
    !/^[a-f0-9]{64}$/.test(historicalHash) ||
    historicalNormalizationVersion !== FROZEN_NORMALIZATION_VERSION
  )
    throw new Error('INPUT_INVALID');
  if (refetchedOriginalBody === null)
    return Object.freeze({
      sourceVersionStatus: 'SOURCE_UNAVAILABLE',
      reproducibilityClass: 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE',
      offsetsUsable: false,
      refetchedInputHash: null,
    });
  const refetchedInputHash = sha256Utf8(refetchedOriginalBody);
  const same = historicalHash === refetchedInputHash;
  return Object.freeze({
    sourceVersionStatus: same ? 'HASH_MATCH' : 'SOURCE_VERSION_CHANGED',
    reproducibilityClass: same
      ? 'HASH_VERIFIABLE_REFETCH_REQUIRED'
      : 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE',
    offsetsUsable: same,
    refetchedInputHash,
  });
}
/** Both original fields must match before applying locators to the current page. */
export function verifyRefetchedFields(
  historicalBodyHash: string,
  historicalTitleHash: string,
  historicalNormalizationVersion: string,
  refetchedOriginalBody: string | null,
  refetchedOriginalTitle: string | null,
): RefetchVerification {
  if (!/^[a-f0-9]{64}$/.test(historicalTitleHash)) throw new Error('INPUT_INVALID');
  const body = verifyRefetchedInput(
    historicalBodyHash,
    historicalNormalizationVersion,
    refetchedOriginalBody,
  );
  if (refetchedOriginalBody === null || refetchedOriginalTitle === null)
    return Object.freeze({
      sourceVersionStatus: 'SOURCE_UNAVAILABLE',
      reproducibilityClass: 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE',
      offsetsUsable: false,
      refetchedInputHash: body.refetchedInputHash,
    });
  const same = body.offsetsUsable && sha256Utf8(refetchedOriginalTitle) === historicalTitleHash;
  return Object.freeze({
    sourceVersionStatus: same ? 'HASH_MATCH' : 'SOURCE_VERSION_CHANGED',
    reproducibilityClass: same
      ? 'HASH_VERIFIABLE_REFETCH_REQUIRED'
      : 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE',
    offsetsUsable: same,
    refetchedInputHash: body.refetchedInputHash,
  });
}
