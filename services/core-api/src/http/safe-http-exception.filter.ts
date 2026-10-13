import { STATUS_CODES } from 'node:http';

import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { PublicApiHttpException } from '../public-api/public-api.error.js';
import type { PublicErrorCode } from '../public-api/public-api.error.js';
import type { TombstoneDto } from '../public-api/public-api.types.js';

interface SafeErrorResponse {
  readonly code?: string;
  readonly error: string;
  readonly requestId: string;
  readonly statusCode: number;
  readonly tombstone?: TombstoneDto;
}

function defaultPublicCode(statusCode: number): PublicErrorCode {
  if (statusCode === 401) return 'PUBLIC_UNAUTHORIZED';
  if (statusCode === 403) return 'PUBLIC_FORBIDDEN';
  if (statusCode === 404) return 'PUBLIC_NOT_FOUND';
  if (statusCode === 429) return 'PUBLIC_RATE_LIMITED';
  if (statusCode >= 400 && statusCode < 500) return 'PUBLIC_INVALID_REQUEST';
  return 'PUBLIC_INTERNAL_FAILURE';
}

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse<FastifyReply>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorType = exception instanceof Error ? exception.constructor.name : 'UnknownError';
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const declaredSafeCode =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'code' in exceptionResponse &&
      typeof exceptionResponse.code === 'string' &&
      /^(?:MOD|PUBLIC)_[A-Z_]+$/u.test(exceptionResponse.code)
        ? exceptionResponse.code
        : undefined;
    const personalOwnerMessage =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : typeof exceptionResponse === 'object' &&
            exceptionResponse !== null &&
            'message' in exceptionResponse &&
            typeof exceptionResponse.message === 'string'
          ? exceptionResponse.message
          : undefined;
    const personalOwnerSafeCode =
      request.url.split('?')[0]?.startsWith('/personal/owner/') &&
      personalOwnerMessage !== undefined &&
      /^[A-Z0-9_.:-]{1,96}$/u.test(personalOwnerMessage)
        ? `PERSONAL_OWNER_${personalOwnerMessage}`
        : undefined;
    const isPublicRoute = request.url.startsWith('/v1/') && !request.url.startsWith('/v1/mod/');
    const safeCode =
      declaredSafeCode ??
      personalOwnerSafeCode ??
      (isPublicRoute ? defaultPublicCode(statusCode) : undefined);
    const tombstone =
      exception instanceof PublicApiHttpException &&
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'tombstone' in exceptionResponse
        ? (exceptionResponse.tombstone as TombstoneDto)
        : undefined;

    request.log.error(
      {
        errorType,
        event: 'core_api_request_failed',
        failureClass: isPublicRoute ? 'public_read' : 'internal_operation',
        requestId: request.id,
        statusCode,
      },
      'Core API request failed',
    );

    const body: SafeErrorResponse = {
      error: STATUS_CODES[statusCode] ?? 'Request Failed',
      requestId: request.id,
      statusCode,
      ...(safeCode === undefined ? {} : { code: safeCode }),
      ...(tombstone === undefined ? {} : { tombstone }),
    };
    void response.header('cache-control', 'no-store');
    if (statusCode === 429) {
      void response.header('retry-after', '60');
    }
    void response.status(statusCode).send(body);
  }
}
