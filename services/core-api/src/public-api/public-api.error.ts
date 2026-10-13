import { HttpException, HttpStatus } from '@nestjs/common';

import type { TombstoneDto } from './public-api.types.js';

export const publicErrorCodes = [
  'PUBLIC_ANALYSIS_UNAVAILABLE',
  'PUBLIC_FORBIDDEN',
  'PUBLIC_GONE',
  'PUBLIC_INTERNAL_FAILURE',
  'PUBLIC_INVALID_CURSOR',
  'PUBLIC_INVALID_ID',
  'PUBLIC_INVALID_REQUEST',
  'PUBLIC_NOT_FOUND',
  'PUBLIC_RATE_LIMITED',
  'PUBLIC_UNAUTHORIZED',
] as const;

export type PublicErrorCode = (typeof publicErrorCodes)[number];

export interface PublicExceptionPayload {
  readonly code: PublicErrorCode;
  readonly tombstone?: TombstoneDto;
}

export class PublicApiHttpException extends HttpException {
  public constructor(status: HttpStatus, code: PublicErrorCode, tombstone?: TombstoneDto) {
    super({ code, ...(tombstone === undefined ? {} : { tombstone }) }, status);
  }
}

export function invalidRequest(code: PublicErrorCode = 'PUBLIC_INVALID_REQUEST') {
  return new PublicApiHttpException(HttpStatus.BAD_REQUEST, code);
}

export function notFound() {
  return new PublicApiHttpException(HttpStatus.NOT_FOUND, 'PUBLIC_NOT_FOUND');
}

export function analysisUnavailable() {
  return new PublicApiHttpException(HttpStatus.CONFLICT, 'PUBLIC_ANALYSIS_UNAVAILABLE');
}

export function gone(tombstone: TombstoneDto) {
  return new PublicApiHttpException(HttpStatus.GONE, 'PUBLIC_GONE', tombstone);
}
