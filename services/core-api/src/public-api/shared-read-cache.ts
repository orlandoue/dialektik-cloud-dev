/**
 * A short in-memory cache for reads every reader gets alike (the common
 * feed, duels and videos). It never holds anything personal: callers only
 * use it on the non-personalized branch, and personal state (follows,
 * «Ya opinaste») is read per user elsewhere, after this cache.
 *
 * Concurrent misses for one key share a single database query, so a burst
 * of app openings while the engine loads the server costs one read.
 */
export class SharedReadCache<T> {
  readonly #entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.#entries.get(key);
    if (hit !== undefined && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.#entries.set(key, { at: this.now(), value });
    // A failed read is not kept: the next request tries again.
    value.catch(() => {
      if (this.#entries.get(key)?.value === value) this.#entries.delete(key);
    });
    if (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    return value;
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** 60 s: news change by the minute, and every opening within it is free. */
export const SHARED_READ_TTL_MS = 60_000;
