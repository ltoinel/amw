/**
 * A setting of the portal that each site can change for itself: a site that never did follows
 * the setting of every site, so that adding the per-site settings changed nothing for visitors.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import type { RuntimeSetting } from "./RuntimeSetting";
import { SITE_HOST } from "./Settings";

class SiteScopedSetting<T> {
  private readonly sites = new Map<string, RuntimeSetting<T>>();

  constructor(public readonly global: RuntimeSetting<T>) {}

  public get editable(): boolean {
    return this.global.editable;
  }

  /**
   * The setting of one site, or of every site without a host.
   * @throws When the host is not a plain host name: it becomes part of a store key.
   */
  public of(host?: string): RuntimeSetting<T> {
    if (!host) return this.global;
    if (!SITE_HOST.test(host)) {
      throw new Error(`Not a site host: ${host}`);
    }
    let setting = this.sites.get(host);
    if (!setting) {
      setting = this.global.scoped(host);
      this.sites.set(host, setting);
    }
    return setting;
  }

  /** The value for a site: its own once saved, the value of every site otherwise. */
  public current(host?: string): T {
    const own = host && SITE_HOST.test(host) ? this.of(host) : undefined;
    return own?.isStored ? own.current() : this.global.current();
  }

  /** Whether the site saved its own value. */
  public isOwn(host: string): boolean {
    return SITE_HOST.test(host) && this.of(host).isStored;
  }

  /** Reads the setting of every site and of these sites (throttled like any setting). */
  public async refresh(hosts: string[] = []): Promise<void> {
    await Promise.all([this.global.refresh(), ...hosts.filter(host => SITE_HOST.test(host)).map(host => this.of(host).refresh())]);
  }
}

export { SiteScopedSetting };
