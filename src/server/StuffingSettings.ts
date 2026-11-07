/**
 * Where widget.js adds cards to an article: settings that can change while the server runs.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import type { Redis } from "ioredis";
import { z } from "zod";
import { getLogger, Logger } from "../utils/logger";
import { CONTAINER_ID, MAX_STUFFED_CARDS, type StuffingConfig } from "./Settings";

/** What the portal may submit. Prepended to widget.js, so nothing but these shapes may pass. */
const stuffingSchema = z.strictObject({
  count: z.number().int().min(0).max(MAX_STUFFED_CARDS),
  containerId: z.string().regex(CONTAINER_ID),
});

/**
 * The configuration files give the defaults, and the portal's values live in Redis: the container
 * has a read-only filesystem, and several server processes must end up with the same values.
 */
class StuffingSettings {

  private static readonly KEY: string = 'amw:settings:stuffing';
  // Other processes pick up a change of the portal within this delay
  private static readonly REFRESH_INTERVAL: number = 60 * 1000;

  private readonly log: Logger;
  private readonly redis: Redis | undefined;
  private readonly now: () => number;
  private value: StuffingConfig;
  private refreshedAt: number = -Infinity;

  constructor(defaults: StuffingConfig, redis?: Redis, now: () => number = Date.now) {
    this.log = getLogger("StuffingSettings");
    this.value = defaults;
    this.redis = redis;
    this.now = now;
  }

  public get editable(): boolean {
    return this.redis !== undefined;
  }

  public current(): StuffingConfig {
    return this.value;
  }

  /** Never throws: without Redis, or with an unusable value, the last known values remain. */
  public async refresh(): Promise<void> {
    if (!this.redis || this.now() - this.refreshedAt < StuffingSettings.REFRESH_INTERVAL) {
      return;
    }
    this.refreshedAt = this.now();
    try {
      const stored = await this.redis.get(StuffingSettings.KEY);
      if (stored) {
        this.value = stuffingSchema.parse(JSON.parse(stored));
      }
    } catch (error) {
      this.log.warn('Failed to read the stuffing settings:', error);
    }
  }

  /**
   * @returns The stored values, or null when `input` is not valid.
   * @throws When Redis is unavailable, so that the portal does not report a change that is lost.
   */
  public async save(input: unknown): Promise<StuffingConfig | null> {
    const parsed = stuffingSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    if (!this.redis) {
      throw new Error('Saving the stuffing settings requires Redis');
    }
    await this.redis.set(StuffingSettings.KEY, JSON.stringify(parsed.data));
    this.value = parsed.data;
    this.refreshedAt = this.now();
    return parsed.data;
  }
}

export { StuffingSettings };
