/**
 * An in-memory cache for reads every reader gets alike (the common feed,
 * duels and videos). It never holds anything personal: callers only use it
 * on the non-personalized branch, and personal state (follows, «Ya
 * opinaste») is read per user elsewhere, after this cache.
 *
 * A reader never waits for the database while a recent copy exists:
 * - up to `freshMs` the copy is served as is;
 * - up to `staleMs` it is still served at once, and one background read
 *   replaces it for the next reader;
 * - older (or never read), the reader waits for the read, which concurrent
 *   readers share.
 * `warm()` re-reads, one at a time, the copies readers asked for recently
 * before they get old, so even the first opening after a quiet hour is
 * answered from memory while the semantic engine loads the database.
 * A failed read never replaces a good copy and is never kept.
 */
export interface SharedReadCacheOptions {
  readonly freshMs: number;
  readonly staleMs: number;
  /** Copies at least this old are re-read by `warm()`. */
  readonly warmAfterMs?: number;
  /** Only copies requested within this window are kept warm. */
  readonly keepWarmMs?: number;
  /** At most this many copies (most recently requested first) are kept warm. */
  readonly maxWarm?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

interface Entry<T> {
  /** The last good copy and when it was read. */
  copy?: { at: number; value: T };
  /** The read in flight, shared by every reader that waits for it. */
  pending?: Promise<T> | undefined;
  load: () => Promise<T>;
  requestedAt: number;
  /** First pages are kept warm; later pages and searches only cached. */
  keepWarm: boolean;
}

export class SharedReadCache<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #freshMs: number;
  readonly #staleMs: number;
  readonly #warmAfterMs: number;
  readonly #keepWarmMs: number;
  readonly #maxWarm: number;
  readonly #maxEntries: number;
  readonly #now: () => number;
  #timer: ReturnType<typeof setInterval> | undefined;
  #warming = false;

  constructor(options: SharedReadCacheOptions) {
    this.#freshMs = options.freshMs;
    this.#staleMs = Math.max(options.staleMs, options.freshMs);
    this.#warmAfterMs = options.warmAfterMs ?? Math.max(this.#freshMs, this.#staleMs - 60_000);
    this.#keepWarmMs = options.keepWarmMs ?? 6 * 60 * 60_000;
    this.#maxWarm = options.maxWarm ?? 20;
    this.#maxEntries = options.maxEntries ?? 200;
    this.#now = options.now ?? Date.now;
  }

  get(key: string, load: () => Promise<T>, keepWarm = true): Promise<T> {
    const now = this.#now();
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = { load, requestedAt: now, keepWarm };
      this.#entries.set(key, entry);
      this.#bound();
    } else {
      // Most recently requested last, so eviction drops the coldest key.
      this.#entries.delete(key);
      this.#entries.set(key, entry);
      entry.load = load;
      entry.requestedAt = now;
      entry.keepWarm = keepWarm;
    }
    const copy = entry.copy;
    if (copy !== undefined && now - copy.at < this.#freshMs) return Promise.resolve(copy.value);
    if (copy !== undefined && now - copy.at < this.#staleMs) {
      // Served now; the refresh is for the next reader and never throws.
      this.#read(key, entry).catch(() => undefined);
      return Promise.resolve(copy.value);
    }
    return this.#read(key, entry);
  }

  /** Re-reads, one by one, the recently requested copies that are getting old. */
  async warm(): Promise<number> {
    if (this.#warming) return 0;
    this.#warming = true;
    let refreshed = 0;
    try {
      const now = this.#now();
      const due = [...this.#entries.entries()]
        .filter(([, entry]) => entry.keepWarm && now - entry.requestedAt < this.#keepWarmMs)
        .filter(([, entry]) => entry.copy === undefined || now - entry.copy.at >= this.#warmAfterMs)
        .sort(([, a], [, b]) => b.requestedAt - a.requestedAt)
        .slice(0, this.#maxWarm);
      for (const [key, entry] of due) {
        if (this.#entries.get(key) !== entry) continue;
        try {
          await this.#read(key, entry);
          refreshed += 1;
        } catch { /* keeps the old copy; the next reader or tick tries again */ }
      }
    } finally {
      this.#warming = false;
    }
    return refreshed;
  }

  /** Keeps copies warm every `intervalMs` without holding the process open. */
  startWarming(intervalMs = 60_000): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => { this.warm().catch(() => undefined); }, intervalMs);
    this.#timer.unref?.();
  }

  stopWarming(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Forgets a copy so the next reader reads it again (after a write). */
  invalidate(key: string): void {
    this.#entries.delete(key);
  }

  get size(): number {
    return this.#entries.size;
  }

  #read(key: string, entry: Entry<T>): Promise<T> {
    if (entry.pending !== undefined) return entry.pending;
    const pending = entry.load();
    entry.pending = pending;
    pending.then(
      (value) => {
        if (entry.pending === pending) entry.pending = undefined;
        if (this.#entries.get(key) === entry) entry.copy = { at: this.#now(), value };
      },
      () => {
        if (entry.pending === pending) entry.pending = undefined;
        // A key that never read successfully is not kept.
        if (entry.copy === undefined && this.#entries.get(key) === entry) this.#entries.delete(key);
      },
    );
    return pending;
  }

  #bound(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) return;
      this.#entries.delete(oldest);
    }
  }
}

/**
 * Common reads: served as is for 60 s, served at once and refreshed behind
 * for up to 10 min, and kept warm every minute (re-read from 4 min), so a
 * news item reaches the app at most ~5 min after Core has it.
 */
export const SHARED_READ_OPTIONS: SharedReadCacheOptions = {
  freshMs: 60_000,
  staleMs: 10 * 60_000,
  warmAfterMs: 4 * 60_000,
};
export const SHARED_READ_WARM_INTERVAL_MS = 60_000;
