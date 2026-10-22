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
import { getLogger, Logger } from "../utils/logger";

type HitSource = 'cache' | 'amazon' | 'notfound';

interface DailyStats {
  date: string;
  cache: number;
  amazon: number;
  notfound: number;
  clicks: number;
}

interface ProductStats {
  product: string;
  type: 'id' | 'keyword';
  value: string;
  title?: string;
  image?: string;
  url?: string;
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

interface NotFoundStats {
  product: string;
  type: 'id' | 'keyword';
  value: string;
  count: number;
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

  constructor(redis?: Redis, now: () => Date = () => new Date()) {
    this.log = getLogger("Stats");
    this.redis = redis;
    this.now = now;
  }

  /**
   * Statistics are only available when Redis is configured.
   */
  public get enabled(): boolean {
    return this.redis !== undefined;
  }

  /**
   * Records a /product lookup. Never throws and never delays the caller.
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

      if (source === 'notfound') {
        const countKey = this.key('notfound');
        const lastSeenKey = this.key('notfound', 'lastseen');
        multi
          .zincrby(countKey, 1, member)
          .zremrangebyrank(countKey, 0, -(Stats.MAX_NOT_FOUND + 1))
          .expire(countKey, Stats.TTL)
          .zadd(lastSeenKey, this.now().getTime(), member)
          .zremrangebyrank(lastSeenKey, 0, -(Stats.MAX_NOT_FOUND + 1))
          .expire(lastSeenKey, Stats.TTL);

        if (page) {
          const refererKey = this.key('notfound', 'referers', member);
          multi
            .zincrby(refererKey, 1, page)
            .zremrangebyrank(refererKey, 0, -(Stats.MAX_REFERERS + 1))
            .expire(refererKey, Stats.TTL);
        }
      } else {
        const impressionsKey = this.key('impressions', day);
        multi
          .zincrby(impressionsKey, 1, member)
          .zremrangebyrank(impressionsKey, 0, -(Stats.MAX_PRODUCTS_PER_DAY + 1))
          .expire(impressionsKey, Stats.TTL);

        // Same unit as the product impressions: one per product served to the page
        if (page) {
          this.incrementPage(multi, 'impressions', day, page);
        }

        // A product that is found again (e.g. back in the catalogue) no longer needs replacing
        if (source === 'amazon') {
          multi
            .zrem(this.key('notfound'), member)
            .zrem(this.key('notfound', 'lastseen'), member)
            .del(this.key('notfound', 'referers', member));
        }
      }

      return multi;
    });
  }

  /**
   * Records a click on the affiliate link of a product widget.
   *
   * @param asin The product ASIN (validated by the caller).
   * @param referer The Referer header of the beacon: the page embedding the widget.
   */
  public recordClick(asin: string, referer?: string): void {
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
      if (page) {
        this.incrementPage(multi, 'clicks', day, page);
      }
      return multi;
    });
  }

  /**
   * Daily counters, oldest day first.
   */
  public async getDaily(days: number): Promise<DailyStats[]> {
    const redis = this.requireClient();
    const dates = this.lastDays(days);
    const pipeline = redis.pipeline();
    dates.forEach(date => pipeline.hgetall(this.key('hits', date)));
    const results = await this.execOrThrow(pipeline.exec());

    return dates.map((date, i) => {
      const hits = (results[i] || {}) as Record<string, string>;
      return {
        date,
        cache: Number(hits.cache) || 0,
        amazon: Number(hits.amazon) || 0,
        notfound: Number(hits.notfound) || 0,
        clicks: Number(hits.clicks) || 0
      };
    });
  }

  /**
   * Most displayed products over the last days, with their clicks and click-through rate.
   */
  public async getTopProducts(days: number, limit: number): Promise<ProductStats[]> {
    const redis = this.requireClient();
    const dates = this.lastDays(days);

    // Summed in Node rather than with ZUNIONSTORE: the sets are bounded and it
    // avoids temporary keys
    const pipeline = redis.pipeline();
    dates.forEach(date => pipeline.zrange(this.key('impressions', date), '0', '-1', 'WITHSCORES'));
    dates.forEach(date => pipeline.zrange(this.key('clicks', date), '0', '-1', 'WITHSCORES'));
    const results = await this.execOrThrow(pipeline.exec());

    const impressions = Stats.sumScores(results.slice(0, dates.length));
    const clicks = Stats.sumScores(results.slice(dates.length));

    const top = [...impressions.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    const cached = top.length > 0
      ? await redis.mget(...top.map(([member]) => Stats.PRODUCT_CACHE_PREFIX + member))
      : [];

    return top.map(([member, count], i) => {
      const clickCount = clicks.get(member) || 0;
      return {
        ...Stats.splitMember(member),
        ...Stats.productInfo(cached[i]),
        impressions: count,
        clicks: clickCount,
        ctr: count > 0 ? clickCount / count : 0
      };
    });
  }

  /**
   * Pages embedding the widget with the most clicks over the last days (then the
   * most impressions), with their click-through rate.
   */
  public async getTopPages(days: number, limit: number): Promise<PageStats[]> {
    const redis = this.requireClient();
    const dates = this.lastDays(days);

    const pipeline = redis.pipeline();
    dates.forEach(date => pipeline.zrange(this.key('pages', 'impressions', date), '0', '-1', 'WITHSCORES'));
    dates.forEach(date => pipeline.zrange(this.key('pages', 'clicks', date), '0', '-1', 'WITHSCORES'));
    const results = await this.execOrThrow(pipeline.exec());

    const impressions = Stats.sumScores(results.slice(0, dates.length));
    const clicks = Stats.sumScores(results.slice(dates.length));

    // A page may only have clicks, e.g. when its impressions were served by an HTTP cache
    const urls = new Set([...impressions.keys(), ...clicks.keys()]);
    return [...urls]
      .map(url => {
        const viewCount = impressions.get(url) || 0;
        const clickCount = clicks.get(url) || 0;
        return { url, impressions: viewCount, clicks: clickCount, ctr: viewCount > 0 ? clickCount / viewCount : 0 };
      })
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || (a.url < b.url ? -1 : 1))
      .slice(0, limit);
  }

  /**
   * Products that Amazon no longer returns, most requested first.
   */
  public async getNotFound(limit: number): Promise<NotFoundStats[]> {
    const redis = this.requireClient();
    const members = Stats.toPairs(await redis.zrevrange(this.key('notfound'), 0, limit - 1, 'WITHSCORES'));
    if (members.length === 0) return [];

    const pipeline = redis.pipeline();
    members.forEach(([member]) => {
      pipeline.zscore(this.key('notfound', 'lastseen'), member);
      pipeline.zrevrange(this.key('notfound', 'referers', member), 0, Stats.MAX_REFERERS - 1, 'WITHSCORES');
    });
    const results = await this.execOrThrow(pipeline.exec());

    return members.map(([member, count], i) => {
      const lastSeen = results[i * 2] as string | number | null;
      return {
        ...Stats.splitMember(member),
        count,
        lastSeen: lastSeen ? new Date(Number(lastSeen)).toISOString() : null,
        referers: Stats.toPairs(results[i * 2 + 1]).map(([url, pageCount]) => ({ url, count: pageCount }))
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
  private incrementPage(multi: ChainableCommander, metric: 'impressions' | 'clicks', day: string, page: string): void {
    const key = this.key('pages', metric, day);
    multi
      .zincrby(key, 1, page)
      .zremrangebyrank(key, 0, -(Stats.MAX_PAGES_PER_DAY + 1))
      .expire(key, Stats.TTL);
  }

  private key(...parts: string[]): string {
    return Stats.PREFIX + parts.join(':');
  }

  // UTC keeps day boundaries stable whatever the server timezone
  private day(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private lastDays(days: number): string[] {
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

  private static productInfo(json: string | null | undefined): { title?: string; image?: string; url?: string } {
    if (!json) return {};
    try {
      const product = JSON.parse(json);
      return { title: product.title, image: product.image, url: product.url };
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

    stats.recordClick(id, req.get('referer'));
    res.status(204).end();
  };
}

export { Stats, createClickHandler, noStore };
export type { HitSource, DailyStats, ProductStats, PageStats, NotFoundStats };
