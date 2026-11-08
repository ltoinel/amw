/**
 * The sites served, edited in the portal: the hosts that may show the widget and get
 * recommendations, with their description, URL and tracking ID.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { z } from "zod";
import { RuntimeSetting } from "./RuntimeSetting";
import type { SettingStore } from "./SettingStore";
import { MAX_STUFFING_SITES, PARTNER_TAG, SITE_HOST } from "./Settings";
import type { PartnerTagSettings } from "./StuffingSettings";

const MAX_DESCRIPTION = 200;
const MAX_URL = 2048;

// The host and the tracking ID reach widget.js; the description and the URL stay in the portal
const siteSchema = z.strictObject({
  host: z.string().regex(SITE_HOST),
  description: z.string().max(MAX_DESCRIPTION).default(''),
  // A link of the portal: another scheme, such as javascript:, would run in the admin's session
  url: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(MAX_URL)]).default(''),
  // Empty: the links carry Amazon.partnerTag
  partnerTag: z.union([z.literal(''), z.string().regex(PARTNER_TAG)]).default(''),
});

const sitesSchema = z.strictObject({
  sites: z.array(siteSchema).max(MAX_STUFFING_SITES)
    .refine(sites => new Set(sites.map(site => site.host)).size === sites.length, 'repeated host'),
});

type Site = z.infer<typeof siteSchema>;
type SitesConfig = z.infer<typeof sitesSchema>;

/** The part of the settings read here. */
interface SiteDefaults {
  server: { allowedSites: string[] };
  recommendation: { allowedHosts: string[] };
}

/**
 * Until the portal saves a list, the sites are those of Server.allowedSites, with the tracking IDs
 * of the former "Tracking ID per site" setting.
 */
class SiteSettings extends RuntimeSetting<SitesConfig> {

  private readonly defaults: SitesConfig;
  // Recommendation.allowedHosts of older configuration files, when Server.allowedSites is empty
  private readonly legacyHosts: string[];

  constructor(settings: SiteDefaults, store?: SettingStore, private readonly legacyTags?: PartnerTagSettings, now?: () => number) {
    const defaults = { sites: settings.server.allowedSites.map(host => ({ host, description: '', url: '', partnerTag: '' })) };
    super('amw:settings:sites', sitesSchema, defaults, store, now);
    this.defaults = defaults;
    this.legacyHosts = settings.server.allowedSites.length === 0 ? settings.recommendation.allowedHosts : [];
  }

  public override async refresh(): Promise<void> {
    await Promise.all([super.refresh(), this.legacyTags?.refresh()]);
  }

  /** Whether the list comes from the portal rather than the configuration files. */
  public get saved(): boolean {
    return this.current() !== this.defaults;
  }

  public get list(): Site[] {
    const { sites } = this.current();
    if (this.saved || !this.legacyTags) {
      return sites;
    }
    const tags = this.legacyTags.current().sites;
    return sites.map(site => ({ ...site, partnerTag: tags[site.host] ?? '' }));
  }

  /** The sites that may show the widget; an empty list allows every site. */
  public get hosts(): string[] {
    return this.current().sites.map(site => site.host);
  }

  /** The sites that may spend Claude credits: never every site. */
  public get recommendationHosts(): string[] {
    const hosts = this.hosts;
    return hosts.length > 0 ? hosts : this.legacyHosts;
  }

  /** The tracking IDs that differ from Amazon.partnerTag, by host. */
  public get partnerTags(): Record<string, string> {
    // Former tracking IDs also served the sites left out of Server.allowedSites, or all when it is empty
    if (!this.saved && this.legacyTags) {
      return { ...this.legacyTags.current().sites };
    }
    return Object.fromEntries(this.list.filter(site => site.partnerTag !== '').map(site => [site.host, site.partnerTag]));
  }
}

export { MAX_DESCRIPTION, SiteSettings };
export type { Site, SitesConfig };
