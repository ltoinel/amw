/**
 * The settings of the configuration files that the administration portal may change while the
 * server runs: the theme, caching, rate limits, and pausing the paid AI features.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { z } from "zod";
import { RuntimeSetting } from "./RuntimeSetting";
import type { SettingStore } from "./SettingStore";
import { WIDGET_THEMES, type Settings, type WidgetTheme } from "./Settings";

// The browsers and CDNs may keep a product for a day at most (Amazon rule on prices)
const MAX_HTTP_CACHE = 24 * 60 * 60;
const MAX_RATE_LIMIT = 100000;
const MAX_DAILY_LIMIT = 100000;

/**
 * Only what differs from the configuration files is stored: a setting left out follows the file.
 * Ports, Redis, credentials, secrets, Admin.allowedIps and Server.trustProxy are not here: a
 * mistake could lock the admin out of the portal, or a stolen session open it.
 */
const tunablesSchema = z.strictObject({
  theme: z.enum(WIDGET_THEMES).optional(),
  httpCache: z.number().int().min(0).max(MAX_HTTP_CACHE).optional(),
  rateLimit: z.number().int().min(1).max(MAX_RATE_LIMIT).optional(),
  clickRateLimit: z.number().int().min(1).max(MAX_RATE_LIMIT).optional(),
  viewRateLimit: z.number().int().min(1).max(MAX_RATE_LIMIT).optional(),
  // Pauses only: turning on a feature off in the configuration needs its credentials, checked at startup
  recommendations: z.boolean().optional(),
  dailyLimit: z.number().int().min(1).max(MAX_DAILY_LIMIT).optional(),
  fallback: z.boolean().optional(),
  insights: z.boolean().optional(),
});

type TunablesConfig = z.infer<typeof tunablesSchema>;
type EffectiveTunables = Required<TunablesConfig>;

class Tunables extends RuntimeSetting<TunablesConfig> {

  private readonly defaults: EffectiveTunables;

  constructor(settings: Settings, store?: SettingStore, now?: () => number) {
    super('amw:settings:tunables', tunablesSchema, {}, store, now);
    this.defaults = {
      theme: settings.server.theme,
      httpCache: settings.server.httpCache,
      rateLimit: settings.server.rateLimit,
      clickRateLimit: settings.server.clickRateLimit,
      viewRateLimit: settings.server.viewRateLimit,
      recommendations: settings.recommendation.enabled,
      dailyLimit: settings.recommendation.dailyLimit,
      fallback: settings.recommendation.fallback,
      insights: settings.admin.insights,
    };
  }

  /** The values of the configuration files. */
  public get configured(): EffectiveTunables {
    return { ...this.defaults };
  }

  /** The values in use: the portal's, over the configuration files'. */
  public get effective(): EffectiveTunables {
    const overrides = Object.fromEntries(Object.entries(this.current()).filter(([, value]) => value !== undefined));
    const merged = { ...this.defaults, ...overrides };
    // A feature off in the configuration has no client to turn back on
    merged.recommendations = this.defaults.recommendations && merged.recommendations;
    merged.insights = this.defaults.insights && merged.insights;
    return merged;
  }

  public get theme(): WidgetTheme { return this.effective.theme; }
  public get httpCache(): number { return this.effective.httpCache; }
}

export { MAX_HTTP_CACHE, Tunables };
export type { EffectiveTunables, TunablesConfig };
