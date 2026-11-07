/**
 * A setting the administration portal can change while the server runs.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import type { Redis } from "ioredis";
import type { z } from "zod";
import { getLogger, Logger } from "../utils/logger";

/**
 * The configuration files give the default, and the portal's value lives in Redis: the container
 * has a read-only filesystem, and several server processes must end up with the same value.
 */
class RuntimeSetting<T> {

  // Other processes pick up a change of the portal within this delay
  private static readonly REFRESH_INTERVAL: number = 60 * 1000;

  private readonly log: Logger;
  private value: T;
  private refreshedAt: number = -Infinity;

  /** @param schema What may be stored: these values are prepended to widget.js. */
  constructor(
    private readonly key: string,
    private readonly schema: z.ZodType<T>,
    defaults: T,
    private readonly redis?: Redis,
    private readonly now: () => number = Date.now
  ) {
    this.log = getLogger("RuntimeSetting");
    this.value = defaults;
  }

  public get editable(): boolean {
    return this.redis !== undefined;
  }

  public current(): T {
    return this.value;
  }

  /** Never throws: without Redis, or with an unusable value, the last known value remains. */
  public async refresh(): Promise<void> {
    if (!this.redis || this.now() - this.refreshedAt < RuntimeSetting.REFRESH_INTERVAL) {
      return;
    }
    this.refreshedAt = this.now();
    try {
      const stored = await this.redis.get(this.key);
      if (stored) {
        this.value = this.schema.parse(JSON.parse(stored));
      }
    } catch (error) {
      this.log.warn(`Failed to read ${this.key}:`, error);
    }
  }

  /**
   * @returns The stored value, or null when `input` is not valid.
   * @throws When Redis is unavailable, so that the portal does not report a change that is lost.
   */
  public async save(input: unknown): Promise<T | null> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    if (!this.redis) {
      throw new Error(`Saving ${this.key} requires Redis`);
    }
    await this.redis.set(this.key, JSON.stringify(parsed.data));
    this.value = parsed.data;
    this.refreshedAt = this.now();
    return parsed.data;
  }
}

export { RuntimeSetting };
