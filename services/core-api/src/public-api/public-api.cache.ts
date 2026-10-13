import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { PublicReadResult } from './public-api.types.js';

const PUBLIC_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=120';

function strongEtag(body: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('base64url');
  return `"${digest}"`;
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const normalizedEtag = etag.replace(/^W\//u, '');
  return header.split(',').some((candidate) => {
    const normalizedCandidate = candidate.trim().replace(/^W\//u, '');
    return normalizedCandidate === '*' || normalizedCandidate === normalizedEtag;
  });
}

export function sendPublicRead<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  result: PublicReadResult<T>,
): T | undefined {
  const etag = strongEtag(result.body);
  const lastModified = result.lastModified.toUTCString();
  void reply.header('cache-control', PUBLIC_CACHE_CONTROL);
  void reply.header('etag', etag);
  void reply.header('last-modified', lastModified);

  const ifNoneMatch = headerValue(request, 'if-none-match');
  const ifModifiedSince = headerValue(request, 'if-modified-since');
  const unmodifiedByDate = (() => {
    if (ifModifiedSince === undefined) return false;
    const value = Date.parse(ifModifiedSince);
    const lastModifiedSeconds = Math.floor(result.lastModified.getTime() / 1_000) * 1_000;
    return !Number.isNaN(value) && lastModifiedSeconds <= value;
  })();
  if (etagMatches(ifNoneMatch, etag) || (ifNoneMatch === undefined && unmodifiedByDate)) {
    void reply.status(304);
    return undefined;
  }
  return result.body;
}

export function publicEtagForTest(body: unknown): string {
  return strongEtag(body);
}
