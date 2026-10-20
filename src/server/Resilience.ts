/**
 * Building blocks that protect the Amazon API quota and keep serving products during outages.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

type Clock = () => number;

/**
 * Shares one in-flight promise between concurrent callers using the same key, so that a burst of
 * widget views for an uncached product costs a single Amazon call instead of one per visitor.
 */
class RequestCoalescer<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  public run(key: string, task: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const promise = task().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  public get size(): number {
    return this.inFlight.size;
  }
}

/**
 * In-memory cache bounded both in size (least recently used entries are evicted first) and in
 * time, used when Redis is disabled so that memory cannot grow with the number of distinct keys.
 */
class TtlLruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now
  ) { }

  public get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Map keeps insertion order: re-inserting marks the entry as most recently used
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  public set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  public get size(): number {
    return this.entries.size;
  }
}

type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Stops calling Amazon after `threshold` consecutive failures, for `cooldownMs`. Then a single
 * trial call is let through (half-open): success closes the circuit, failure re-opens it.
 * While open, requests fail fast (or are served from stale cache) instead of piling up timeouts
 * and burning the quota of an API that is already failing.
 * A threshold of 0 disables the breaker.
 */
class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private currentState: CircuitState = 'closed';
  private trialInFlight = false;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: Clock = Date.now
  ) { }

  public get state(): CircuitState {
    return this.currentState;
  }

  /**
   * @returns true when the caller may call Amazon; it must then report the outcome with
   * recordSuccess() or recordFailure().
   */
  public tryAcquire(): boolean {
    if (this.threshold <= 0 || this.currentState === 'closed') {
      return true;
    }
    if (this.currentState === 'open' && this.now() - this.openedAt >= this.cooldownMs) {
      this.currentState = 'half-open';
    }
    if (this.currentState === 'half-open' && !this.trialInFlight) {
      this.trialInFlight = true;
      return true;
    }
    return false;
  }

  public recordSuccess(): void {
    this.failures = 0;
    this.trialInFlight = false;
    this.currentState = 'closed';
  }

  public recordFailure(): void {
    this.trialInFlight = false;
    this.failures++;
    if (this.threshold > 0 && (this.currentState === 'half-open' || this.failures >= this.threshold)) {
      this.currentState = 'open';
      this.openedAt = this.now();
    }
  }

  /** Seconds until a trial call will be allowed, for the Retry-After header. */
  public retryAfterSeconds(): number {
    if (this.currentState !== 'open') {
      return 1;
    }
    const remainingMs = this.cooldownMs - (this.now() - this.openedAt);
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }
}

export { RequestCoalescer, TtlLruCache, CircuitBreaker };
export type { CircuitState };
