import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import type { CoreApiConfig } from '../config/core-api-config.js';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

function requestIdFromHeader(request: IncomingMessage): string | undefined {
  const header = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;
  if (candidate === undefined || !SAFE_REQUEST_ID.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function trustProxyHops(hops: number | undefined): ((address: string, hop: number) => boolean) | false {
  const value = hops ?? 1;
  if (!Number.isInteger(value) || value < 1) return false;
  // Same semantics as a numeric hop count: trust the nearest `value` hops.
  return (_address: string, hop: number) => hop < value;
}

export function createFastifyOptions(config: Readonly<CoreApiConfig>): FastifyServerOptions {
  return {
    bodyLimit: 1_048_576,
    genReqId: (request) => requestIdFromHeader(request) ?? randomUUID(),
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: {
              censor: '[REDACTED]',
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers.x-api-key',
                'res.headers.set-cookie',
              ],
            },
          },
    requestTimeout: 15_000,
    // Render terminates TLS in one proxy that appends the real client to
    // X-Forwarded-For. Trusting exactly that hop makes request.ip the caller
    // instead of the proxy (so unauthenticated rate limits are per client),
    // while addresses a client injects further left are still ignored.
    trustProxy: trustProxyHops(config.trustedProxyHops),
  };
}

export function registerRequestCorrelation(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  fastify.addHook('onResponse', (request, reply, done) => {
    if (request.url.startsWith('/v1/')) {
      request.log.info(
        {
          durationMs: Number(reply.elapsedTime.toFixed(3)),
          event: 'core_api_request_completed',
          requestId: request.id,
          route: request.routeOptions.url,
          statusCode: reply.statusCode,
        },
        'Core API request completed',
      );
    }
    done();
  });
}
