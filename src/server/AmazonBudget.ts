/**
 * A ceiling on the requests sent to the Creators API, shared by every AMW process through Redis.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import type { Redis } from "ioredis";
import { AmazonError } from "./AmazonError";
import { getLogger, Logger } from "../utils/logger";

/**
 * Keywords and ids come from clients: past the cache, each new one costs an Amazon request. The
 * budget (Amazon.callLimit per Amazon.callLimitWindow seconds) keeps a flood of them from using
 * the whole Amazon quota, which the sites' cards need too. 0 disables it.
 */
class AmazonBudget {

  private static readonly KEY_PREFIX: string = 'amw:amazon-budget:';

  private readonly log: Logger;
  // Without Redis, or while it is down, each process counts for itself
  private memory = { window: -1, calls: 0 };
  private warnedWindow = -1;

  /**
   * @param limit Requests allowed per window, 0 for no limit.
   * @param windowSeconds Length of a window, in seconds.
   */
  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly redis?: Redis,
    private readonly now: () => number = () => Date.now()
  ) {
    this.log = getLogger("AmazonBudget");
  }

  public get enabled(): boolean {
    return this.limit > 0;
  }

  /**
   * Counts one request, before it is sent: failures and retries use the quota too.
   * @throws AmazonError `unavailable` with the seconds left in the window, once the budget is spent.
   */
  public async consume(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const windowMs = this.windowSeconds * 1000;
    const window = Math.floor(this.now() / windowMs);
    const calls = await this.count(window);
    if (calls <= this.limit) {
      return;
    }
    if (this.warnedWindow !== window) {
      this.warnedWindow = window;
      this.log.warn(`Amazon call budget of ${this.limit} per ${this.windowSeconds}s spent (Amazon.callLimit): cached products only until the window ends`);
    }
    throw new AmazonError('unavailable', 'Amazon call budget spent, Amazon API not called', {
      retryAfter: Math.max(1, Math.ceil(((window + 1) * windowMs - this.now()) / 1000))
    });
  }

  private async count(window: number): Promise<number> {
    // Commands sent while Redis is down would wait in its offline queue and delay the card
    if (this.redis && this.redis.status === 'ready') {
      const key = `${AmazonBudget.KEY_PREFIX}${window}`;
      try {
        const calls = await this.redis.incr(key);
        if (calls === 1) {
          await this.redis.expire(key, this.windowSeconds);
        }
        return calls;
      } catch (error) {
        this.log.error('Failed to count an Amazon call in Redis, counting in memory:', error);
      }
    }
    if (this.memory.window !== window) {
      this.memory = { window, calls: 0 };
    }
    return ++this.memory.calls;
  }
}

export { AmazonBudget };
