import { createHash } from 'node:crypto';

import { isUlid } from '@dialektik/database';

import { invalidRequest } from './public-api.error.js';

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const FILTER_VALUE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;

export interface PageCursor {
  readonly timestamp: Date;
  readonly id: string;
}

interface CursorWire {
  readonly filter: string;
  readonly id: string;
  readonly kind: string;
  readonly timestamp: string;
  readonly version: 1;
}

export interface PageRequest {
  readonly cursor: PageCursor | null;
  readonly filterFingerprint: string;
  readonly limit: number;
}

export function parseUlidParameter(value: string): string {
  if (!isUlid(value)) throw invalidRequest('PUBLIC_INVALID_ID');
  return value;
}

export function parseOptionalFilter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !FILTER_VALUE.test(value)) throw invalidRequest();
  return value;
}

export function assertExactQueryKeys(
  query: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(query).some((key) => !allowedSet.has(key))) throw invalidRequest();
}

function filterFingerprint(filters: Readonly<Record<string, string | undefined>>): string {
  const canonical = Object.entries(filters)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha256').update(canonical, 'utf8').digest('base64url').slice(0, 16);
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) throw invalidRequest();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAXIMUM_LIMIT) throw invalidRequest();
  return parsed;
}

function decodeCursor(
  encoded: unknown,
  kind: string,
  expectedFilterFingerprint: string,
): PageCursor | null {
  if (encoded === undefined) return null;
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 512) {
    throw invalidRequest('PUBLIC_INVALID_CURSOR');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidRequest('PUBLIC_INVALID_CURSOR');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(',') !== 'filter,id,kind,timestamp,version'
  ) {
    throw invalidRequest('PUBLIC_INVALID_CURSOR');
  }
  const cursor = parsed as Partial<CursorWire>;
  if (
    cursor.version !== 1 ||
    cursor.kind !== kind ||
    cursor.filter !== expectedFilterFingerprint ||
    typeof cursor.id !== 'string' ||
    !isUlid(cursor.id) ||
    typeof cursor.timestamp !== 'string' ||
    !CURSOR_TIMESTAMP.test(cursor.timestamp)
  ) {
    throw invalidRequest('PUBLIC_INVALID_CURSOR');
  }
  const timestamp = new Date(cursor.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw invalidRequest('PUBLIC_INVALID_CURSOR');
  return { id: cursor.id, timestamp };
}

export function parsePageRequest(
  query: Readonly<Record<string, unknown>>,
  kind: string,
  filters: Readonly<Record<string, string | undefined>>,
): PageRequest {
  const fingerprint = filterFingerprint(filters);
  return {
    cursor: decodeCursor(query.cursor, kind, fingerprint),
    filterFingerprint: fingerprint,
    limit: readLimit(query.limit),
  };
}

export function encodeCursor(kind: string, filter: string, timestamp: Date, id: string): string {
  const wire: CursorWire = {
    filter,
    id,
    kind,
    timestamp: timestamp.toISOString(),
    version: 1,
  };
  return Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
}
