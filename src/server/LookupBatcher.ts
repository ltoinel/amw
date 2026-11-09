/**
 * Gathers the lookups asked within a short window into one call: a page of several cards whose
 * products left the cache costs one Amazon request instead of one per card.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

interface Waiting<K, V> {
  key: K;
  resolve: (value: V | undefined) => void;
  reject: (error: unknown) => void;
}

class LookupBatcher<K, V> {
  private queue: Waiting<K, V>[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param fetch Looks up several keys at once; a key missing from its answer resolves undefined.
   * @param maxSize Keys per call (GetItems takes 10 ASINs at most).
   * @param windowMs How long a lookup waits for others: the extra latency of a cache miss.
   */
  constructor(
    private readonly fetch: (keys: K[]) => Promise<Map<K, V>>,
    private readonly maxSize: number,
    private readonly windowMs: number
  ) {}

  public get(key: K): Promise<V | undefined> {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      if (new Set(this.queue.map(waiting => waiting.key)).size >= this.maxSize) {
        this.flush();
      } else if (this.timer === undefined) {
        this.timer = setTimeout(() => this.flush(), this.windowMs);
      }
    });
  }

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.queue;
    this.queue = [];
    const keys = [...new Set(batch.map(waiting => waiting.key))];
    this.fetch(keys).then(
      found => batch.forEach(waiting => waiting.resolve(found.get(waiting.key))),
      // The same error for every waiting lookup: the caller can tell it was one failed call
      error => batch.forEach(waiting => waiting.reject(error))
    );
  }
}

export { LookupBatcher };
