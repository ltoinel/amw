/**
 * A setting the administration portal can change while the server runs.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import type { z } from "zod";
import { getLogger, Logger } from "../utils/logger";
import type { SettingStore } from "./SettingStore";

/**
 * The configuration files give the default, and the portal's value lives in a store shared by the
 * server processes: Redis, or the file of `Admin.settingsFile` (the container filesystem is
 * read-only elsewhere).
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
    private readonly store?: SettingStore,
    private readonly now: () => number = Date.now
  ) {
    this.log = getLogger("RuntimeSetting");
    this.value = defaults;
  }

  public get editable(): boolean {
    return this.store !== undefined;
  }

  public current(): T {
    return this.value;
  }

  /** Never throws: without a store, or with an unusable value, the last known value remains. */
  public async refresh(): Promise<void> {
    if (!this.store || this.now() - this.refreshedAt < RuntimeSetting.REFRESH_INTERVAL) {
      return;
    }
    this.refreshedAt = this.now();
    try {
      const stored = await this.store.get(this.key);
      if (stored) {
        this.value = this.schema.parse(JSON.parse(stored));
      }
    } catch (error) {
      this.log.warn(`Failed to read ${this.key}:`, error);
    }
  }

  /**
   * @returns The stored value, or null when `input` is not valid.
   * @throws When the store is missing or fails, so that the portal does not report a change that is lost.
   */
  public async save(input: unknown): Promise<T | null> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    if (!this.store) {
      throw new Error(`Saving ${this.key} requires Redis or Admin.settingsFile`);
    }
    await this.store.set(this.key, JSON.stringify(parsed.data));
    this.value = parsed.data;
    this.refreshedAt = this.now();
    return parsed.data;
  }
}

export { RuntimeSetting };
