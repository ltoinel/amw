/**
 * Where the settings changed in the administration portal are kept: Redis, or a JSON file.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { promises as fs } from "node:fs";

/** Values are JSON strings. An ioredis client is one. */
interface SettingStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

/**
 * One JSON object keyed by setting, readable and easy to back up. It survives a Redis flush, and
 * processes sharing the file pick up a change on their next refresh.
 */
class FileSettingStore implements SettingStore {

  // Saves of one process run one after the other, so that none overwrites another's key
  private queue: Promise<unknown> = Promise.resolve();

  /** @param fallback Read for a key the file does not hold yet, so that moving from Redis loses nothing. */
  constructor(private readonly path: string, private readonly fallback?: SettingStore) {}

  public async get(key: string): Promise<string | null> {
    const values = await this.read();
    if (Object.hasOwn(values, key)) {
      return JSON.stringify(values[key]);
    }
    return this.fallback ? this.fallback.get(key) : null;
  }

  public set(key: string, value: string): Promise<void> {
    const write = this.queue.then(async () => {
      // An unreadable file throws here rather than being replaced: it may have been edited by hand
      const values = await this.read();
      values[key] = JSON.parse(value);
      // A crash halfway through leaves the temporary file, never a truncated settings file
      const temporary = `${this.path}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o640 });
      await fs.rename(temporary, this.path);
    });
    this.queue = write.catch(() => undefined);
    return write;
  }

  private async read(): Promise<Record<string, unknown>> {
    let text: string;
    try {
      text = await fs.readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
    const values: unknown = JSON.parse(text);
    if (typeof values !== "object" || values === null || Array.isArray(values)) {
      throw new Error(`${this.path} must hold a JSON object`);
    }
    return values as Record<string, unknown>;
  }
}

export { FileSettingStore };
export type { SettingStore };
