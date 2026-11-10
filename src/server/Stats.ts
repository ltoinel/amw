/**
 * Usage statistics
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * Aggregated counters stored in Redis to feed the administration portal.
 * Privacy: no IP address, user agent or cookie is ever stored, only counts
 * and the URL (without query string) of the pages embedding the widget.
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { Request, Response } from "express";
import type { ChainableCommander, Redis } from "ioredis";
import { estimateCost } from "./LlmPricing";
import { getLogger, Logger } from "../utils/logger";
import { parseQuery, viewQuerySchema } from "./Schemas";
import { BUTTON_LABELS, WIDGET_EFFECTS, WIDGET_THEMES, type ButtonLabel, type WidgetEffect, type WidgetTheme } from "./Settings";

type HitSource = 'cache' | 'amazon' | 'notfound';

interface DailyStats {
  date: string;
  cache: number;
  amazon: number;
  notfound: number;
  /** Cards displayed, reported by the widget. */
  views: number;
  /**
   * Visits of pages with a card in view: one per page and browser tab session, reported by the
   * widget with its first view. Null on days before they were counted.
   */
  visits: number | null;
  clicks: number;
  /** Requests sent to the Creators API, null on days before they were counted and for one site. */
  amazonCalls: number | null;
}

interface ProductStats {
  product: string;
  type: 'id' | 'keyword';
  value: string;
  title?: string;
  image?: string;
  url?: string;
  /** When the cached copy was fetched from Amazon (ISO 8601), absent when the product is not cached. */
  fetchedAt?: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface PageStats {
  url: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface DomainStats {
  domain: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface DomainTrend extends DomainStats {
  daily: { date: string; impressions: number; clicks: number; ctr: number | null }[];
}

interface EffectStats {
  effect: string;
  views: number;
  clicks: number;
  ctr: number;
}

interface ThemeStats {
  theme: string;
  views: number;
  clicks: number;
  ctr: number;
}

interface LabelStats {
  label: string;
  views: number;
  clicks: number;
  ctr: number;
}

type LlmFeature = 'insights' | 'recommendation';

interface LlmUsage {
  feature: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** In US dollars; null when the price of the model is unknown. */
  estimatedCost: number | null;
}

// Sort orders of the pages and products tables
const PAGE_SORTS = ['clicks', 'impressions', 'ctr'] as const;

/** The last `days` days up to today, or the days from `from` to `to` (YYYY-MM-DD, UTC), both included. */
type Period = number | { from: string; to: string };
type PageSort = typeof PAGE_SORTS[number];

interface NotFoundStats {
  product: string;
  type: 'id' | 'keyword';
  value: string;
  /** Undefined when Amazon never returned this product since titles are remembered. */
  title?: string;
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
  referers: { url: string; count: number }[];
}

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/**
 * Collects and reads the usage statistics.
 *
 * Products are identified by their cache key suffix ("id:<ASIN>" or
 * "keyword:<keyword>") so that their title and image can be read back from the
 * product cache without storing them twice.
 */
class Stats {

  public static readonly RETENTION_DAYS: number = 90;

  // Every set fed by request parameters is trimmed, otherwise a client sending
  // random ids could make Redis grow without bound
  private static readonly MAX_PRODUCTS_PER_DAY: number = 1000;
  private static readonly MAX_PAGES_PER_DAY: number = 1000;
  private static readonly MAX_NOT_FOUND: number = 500;
  private static readonly MAX_REFERERS: number = 20;
  private static readonly MAX_REFERER_LENGTH: number = 300;

  private static readonly PREFIX: string = 'amw:stats:';
  // Must match AmwApi's cache key prefix: product details are read from that cache
  private static readonly PRODUCT_CACHE_PREFIX: string = 'amw:product:';
  private static readonly DAY_SECONDS: number = 24 * 3600;
  private static readonly TTL: number = (Stats.RETENTION_DAYS + 1) * Stats.DAY_SECONDS;

  private readonly log: Logger;
  private readonly redis: Redis | undefined;
  private readonly now: () => Date;
  private readonly rankedHosts: () => string[];

  /**
   * @param rankedHosts The sites whose clicks are ranked per product, a function when the portal
   * can change them. A list of known sites, as the host comes from a client-controlled Referer:
   * any host would let a client create keys at will.
   */
  constructor(redis?: Redis, now: () => Date = () => new Date(), rankedHosts: string[] | (() => string[]) = []) {
    this.log = getLogger("Stats");
    this.redis = redis;
    this.now = now;
    this.rankedHosts = typeof rankedHosts === 'function' ? rankedHosts : () => rankedHosts;
  }

  /**
   * Statistics are only available when Redis is configured.
   */
  public get enabled(): boolean {
    return this.redis !== undefined;
  }

  /**
   * Records a /product lookup that reached the server: a technical hit, not a view, since most
   * displays are served by HTTP caches (see recordViews). Never throws and never delays the caller.
   *
   * @param source Where the product came from, or 'notfound'.
   * @param type The lookup type.
   * @param value The product id or keyword.
   * @param referer The Referer header of the request, if any.
   */
  public recordProduct(source: HitSource, type: 'id' | 'keyword', value: string, referer?: string): void {
    this.fireAndForget('recordProduct', redis => {
      const day = this.day(this.now());
      const member = `${type}:${value}`;
      const hitsKey = this.key('hits', day);
      const multi = redis.multi().hincrby(hitsKey, source, 1).expire(hitsKey, Stats.TTL);
      const page = Stats.cleanReferer(referer);
      this.countSite(multi, day, page, source, 1);

      if (source === 'notfound') {
        const countKey = this.key('notfound');
        const lastSeenKey = this.key('notfound', 'lastseen');
        const firstSeenKey = this.key('notfound', 'firstseen');
        multi
          .zincrby(countKey, 1, member)
          .zremrangebyrank(countKey, 0, -(Stats.MAX_NOT_FOUND + 1))
          .expire(countKey, Stats.TTL)
          .zadd(lastSeenKey, this.now().getTime(), member)
          .zremrangebyrank(lastSeenKey, 0, -(Stats.MAX_NOT_FOUND + 1))
          .expire(lastSeenKey, Stats.TTL)
          // NX keeps the start of the absence: the entry is removed when the product is found again
          .zadd(firstSeenKey, 'NX', this.now().getTime(), member)
          // Bounded to the products still counted: trimming by rank would drop the oldest
          // absences, the most useful ones (weight 0 keeps the first-seen scores)
          .zinterstore(firstSeenKey, 2, firstSeenKey, countKey, 'WEIGHTS', 1, 0)
          .expire(firstSeenKey, Stats.TTL);

        if (page) {
          const refererKey = this.key('notfound', 'referers', member);
          multi
            .zincrby(refererKey, 1, page)
            .zremrangebyrank(refererKey, 0, -(Stats.MAX_REFERERS + 1))
            .expire(refererKey, Stats.TTL);
        }
      } else if (source === 'amazon') {
        // A product that is found again (e.g. back in the catalogue) no longer needs replacing
        multi
          .zrem(this.key('notfound'), member)
          .zrem(this.key('notfound', 'lastseen'), member)
          .zrem(this.key('notfound', 'firstseen'), member)
          .del(this.key('notfound', 'referers', member));
      }

      return multi;
    });
  }

  /**
   * Records a request sent to the Creators API, whatever its answer: each one uses the daily
   * quota. Never throws and never delays the caller.
   */
  public recordAmazonCall(): void {
    this.fireAndForget('recordAmazonCall', redis => {
      const day = this.day(this.now());
      const hitsKey = this.key('hits', day);
      return redis.multi()
        .hincrby(hitsKey, 'amazonCalls', 1)
        .expire(hitsKey, Stats.TTL)
        // Kept without expiry: it tells a day without calls (0) from a day before the counter (no data)
        .set(this.key('amazon-calls', 'since'), day, 'NX');
    });
  }

  /**
   * Remembers the title Amazon gave a product: once it is missing, Amazon can no longer tell and
   * its cache entry eventually expires, while the operator still has to know what it was.
   */
  public rememberTitle(type: 'id' | 'keyword', value: string, title: string): void {
    this.fireAndForget('rememberTitle', redis => {
      const key = this.key('titles');
      return redis.multi().hset(key, `${type}:${value}`, title).expire(key, Stats.TTL);
    });
  }

  /**
   * Records the cards displayed by a page, from the widget's view beacon.
   *
   * @param asins One ASIN per card shown (validated by the caller), repeats included.
   * @param referer The Referer header of the beacon: the page embedding the widget.
   * @param effect The appearance effect of these cards, when effects are on.
   * @param theme The theme of these cards, when themes are compared.
   */
  /** @param visit The first views of the page in this tab session: they count a visit too. */
  public recordViews(asins: string[], referer?: string, effect?: WidgetEffect, theme?: WidgetTheme, label?: ButtonLabel, visit = false): void {
    this.fireAndForget('recordViews', redis => {
      const day = this.day(this.now());
      const hitsKey = this.key('hits', day);
      const impressionsKey = this.key('impressions', day);
      const multi = redis.multi().hincrby(hitsKey, 'views', asins.length).expire(hitsKey, Stats.TTL);
      if (visit) multi.hincrby(hitsKey, 'visits', 1);

      asins.forEach(asin => multi.zincrby(impressionsKey, 1, `id:${asin}`));
      multi
        .zremrangebyrank(impressionsKey, 0, -(Stats.MAX_PRODUCTS_PER_DAY + 1))
        .expire(impressionsKey, Stats.TTL);

      const page = Stats.cleanReferer(referer);
      if (page) {
        this.incrementPage(multi, 'impressions', day, page, asins.length);
      }
      const site = this.countSite(multi, day, page, 'views', asins.length);
      if (visit && site) multi.hincrby(this.key('site-hits', site, day), 'visits', 1);
      this.countVariant(multi, day, 'effects', effect, 'views', asins.length, site);
      this.countVariant(multi, day, 'themes', theme, 'views', asins.length, site);
      this.countVariant(multi, day, 'labels', label, 'views', asins.length, site);
      if (site) {
        const siteKey = this.key('site-impressions', site, day);
        asins.forEach(asin => multi.zincrby(siteKey, 1, `id:${asin}`));
        multi
          .zremrangebyrank(siteKey, 0, -(Stats.MAX_PRODUCTS_PER_DAY + 1))
          .expire(siteKey, Stats.TTL);
      }
      return multi;
    });
  }

  /**
   * Records the tokens of a Claude API call, whatever became of its answer: a refused or
   * unusable answer is billed too. Never throws and never delays the caller.
   *
   * @param model The model that answered, which may be a fallback of the requested one.
   */
  public recordLlmUsage(feature: LlmFeature, model: string, usage: { input_tokens: number; output_tokens: number }): void {
    this.fireAndForget('recordLlmUsage', redis => {
      const key = this.key('llm', this.day(this.now()));
      const field = (metric: string) => `${feature}|${model}|${metric}`;
      return redis.multi()
        .hincrby(key, field('calls'), 1)
        .hincrby(key, field('input'), usage.input_tokens)
        .hincrby(key, field('output'), usage.output_tokens)
        .expire(key, Stats.TTL);
    });
  }

  /**
   * Records a click on the affiliate link of a product widget.
   *
   * @param asin The product ASIN (validated by the caller).
   * @param referer The Referer header of the beacon: the page embedding the widget.
   */
  public recordClick(asin: string, referer?: string, effect?: WidgetEffect, theme?: WidgetTheme, label?: ButtonLabel): void {
    this.fireAndForget('recordClick', redis => {
      const day = this.day(this.now());
      const hitsKey = this.key('hits', day);
      const clicksKey = this.key('clicks', day);
      const multi = redis.multi()
        .hincrby(hitsKey, 'clicks', 1)
        .expire(hitsKey, Stats.TTL)
        .zincrby(clicksKey, 1, `id:${asin}`)
        .zremrangebyrank(clicksKey, 0, -(Stats.MAX_PRODUCTS_PER_DAY + 1))
        .expire(clicksKey, Stats.TTL);

      const page = Stats.cleanReferer(referer);
      let host: string | undefined;
      if (page) {
        this.incrementPage(multi, 'clicks', day, page);
        host = this.countSite(multi, day, page, 'clicks', 1);
        if (host) {
          const siteKey = this.key('site-clicks', host, day);
          multi
            .zincrby(siteKey, 1, asin)
            .zremrangebyrank(siteKey, 0, -(Stats.MAX_PRODUCTS_PER_DAY + 1))
            .expire(siteKey, Stats.TTL);
        }
      }
      this.countVariant(multi, day, 'effects', effect, 'clicks', 1, host);
      this.countVariant(multi, day, 'themes', theme, 'clicks', 1, host);
      this.countVariant(multi, day, 'labels', label, 'clicks', 1, host);
      return multi;
    });
  }

  /**
   * Adds to the daily counters of the site of a page, when it is one of `rankedHosts`.
   * @returns The site counted.
   */
  private countSite(multi: ChainableCommander, day: string, page: string | null, field: HitSource | 'views' | 'clicks', count: number): string | undefined {
    const host = page ? new URL(page).host : undefined;
    if (host === undefined || !this.rankedHosts().includes(host)) {
      return undefined;
    }
    const key = this.key('site-hits', host, day);
    multi.hincrby(key, field, count).expire(key, Stats.TTL);
    return host;
  }

  /**
   * ASINs most clicked from the pages of a site over the last days, best first.
   * @param host A host of `rankedHosts`; any other has no data.
   */
  public async getMostClickedProducts(host: string, days: number, limit: number): Promise<string[]> {
    const pipeline = this.requireClient().pipeline();
    this.lastDays(days).forEach(date => pipeline.zrange(this.key('site-clicks', host, date), '0', '-1', 'WITHSCORES'));
    const totals = Stats.sumScores(await this.execOrThrow(pipeline.exec()));
    return [...totals.entries()]
      // The ASIN breaks ties, so that pages do not change product between two requests
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([asin]) => asin);
  }

  /**
   * Daily counters, oldest day first.
   * @param site Only those of this site of `rankedHosts`, counted since sites have their own.
   */
  public async getDaily(days: Period, site?: string): Promise<DailyStats[]> {
    const redis = this.requireClient();
    const dates = this.lastDays(days);
    const pipeline = redis.pipeline();
    dates.forEach(date => pipeline.hgetall(site ? this.key('site-hits', site, date) : this.key('hits', date)));
    pipeline.get(this.key('amazon-calls', 'since'));
    const results = await this.execOrThrow(pipeline.exec());
    const callsSince = results[dates.length] as string | null;

    return dates.map((date, i) => {
      const hits = (results[i] || {}) as Record<string, string>;
      const cache = Number(hits.cache) || 0;
      const amazon = Number(hits.amazon) || 0;
      return {
        date,
        cache,
        amazon,
        notfound: Number(hits.notfound) || 0,
        // Days recorded before the view beacon counted one view per product served
        views: hits.views === undefined ? cache + amazon : Number(hits.views) || 0,
        clicks: Number(hits.clicks) || 0,
        // The widget reports them since this version: a day with views but none came before
        visits: hits.visits === undefined ? null : Number(hits.visits) || 0,
        // Shared by every site: no share of it belongs to one. ISO dates compare as strings
        amazonCalls: !site && callsSince !== null && date >= callsSince ? Number(hits.amazonCalls) || 0 : null
      };
    });
  }

  /**
   * Claude API usage over the last days per feature and model, most expensive first.
   */
  public async getLlmUsage(days: Period): Promise<LlmUsage[]> {
    const redis = this.requireClient();
    const pipeline = redis.pipeline();
    this.lastDays(days).forEach(date => pipeline.hgetall(this.key('llm', date)));
    const results = await this.execOrThrow(pipeline.exec());

    const rows = new Map<string, { feature: string; model: string; calls: number; input: number; output: number }>();
    for (const hash of results) {
      for (const [field, value] of Object.entries((hash || {}) as Record<string, string>)) {
        const [feature, model, metric] = field.split('|');
        const row = rows.get(`${feature}|${model}`) ?? { feature, model, calls: 0, input: 0, output: 0 };
        if (metric === 'calls' || metric === 'input' || metric === 'output') {
          row[metric] += Number(value) || 0;
        }
        rows.set(`${feature}|${model}`, row);
      }
    }

    return Array.from(rows.values())
      .map(({ feature, model, calls, input, output }) => ({
        feature,
        model,
        calls,
        inputTokens: input,
        outputTokens: output,
        estimatedCost: estimateCost(model, input, output)
      }))
      .sort((a, b) => (b.estimatedCost ?? 0) - (a.estimatedCost ?? 0));
  }

  /**
   * Views and clicks per appearance effect over the last days, the control group ("none") first.
   */
  public async getEffects(days: Period, site?: string): Promise<EffectStats[]> {
    const totals = await this.variantTotals('effects', WIDGET_EFFECTS, days, site);
    return totals.map(({ name, ...figures }) => ({ effect: name, ...figures }));
  }

  /** Views and clicks per theme over the last days, from the sessions of a theme A/B test. */
  public async getThemes(days: Period, site?: string): Promise<ThemeStats[]> {
    const totals = await this.variantTotals('themes', WIDGET_THEMES, days, site);
    return totals.map(({ name, ...figures }) => ({ theme: name, ...figures }));
  }

  /** Views and clicks per button label, from the sessions of a label A/B test. */
  public async getLabels(days: Period, site?: string): Promise<LabelStats[]> {
    const totals = await this.variantTotals('labels', BUTTON_LABELS, days, site);
    return totals.map(({ name, ...figures }) => ({ label: name, ...figures }));
  }

  /** In the order of `known`, which also drops fields that are not a known name. */
  /** @param site Only the views and clicks of this site of `rankedHosts`, counted since 5.5. */
  private async variantTotals(kind: 'effects' | 'themes' | 'labels', known: readonly string[], days: Period, site?: string) {
    const redis = this.requireClient();
    const pipeline = redis.pipeline();
    this.lastDays(days).forEach(date => pipeline.hgetall(site ? this.key(`${kind}-site`, site, date) : this.key(kind, date)));
    const results = await this.execOrThrow(pipeline.exec());

    const totals = new Map<string, { views: number; clicks: number }>();
    for (const hash of results) {
      for (const [field, value] of Object.entries((hash || {}) as Record<string, string>)) {
        const [name, metric] = field.split('|');
        const total = totals.get(name) ?? { views: 0, clicks: 0 };
        if (metric === 'views' || metric === 'clicks') {
          total[metric] += Number(value) || 0;
        }
        totals.set(name, total);
      }
    }
    return known.filter(name => totals.has(name)).map(name => {
      const { views, clicks } = totals.get(name) as { views: number; clicks: number };
      return { name, views, clicks, ctr: views > 0 ? clicks / views : 0 };
    });
  }


  /**
   * Products displayed over the last days with their clicks and click-through rate, best first
   * on the sort metric (most displayed by default). Sorted before the limit: a CTR ranking
   * covers every product, not only the most displayed ones.
   * @param site Only the displays and clicks of this site of `rankedHosts`.
   */
  public async getTopProducts(days: Period, limit: number, site?: string, sort: PageSort = 'impressions'): Promise<ProductStats[]> {
    const redis = this.requireClient();
    const dates = this.lastDays(days);

    // Summed in Node rather than with ZUNIONSTORE: the sets are bounded and it
    // avoids temporary keys
    const pipeline = redis.pipeline();
    dates.forEach(date => pipeline.zrange(this.impressionsKey(date, site), '0', '-1', 'WITHSCORES'));
    dates.forEach(date => pipeline.zrange(site ? this.key('site-clicks', site, date) : this.key('clicks', date), '0', '-1', 'WITHSCORES'));
    const results = await this.execOrThrow(pipeline.exec());

    const impressions = Stats.sumScores(results.slice(0, dates.length));
    const siteClicks = Stats.sumScores(results.slice(dates.length));
    // The clicks of a site are kept by bare ASIN, for the fallback of the recommendations
    const clicks = site ? new Map([...siteClicks].map(([asin, count]) => [`id:${asin}`, count])) : siteClicks;

    const top = [...impressions.entries()]
      .map(([member, count]) => {
        const clickCount = clicks.get(member) || 0;
        return { member, impressions: count, clicks: clickCount, ctr: count > 0 ? clickCount / count : 0 };
      })
      .sort(Stats.ranking(sort, product => product.member))
      .slice(0, limit);

    const cached = top.length > 0
      ? await redis.mget(...top.map(({ member }) => Stats.PRODUCT_CACHE_PREFIX + member))
      : [];

    return top.map(({ member, ...totals }, i) => ({
      ...Stats.splitMember(member),
      ...Stats.productInfo(cached[i]),
      ...totals
    }));
  }

  /**
   * Distinct products displayed over the last days. Each day keeps only its 1000 most displayed
   * products, so beyond that the count is a lower bound.
   */
  public async countProducts(days: Period, site?: string): Promise<number> {
    const pipeline = this.requireClient().pipeline();
    this.lastDays(days).forEach(date => pipeline.zrange(this.impressionsKey(date, site), '0', '-1'));
    const members = (await this.execOrThrow(pipeline.exec())).flatMap(reply => (Array.isArray(reply) ? reply as string[] : []));
    return new Set(members).size;
  }

  private impressionsKey(date: string, site?: string): string {
    return site ? this.key('site-impressions', site, date) : this.key('impressions', date);
  }

  /**
   * Pages embedding the widget over the last days with their click-through rate,
   * best first on the sort metric (see ranking()).
   * @param domain Only the pages of this hostname, or of this host when it has a port.
   */
  public async getTopPages(days: Period, limit: number, sort: PageSort = 'clicks', domain?: string): Promise<PageStats[]> {
    const pages = await this.pageTotals(days);
    // Filtered before the limit: the top pages of the site, not the site's share of the global top
    return pages
      .filter(page => !domain || Stats.hostname(page.url) === domain || Stats.host(page.url) === domain)
      .sort(Stats.ranking(sort, page => page.url))
      .slice(0, limit);
  }

  /**
   * Best first on the sort metric. The other metrics break ties so that the order is stable
   * and a 100 % CTR on more clicks comes before a 100 % CTR on a single view.
   * @param key Unique per row, last tie-breaker.
   */
  private static ranking<T extends { impressions: number; clicks: number; ctr: number }>(sort: PageSort, key: (row: T) => string) {
    return (a: T, b: T): number => {
      const byClicks = b.clicks - a.clicks;
      const byImpressions = b.impressions - a.impressions;
      const byKey = key(a) < key(b) ? -1 : 1;
      if (sort === 'impressions') return byImpressions || byClicks || byKey;
      if (sort === 'ctr') return b.ctr - a.ctr || byClicks || byImpressions || byKey;
      return byClicks || byImpressions || byKey;
    };
  }

  /**
   * Sites embedding the widget over the last days, most viewed first.
   */
  public async getDomains(days: Period): Promise<DomainStats[]> {
    return (await this.getDomainTrends(days)).map(({ daily: _daily, ...totals }) => totals);
  }

  /**
   * Most viewed sites over the last days with their statistics per day. The daily
   * CTR is null on days without views: a 0 % there would read as a drop.
   */
  public async getDomainTrends(days: Period, limit: number = Infinity): Promise<DomainTrend[]> {
    const { dates, impressions, clicks } = await this.pageScores(days);
    const views = impressions.map(Stats.sumByDomain);
    const hits = clicks.map(Stats.sumByDomain);
    const sum = (perDay: Map<string, number>[], domain: string) => perDay.reduce((total, day) => total + (day.get(domain) || 0), 0);
    const domains = new Set([...views, ...hits].flatMap(day => [...day.keys()]));

    return [...domains]
      .map(domain => {
        const viewCount = sum(views, domain);
        const clickCount = sum(hits, domain);
        return {
          domain,
          impressions: viewCount,
          clicks: clickCount,
          ctr: viewCount > 0 ? clickCount / viewCount : 0,
          daily: dates.map((date, i) => {
            const dayViews = views[i].get(domain) || 0;
            const dayClicks = hits[i].get(domain) || 0;
            return { date, impressions: dayViews, clicks: dayClicks, ctr: dayViews > 0 ? dayClicks / dayViews : null };
          })
        };
      })
      .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || (a.domain < b.domain ? -1 : 1))
      .slice(0, limit);
  }

  private async pageTotals(days: Period): Promise<PageStats[]> {
    const { impressions: impressionReplies, clicks: clickReplies } = await this.pageScores(days);
    const impressions = Stats.sumScores(impressionReplies);
    const clicks = Stats.sumScores(clickReplies);

    // A page may only have clicks, e.g. when a blocker dropped its view beacons
    const urls = new Set([...impressions.keys(), ...clicks.keys()]);
    return [...urls].map(url => {
      const viewCount = impressions.get(url) || 0;
      const clickCount = clicks.get(url) || 0;
      return { url, impressions: viewCount, clicks: clickCount, ctr: viewCount > 0 ? clickCount / viewCount : 0 };
    });
  }

  // The raw daily page sets, oldest day first
  private async pageScores(days: Period): Promise<{ dates: string[]; impressions: unknown[]; clicks: unknown[] }> {
    const redis = this.requireClient();
    const dates = this.lastDays(days);

    const pipeline = redis.pipeline();
    dates.forEach(date => pipeline.zrange(this.key('pages', 'impressions', date), '0', '-1', 'WITHSCORES'));
    dates.forEach(date => pipeline.zrange(this.key('pages', 'clicks', date), '0', '-1', 'WITHSCORES'));
    const results = await this.execOrThrow(pipeline.exec());
    return { dates, impressions: results.slice(0, dates.length), clicks: results.slice(dates.length) };
  }

  private static sumByDomain(reply: unknown): Map<string, number> {
    const totals = new Map<string, number>();
    Stats.toPairs(reply).forEach(([url, score]) => {
      const domain = Stats.hostname(url);
      if (domain) totals.set(domain, (totals.get(domain) || 0) + score);
    });
    return totals;
  }

  private static host(url: string): string | undefined {
    try {
      return new URL(url).host;
    } catch {
      return undefined;
    }
  }

  private static hostname(url: string): string | undefined {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }

  /**
   * Stores a generated report (e.g. AI insights), kept as long as the statistics it
   * was made from.
   */
  public async saveReport(name: string, report: unknown): Promise<void> {
    await this.requireClient().set(this.key('report', name), JSON.stringify(report), 'EX', Stats.TTL);
  }

  public async loadReport<T>(name: string): Promise<T | null> {
    const stored = await this.requireClient().get(this.key('report', name));
    return stored ? JSON.parse(stored) as T : null;
  }

  /**
   * Products that Amazon no longer returns, most requested first.
   * @param site Only those still embedded in a page of this host.
   * @param period Only those still requested during the period: the counts stay those since the
   *   product was first seen, as they are not kept per day.
   */
  public async getNotFound(limit: number, site?: string, period?: Period): Promise<NotFoundStats[]> {
    const products = await this.notFoundProducts(site || period !== undefined ? Stats.MAX_NOT_FOUND : limit);
    const dates = period === undefined ? [] : this.lastDays(period);
    const [first, last] = [dates[0], dates[dates.length - 1]];
    return products
      .filter(product => !site || product.referers.some(referer => Stats.host(referer.url) === site))
      // A product seen before the last lookup was kept has no date: it is older than any period
      .filter(product => period === undefined || (product.lastSeen !== null && product.lastSeen.slice(0, 10) >= first && product.lastSeen.slice(0, 10) <= last))
      .slice(0, limit);
  }

  private async notFoundProducts(limit: number): Promise<NotFoundStats[]> {
    const redis = this.requireClient();
    const members = Stats.toPairs(await redis.zrevrange(this.key('notfound'), 0, limit - 1, 'WITHSCORES'));
    if (members.length === 0) return [];

    const pipeline = redis.pipeline();
    members.forEach(([member]) => {
      pipeline.zscore(this.key('notfound', 'lastseen'), member);
      pipeline.zscore(this.key('notfound', 'firstseen'), member);
      pipeline.zrevrange(this.key('notfound', 'referers', member), 0, Stats.MAX_REFERERS - 1, 'WITHSCORES');
      pipeline.hget(this.key('titles'), member);
      // Products seen before titles were remembered may still be in the cache
      pipeline.get(Stats.PRODUCT_CACHE_PREFIX + member);
    });
    const results = await this.execOrThrow(pipeline.exec());

    return members.map(([member, count], i) => {
      const [lastSeen, firstSeen, referers, title, cached] = results.slice(i * 5, i * 5 + 5);
      return {
        ...Stats.splitMember(member),
        title: (title as string | null) ?? Stats.productInfo(cached as string | null).title,
        count,
        // Null for the entries recorded before the first failed lookup was kept
        firstSeen: Stats.isoDate(firstSeen),
        lastSeen: Stats.isoDate(lastSeen),
        referers: Stats.toPairs(referers).map(([url, pageCount]) => ({ url, count: pageCount }))
      };
    });
  }

  /**
   * Keeps only the page URL: query strings and fragments may carry personal or
   * session data, and other schemes are not pages.
   */
  public static cleanReferer(referer?: string): string | null {
    if (!referer) return null;
    try {
      const url = new URL(referer);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return `${url.origin}${url.pathname}`.slice(0, Stats.MAX_REFERER_LENGTH);
    } catch {
      return null;
    }
  }

  public static isAsin(value: unknown): value is string {
    return typeof value === 'string' && ASIN_PATTERN.test(value);
  }

  // Commands queued while Redis is down would pile up in memory and resolve
  // late, so collection is skipped until the connection is ready
  private readyClient(): Redis | undefined {
    return this.redis && this.redis.status === 'ready' ? this.redis : undefined;
  }

  private requireClient(): Redis {
    if (!this.redis) {
      throw new Error('Statistics require Redis');
    }
    return this.redis;
  }

  /**
   * Runs a write without awaiting it. Synchronous errors are caught too: the
   * caller has usually already answered the request.
   */
  private fireAndForget(operation: string, build: (redis: Redis) => ChainableCommander): void {
    const redis = this.readyClient();
    if (!redis) return;

    const fail = (error: unknown) => this.log.debug(`Stats ${operation} failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      build(redis).exec().catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  private async execOrThrow(promise: Promise<[Error | null, unknown][] | null>): Promise<unknown[]> {
    const results = (await promise) || [];
    return results.map(([error, value]) => {
      if (error) throw error;
      return value;
    });
  }

  // The Referer is client-controlled: the set is trimmed like the product sets
  private incrementPage(multi: ChainableCommander, metric: 'impressions' | 'clicks', day: string, page: string, count: number = 1): void {
    const key = this.key('pages', metric, day);
    multi
      .zincrby(key, count, page)
      .zremrangebyrank(key, 0, -(Stats.MAX_PAGES_PER_DAY + 1))
      .expire(key, Stats.TTL);
  }

  /** Every site's counter, and the counter of the site when it is one of `rankedHosts`. */
  private countVariant(multi: ChainableCommander, day: string, kind: 'effects' | 'themes' | 'labels', name: string | undefined, metric: 'views' | 'clicks', count: number, site?: string): void {
    if (name) {
      for (const key of [this.key(kind, day), ...(site ? [this.key(`${kind}-site`, site, day)] : [])]) {
        multi.hincrby(key, `${name}|${metric}`, count).expire(key, Stats.TTL);
      }
    }
  }


  private key(...parts: string[]): string {
    return Stats.PREFIX + parts.join(':');
  }

  // UTC keeps day boundaries stable whatever the server timezone
  private day(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private lastDays(period: Period): string[] {
    if (typeof period !== 'number') {
      // Checked by the caller: real dates, in order, within the retention
      const dates: string[] = [];
      for (let time = Date.parse(`${period.from}T00:00:00Z`); time <= Date.parse(`${period.to}T00:00:00Z`); time += Stats.DAY_SECONDS * 1000) {
        dates.push(this.day(new Date(time)));
      }
      return dates.slice(-Stats.RETENTION_DAYS);
    }
    const days = period;
    const count = Math.min(Math.max(Math.floor(days) || 1, 1), Stats.RETENTION_DAYS);
    const today = this.now().getTime();
    const dates: string[] = [];
    for (let i = count - 1; i >= 0; i--) {
      dates.push(this.day(new Date(today - i * Stats.DAY_SECONDS * 1000)));
    }
    return dates;
  }

  private static sumScores(replies: unknown[]): Map<string, number> {
    const totals = new Map<string, number>();
    replies.forEach(reply => {
      Stats.toPairs(reply).forEach(([member, score]) => totals.set(member, (totals.get(member) || 0) + score));
    });
    return totals;
  }

  /**
   * WITHSCORES replies are flat [member, score, ...] arrays over RESP2, but
   * [member, score] pairs over RESP3 (the ioredis 6 default), depending on the
   * client's reply mode: both shapes are accepted.
   */
  private static isoDate(score: unknown): string | null {
    return score ? new Date(Number(score)).toISOString() : null;
  }

  private static toPairs(reply: unknown): [string, number][] {
    if (!Array.isArray(reply)) return [];
    if (reply.length > 0 && Array.isArray(reply[0])) {
      return reply.map(([member, score]) => [String(member), Number(score)]);
    }
    const pairs: [string, number][] = [];
    for (let i = 0; i < reply.length; i += 2) {
      pairs.push([String(reply[i]), Number(reply[i + 1])]);
    }
    return pairs;
  }

  private static splitMember(member: string): { product: string; type: 'id' | 'keyword'; value: string } {
    const separator = member.indexOf(':');
    const type = member.slice(0, separator) === 'keyword' ? 'keyword' : 'id';
    return { product: member, type, value: member.slice(separator + 1) };
  }

  private static productInfo(json: string | null | undefined): { title?: string; image?: string; url?: string; fetchedAt?: string } {
    if (!json) return {};
    try {
      const product = JSON.parse(json);
      // Copies cached by older versions may have no usable timestamp
      const fetched = typeof product.timestamp === 'number' ? new Date(product.timestamp) : undefined;
      const fetchedAt = fetched && !Number.isNaN(fetched.getTime()) ? { fetchedAt: fetched.toISOString() } : {};
      return { title: product.title, image: product.image, url: product.url, ...fetchedAt };
    } catch {
      return {};
    }
  }
}

/**
 * Marks a response as not cacheable. The global express-cache-controller
 * middleware rewrites Cache-Control when headers are sent, so its options are
 * emptied for the header set here to survive.
 */
function noStore(res: Response): void {
  (res as Response & { cacheControl?: object }).cacheControl = {};
  res.set('Cache-Control', 'no-store');
}

/**
 * Handler of the click beacon sent by the widget when its affiliate link is followed.
 * It always answers 204 when the ASIN is valid, even when statistics are
 * disabled, so the widget never has to care.
 */
/** From the query string: only a known effect may become a counter, anything else is ignored. */
function effectOf(value: unknown): WidgetEffect | undefined {
  return WIDGET_EFFECTS.find(effect => effect === value);
}

/** Same as effectOf(), for the theme of an A/B test. */
function themeOf(value: unknown): WidgetTheme | undefined {
  return WIDGET_THEMES.find(theme => theme === value);
}

/** Same as effectOf(), for the button label of an A/B test. */
function labelOf(value: unknown): ButtonLabel | undefined {
  return BUTTON_LABELS.find(label => label === value);
}

function createClickHandler(stats: Stats) {
  return (req: Request, res: Response): void => {
    const id = req.query.id;
    noStore(res);

    if (!Stats.isAsin(id)) {
      res.status(400).json({
        error: "Validation Error",
        message: "Parameter id must be an ASIN",
        timestamp: new Date().toISOString()
      });
      return;
    }

    stats.recordClick(id, req.get('referer'), effectOf(req.query.effect), themeOf(req.query.theme), labelOf(req.query.label));
    res.status(204).end();
  };
}

/**
 * Handler of the view beacon sent by the widget once its cards are displayed. Like the click
 * beacon, it answers 204 for valid ids even when statistics are disabled.
 */
function createViewHandler(stats: Stats) {
  return (req: Request, res: Response): void => {
    noStore(res);

    const ids = parseQuery(viewQuerySchema, req.query);
    if (!ids.success) {
      res.status(400).json({
        error: "Validation Error",
        message: ids.message,
        timestamp: new Date().toISOString()
      });
      return;
    }

    stats.recordViews(ids.data, req.get('referer'), effectOf(req.query.effect), themeOf(req.query.theme), labelOf(req.query.label), req.query.visit === '1');
    res.status(204).end();
  };
}

export { Stats, createClickHandler, createViewHandler, noStore, PAGE_SORTS };
export type { Period, EffectStats, ThemeStats, LabelStats, LlmFeature, LlmUsage, HitSource, DailyStats, ProductStats, PageStats, PageSort, DomainStats, DomainTrend, NotFoundStats };
