import { HttpStatus, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { PublicApiHttpException } from './public-api.error.js';

interface RateWindow {
  count: number;
  startedAt: number;
}

const WINDOW_MILLISECONDS = 60_000;
const MAXIMUM_REQUESTS = 300;
const MAXIMUM_TRACKED_CLIENTS = 10_000;

/**
 * The quota bucket for a request. A signed-in reader (set by the private beta
 * guard after verifying the JWT) gets their own bucket, so readers behind the
 * same proxy or carrier NAT never consume each other's quota. Anything else
 * falls back to the client address resolved through the trusted proxy hop.
 */
export function rateLimitClient(request: FastifyRequest): string {
  const userId = (request as FastifyRequest & { betaUserId?: string }).betaUserId;
  return typeof userId === 'string' && userId.length > 0 ? `user:${userId}` : `ip:${request.ip}`;
}

@Injectable()
export class PublicRateLimitService {
  readonly #clients = new Map<string, RateWindow>();

  public assertAllowed(clientAddress: string, now = Date.now()): void {
    const existing = this.#clients.get(clientAddress);
    if (existing === undefined || now - existing.startedAt >= WINDOW_MILLISECONDS) {
      this.#prune(now);
      this.#clients.set(clientAddress, { count: 1, startedAt: now });
      return;
    }
    if (existing.count >= MAXIMUM_REQUESTS) {
      throw new PublicApiHttpException(HttpStatus.TOO_MANY_REQUESTS, 'PUBLIC_RATE_LIMITED');
    }
    existing.count += 1;
  }

  #prune(now: number): void {
    if (this.#clients.size < MAXIMUM_TRACKED_CLIENTS) return;
    for (const [client, window] of this.#clients) {
      if (now - window.startedAt >= WINDOW_MILLISECONDS) this.#clients.delete(client);
    }
    if (this.#clients.size >= MAXIMUM_TRACKED_CLIENTS) {
      const oldest = this.#clients.keys().next().value;
      if (oldest !== undefined) this.#clients.delete(oldest);
    }
  }
}
