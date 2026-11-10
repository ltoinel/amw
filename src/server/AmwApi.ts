/**
 * HTTP handlers for the product and widget endpoints.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { Paapi } from "./Paapi";
import { AmazonError } from "./AmazonError";
import { CircuitBreaker, RequestCoalescer, TtlLruCache } from "./Resilience";
import { LookupBatcher } from "./LookupBatcher";
import { SiteScopedSetting } from "./SiteScopedSetting";
import { Recommender, RecommendationError } from "./Recommender";
import { setPublicCache } from "./CacheControl";
import { loadSettings, MAX_PRODUCT_AGE, MAX_STUFFING_SITES, Settings, type ButtonLabelConfig, BANNER_PREFIX, type Banner, type DealsConfig, type DealSearch, dealSearchesOf, type EffectConfig, type StuffingConfig, type StuffingSource, STUFFING_SOURCES, type ThemeTestConfig } from "./Settings";
import { ButtonLabelSettings, EffectSettings, PartnerTagSettings, StuffingSettings, ThemeTestSettings } from "./StuffingSettings";
import { SiteSettings } from "./SiteSettings";
import { parseQuery, productQuerySchema, productsQuerySchema, sanitizeText } from "./Schemas";
import { z } from "zod";
import { getLogger, Logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { Redis } from "ioredis";
import type { Stats } from "./Stats";
import { Tunables } from "./Tunables";

/** A product of a deals search, with the discount that weighs it. */
interface Deal {
  asin: string;
  savings: number;
}

interface ProductParams {
  id?: string;
  keyword?: string;
  page?: string;
  slot?: number;
}

interface Product {
  title: string;
  url: string;
  image: string;
  brand: string;
  price: string | number;
  savings?: number;
  timestamp: number;
  [key: string]: unknown;
}

/** Outcome for one id of `/products`: `status` is the code `/product` would have answered. */
interface BatchResult {
  id: string;
  status: number;
  product?: Product;
  /** For usage statistics only, not sent to the client. */
  source?: 'cache' | 'amazon';
}

/** Invalid client input, reported as HTTP 400. */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Serves product data from the Redis cache, falling back to the Amazon Creators API.
 */
class AmwApi {

  private static readonly CACHE_KEY_PREFIX: string = 'amw:product:';
  private static readonly NOT_FOUND_KEY_PREFIX: string = 'amw:notfound:';
  // Amazon Associates rules: displayed price and availability must be less than 24 hours old,
  // whatever the cache layer (Redis, stale fallback, browsers and CDNs) they come from
  private static readonly MAX_PRODUCT_AGE: number = MAX_PRODUCT_AGE;
  // Bounds the in-memory not-found cache used when Redis is disabled
  private static readonly MEMORY_NOT_FOUND_ENTRIES: number = 1000;
  private static readonly MOST_CLICKED_DAYS: number = 30;
  // Beyond these, the products have all left Amazon or the site has few clicks: better no card
  private static readonly MOST_CLICKED_CANDIDATES: number = 5;
  // Summing 30 daily sets for each page without a product is wasted work: the ranking moves slowly
  private static readonly MOST_CLICKED_CACHE_TTL: number = 10 * 60 * 1000;
  private static readonly DEALS_KEY_PREFIX: string = 'amw:deals:';
  // Discounts move during the day; one search per site every few hours leaves the quota to the cards
  private static readonly DEALS_TTL: number = 3 * 3600;
  // Stable widget URLs stay short-lived so that existing integrations pick up new releases
  private static readonly WIDGET_CACHE_CONTROL: string = 'public, max-age=3600';
  // Content-hashed widget files never change: a new build produces new names
  private static readonly VERSIONED_CACHE_CONTROL: string = 'public, max-age=31536000, immutable';
  // Names written by scripts/build-widgets.js (widget.<10 hex chars>.js|css)
  private static readonly VERSIONED_WIDGET_FILE: RegExp = /^(widget|themes\/[a-z]+)\.[0-9a-f]{10}\.(js|css)$/;
  private static readonly WIDGET_CONTENT_TYPES: Record<string, string> = {
    '.js': 'application/javascript; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8'
  };

  private readonly log: Logger;
  private readonly paapi: Paapi;
  private readonly cache: Redis | undefined;
  private readonly ttl: number;
  private readonly projectDir: string;
  private readonly stats: Stats | undefined;
  private readonly staleTtl: number;
  private readonly notFoundTtl: number;
  private readonly breaker: CircuitBreaker;
  private readonly coalescer = new RequestCoalescer<Product | null>();
  // The /product lookups of a page arrive together: one GetItems call serves up to 10 of them
  private readonly idBatcher = new LookupBatcher<string, Product>(ids => this.fetchIds(ids), 10, 20);
  private readonly countedFailures = new WeakSet<object>();
  private readonly memoryNotFound: TtlLruCache<true>;
  private readonly tunables: Tunables;
  private readonly stuffing: StuffingSettings;
  private readonly effect: EffectSettings;
  private readonly themeTest: ThemeTestSettings;
  private readonly buttonLabel: ButtonLabelSettings;
  // Each site may set its own: one that never did follows the setting of every site
  private readonly stuffingOf: SiteScopedSetting<StuffingConfig>;
  private readonly effectOf: SiteScopedSetting<EffectConfig>;
  private readonly themeTestOf: SiteScopedSetting<ThemeTestConfig>;
  private readonly buttonLabelOf: SiteScopedSetting<ButtonLabelConfig>;
  private readonly sites: SiteSettings;
  private readonly recommender: Recommender | undefined;
  private readonly mostClicked: TtlLruCache<string[]>;
  private readonly deals: TtlLruCache<Deal[]>;
  private readonly dealsCoalescer = new RequestCoalescer<Deal[]>();
  private widgetSource: string | undefined;

  /**
   * @param cache Redis client, or undefined when caching is disabled (every request then hits Amazon).
   * @param settings Read from the configuration files when omitted.
   * @param recommender Built from the settings when omitted; Settings guarantees Redis when enabled.
   */
  constructor(cache?: Redis, stats?: Stats, settings: Settings = loadSettings(), recommender?: Recommender, stuffing?: StuffingSettings, effect?: EffectSettings, themeTest?: ThemeTestSettings, sites?: SiteSettings, tunables?: Tunables, buttonLabel?: ButtonLabelSettings) {
    this.log = getLogger("AmwApi");
    this.cache = cache;
    this.stats = stats;
    this.paapi = new Paapi(settings, () => stats?.recordAmazonCall());
    this.projectDir = settings.server.projectDir;
    this.tunables = tunables ?? new Tunables(settings);
    this.stuffing = stuffing ?? new StuffingSettings(settings.stuffing, cache);
    this.effect = effect ?? new EffectSettings(settings.effect, cache);
    this.themeTest = themeTest ?? new ThemeTestSettings(cache);
    this.buttonLabel = buttonLabel ?? new ButtonLabelSettings(cache);
    this.stuffingOf = new SiteScopedSetting(this.stuffing);
    this.effectOf = new SiteScopedSetting(this.effect);
    this.themeTestOf = new SiteScopedSetting(this.themeTest);
    this.buttonLabelOf = new SiteScopedSetting(this.buttonLabel);
    this.sites = sites ?? new SiteSettings(settings, cache, new PartnerTagSettings(cache));
    this.mostClicked = new TtlLruCache<string[]>(MAX_STUFFING_SITES, AmwApi.MOST_CLICKED_CACHE_TTL);
    // One search per site, plus the one of every site
    this.deals = new TtlLruCache<Deal[]>(MAX_STUFFING_SITES + 1, AmwApi.DEALS_TTL * 1000, () => Date.now());
    this.recommender = recommender ?? (settings.recommendation.enabled && cache
      ? new Recommender(cache, { ...settings.recommendation, allowedHosts: () => this.sites.recommendationHosts, dailyLimit: () => this.tunables.effective.dailyLimit, marketplace: settings.amazon.marketplace }, {
        onUsage: (model, usage) => stats?.recordLlmUsage('recommendation', model, usage)
      })
      : undefined);
    this.ttl = settings.redis.expire;
    if (this.ttl > AmwApi.MAX_PRODUCT_AGE) {
      this.log.warn(`Redis.expire (${this.ttl}s) exceeds the 24 h price freshness required by Amazon, using ${AmwApi.MAX_PRODUCT_AGE}s`);
      this.ttl = AmwApi.MAX_PRODUCT_AGE;
    }
    this.staleTtl = settings.redis.staleExpire;
    this.notFoundTtl = settings.redis.notFoundExpire;
    this.breaker = new CircuitBreaker(settings.amazon.breakerThreshold, settings.amazon.breakerCooldown * 1000);
    this.memoryNotFound = new TtlLruCache<true>(AmwApi.MEMORY_NOT_FOUND_ENTRIES, this.notFoundTtl * 1000);

    this.log.info("AmwApi initialized successfully");
  }

  /**
   * Handler for `GET <path>/product?id=<ASIN>`, `?keyword=<text>` or `?page=<MD5 of the page URL>`,
   * in that precedence. Never rejects: every error becomes an HTTP response.
   */
  public async setProductEndpoint(req: Request, res: Response): Promise<void> {
    try {
      const params: ProductParams = this.parse(productQuerySchema, req);
      this.logRequest(req, params);

      if (params.id) {
        await this.handleProductById(params.id, req, res);
      } else if (params.keyword) {
        await this.handleProductByKeyword(params.keyword, req, res);
      } else if (params.page) {
        await this.handleProductByPage(params.page, params.slot ?? 0, req, res);
      }
    } catch (error) {
      this.handleError(error, req, res);
    }
  }

  /**
   * Handler for `GET <path>/products?ids=<ASIN>,<ASIN>,...` (up to 10 ASINs). Answers 200 with one
   * result per distinct id, in request order, so that one failing product never hides the others.
   * Never rejects: every error becomes an HTTP response.
   */
  public async setProductsEndpoint(req: Request, res: Response): Promise<void> {
    try {
      const ids = this.parse(productsQuerySchema, req);
      const ip = req.ip || 'unknown';
      this.log.info(`GET /products | ids=${ids.join(',')} | IP=${ip}`);

      const results = await this.findProducts(ids);
      for (const result of results) {
        const source = result.status === 404 ? 'notfound' : result.source;
        if (source) {
          this.stats?.recordProduct(source, 'id', result.id, req.get('referer'));
        }
      }
      // A partial answer must not be cached: the failed products would stay missing downstream.
      // The oldest product sets the max-age, so that none outlives the 24 h freshness limit.
      if (results.every(result => result.status === 200)) {
        setPublicCache(res, Math.min(...results.map(result => this.maxAgeFor(result.product as Product))));
      }
      res.status(200).json({ results: results.map(({ id, status, product }) => (product ? { id, status, product } : { id, status })) });
    } catch (error) {
      this.handleError(error, req, res);
    }
  }

  /**
   * The products of these ASINs for the portal, which shows them before they are on a page:
   * the cache first, then one GetItems call for the others. Not counted in the statistics.
   */
  public async lookupProducts(ids: string[]): Promise<{ id: string; status: number; product?: Product }[]> {
    return (await this.findProducts(ids)).map(({ id, status, product }) => (product ? { id, status, product } : { id, status }));
  }

  /**
   * Same cache, negative cache, coalescing and stale fallback as /product; the products that
   * need Amazon are fetched with a single GetItems call.
   */
  private async findProducts(ids: string[]): Promise<BatchResult[]> {
    const cached = new Map<string, Product | null>();
    const results = new Map<string, BatchResult>();
    const pending: string[] = [];

    await Promise.all(ids.map(async id => {
      const product = this.withinMaxAge(await this.findInCache(this.generateCacheKey('id', id)));
      cached.set(id, product);
      if (product && this.isFresh(product)) {
        results.set(id, { id, status: 200, product, source: 'cache' });
      } else if (await this.isKnownMissing('id', id)) {
        results.set(id, { id, status: 404 });
      } else {
        pending.push(id);
      }
    }));

    // Ids already being fetched by another request join that call; the others share one batch
    const toFetch: string[] = [];
    let batch: Promise<Map<string, Product | null>> | undefined;
    const lookups = pending.map(id => this.coalescer.run(this.generateCacheKey('id', id), () => {
      toFetch.push(id);
      // Deferred to a microtask so that every id of this request is in toFetch before the call
      return Promise.resolve()
        .then(() => (batch ??= this.fetchBatchFromAmazon(toFetch)))
        .then(products => products.get(id) ?? null);
    }));

    const settled = await Promise.allSettled(lookups);
    settled.forEach((outcome, index) => {
      const id = pending[index];
      if (outcome.status === 'fulfilled') {
        results.set(id, outcome.value ? { id, status: 200, product: outcome.value, source: 'amazon' } : { id, status: 404 });
        return;
      }
      const stale = cached.get(id);
      if (stale && outcome.reason instanceof AmazonError) {
        this.log.warn(`Amazon unavailable (${outcome.reason.kind}), serving stale product: ${id}`);
        results.set(id, { id, status: 200, product: stale, source: 'cache' });
        return;
      }
      this.log.error(`Error fetching product ${id}:`, outcome.reason);
      results.set(id, { id, status: AmwApi.statusOf(outcome.reason) });
    });

    return ids.map(id => results.get(id) as BatchResult);
  }

  /** Batch counterpart of fetchFromAmazon(): one breaker slot and one timeout for the whole call. */
  /** A lone product keeps the single GetItems of one ASIN; several share one call. */
  private async fetchIds(ids: string[]): Promise<Map<string, Product>> {
    if (ids.length === 1) {
      const product = await this.paapi.getItemApi(ids[0]);
      return new Map(product ? [[ids[0], product as Product]] : []);
    }
    return this.paapi.getItemsApi(ids) as Promise<Map<string, Product>>;
  }

  /** One product, fetched with the others asked at the same time. */
  private async lookupById(id: string): Promise<Product | null> {
    return (await this.idBatcher.get(id)) ?? null;
  }

  private async fetchBatchFromAmazon(ids: string[]): Promise<Map<string, Product | null>> {
    if (!this.breaker.tryAcquire()) {
      throw new AmazonError('unavailable', 'Circuit breaker open, Amazon API not called', {
        retryAfter: this.breaker.retryAfterSeconds()
      });
    }

    let found: Map<string, Product>;
    try {
      found = await this.withTimeout(this.paapi.getItemsApi(ids), Paapi.REQUEST_TIMEOUT);
    } catch (error) {
      this.breaker.recordFailure();
      throw error;
    }
    this.breaker.recordSuccess();

    const products = new Map<string, Product | null>();
    await Promise.all(ids.map(async id => {
      const product = found.get(id) ?? null;
      products.set(id, product);
      if (product) {
        await this.saveInCache(this.generateCacheKey('id', id), product);
      } else {
        await this.rememberMissing('id', id);
      }
    }));
    return products;
  }

  /** HTTP status /product would have answered for this failure. */
  private static statusOf(error: unknown): number {
    if (!(error instanceof AmazonError)) {
      return 500;
    }
    switch (error.kind) {
      case 'timeout':
        return 504;
      case 'throttled':
      case 'unavailable':
        return 503;
      default:
        return 502;
    }
  }

  /**
   * @throws ValidationError with the message of the first schema violation.
   */
  private parse<T>(schema: z.ZodType<T>, req: Request): T {
    const result = parseQuery(schema, req.query);
    if (!result.success) {
      throw new ValidationError(result.message);
    }
    return result.data;
  }

  private logRequest(req: Request, params: ProductParams): void {
    // req.ip honours the Server.trustProxy setting, so X-Forwarded-For cannot be spoofed
    const ip = req.ip || 'unknown';
    const referer = sanitizeText(req.get('referer') || '') || 'none';
    
    this.log.info(`GET /product | id=${params.id || 'none'} | keyword=${params.keyword || 'none'} | page=${params.page || 'none'} | IP=${ip} | Referer=${referer}`);
  }

  private async handleProductById(id: string, req: Request, res: Response): Promise<void> {
    await this.handleProduct('id', id, () => this.lookupById(id), req, res);
  }

  private async handleProductByKeyword(keyword: string, req: Request, res: Response): Promise<void> {
    await this.handleProduct('keyword', keyword, () => this.paapi.searchItemApi(keyword), req, res);
  }

  /**
   * Manual mode shows the products of the portal, card after card. Otherwise the chosen search
   * terms follow the keyword path (same cache, stale fallback and stats), and a page left without
   * a product shows the portal's products, then the most clicked ones of its site.
   */
  private async handleProductByPage(pageHash: string, slot: number, req: Request, res: Response): Promise<void> {
    // The Stuffing of the page's site, or of every site
    const site = this.hostOf(req.get('referer'));
    await this.stuffingOf.refresh(site ? [site] : []);
    const settings = this.stuffingOf.current(site);
    const { mode } = settings;
    // The count comes from the settings: a client must not decide how many products are generated
    const count = Math.max(1, this.cardsOf(settings, site));
    if (slot >= count) {
      this.sendNoRecommendation(res);
      return;
    }
    const none = async () => this.sendNoRecommendation(res);
    if (mode !== 'mix') {
      await this.sendFromSource(mode, slot, { settings, site, pageHash, count, req, res }, none);
      return;
    }
    // Each card draws its source; a source without a product hands the card to the next one drawn
    const sources = AmwApi.drawSources(settings.weights, pageHash, slot);
    const indexOf = (source: StuffingSource) => AmwApi.earlierDraws(settings.weights, pageHash, slot, source);
    const tryFrom = async (position: number): Promise<void> => {
      const source = sources[position];
      if (source === undefined) {
        await none();
        return;
      }
      await this.sendFromSource(source, indexOf(source), { settings, site, pageHash, count, req, res }, () => tryFrom(position + 1));
    };
    await tryFrom(0);
  }

  /**
   * The index-th card of one source of products, or onEmpty when it has none.
   * @param index The rank of the card among those of this source on the page.
   */
  private async sendFromSource(
    source: StuffingSource,
    index: number,
    { settings, site, pageHash, count, req, res }: { settings: StuffingConfig; site: string | undefined; pageHash: string; count: number; req: Request; res: Response },
    onEmpty: () => Promise<void>
  ): Promise<void> {
    if (source === 'manual') {
      await this.sendChosen(settings.products, index, req, res, onEmpty, settings.banners ?? []);
      return;
    }
    if (source === 'popular') {
      await this.sendPopular(site, settings.products, index, req, res, onEmpty);
      return;
    }
    if (source === 'deals') {
      await this.sendDeals(dealSearchesOf(settings), pageHash, index, req, res, onEmpty);
      return;
    }
    // Paused in the portal: like a server without recommendations
    if (!this.recommender || !this.tunables.effective.recommendations) {
      await onEmpty();
      return;
    }
    const { product: keyword, broader, host } = await this.recommender.recommend(pageHash, req.get('referer'), count, index);
    // Each card takes its own rank, so that several cards do not all show the same product
    const showFallback = () => this.sendFallback(host, settings.products, index, req, res, onEmpty);
    await this.searchInTurn(keyword ? [keyword, ...broader] : [], req, res, showFallback);
  }

  /** A stable number in ]0, 1[ for a page and a name. */
  private static seeded(pageHash: string, name: string): number {
    return (parseInt(createHash('sha1').update(`${pageHash}:${name}`).digest('hex').slice(0, 12), 16) + 1) / (2 ** 48 + 1);
  }

  /** The sources of a card in the order they are tried: weighted draw without replacement, stable for the page. */
  private static drawSources(weights: StuffingConfig['weights'], pageHash: string, slot: number): StuffingSource[] {
    return STUFFING_SOURCES
      .filter(source => (weights?.[source] ?? 0) > 0)
      .map(source => ({ source, key: Math.pow(AmwApi.seeded(pageHash, `${slot}:${source}`), 1 / (weights?.[source] ?? 1)) }))
      .sort((a, b) => b.key - a.key)
      .map(({ source }) => source);
  }

  /** How many earlier cards of the page drew this source first: its products go in order. */
  private static earlierDraws(weights: StuffingConfig['weights'], pageHash: string, slot: number, source: StuffingSource): number {
    let draws = 0;
    for (let earlier = 0; earlier < slot; earlier++) {
      if (AmwApi.drawSources(weights, pageHash, earlier)[0] === source) draws++;
    }
    return draws;
  }

  /**
   * Too specific terms find nothing on Amazon: the broader ones are tried in turn, each search
   * only when the previous one is empty, then the fallback.
   */
  private async searchInTurn(terms: string[], req: Request, res: Response, fallback: () => Promise<void>): Promise<void> {
    const [keyword, ...broader] = terms;
    if (keyword === undefined) {
      await fallback();
      return;
    }
    await this.handleProduct('keyword', keyword, () => this.paapi.searchItemApi(keyword), req, res,
      () => this.searchInTurn(broader, req, res, fallback));
  }

  /** The cards of an article of the page's site: its own number when the portal set one. */
  private cardsOf({ count, sites }: StuffingConfig, host: string | undefined): number {
    return host !== undefined && Object.prototype.hasOwnProperty.call(sites, host) ? sites[host] : count;
  }

  /** Card n shows the n-th product of the portal, or the next one when it has left Amazon. */
  private async sendChosen(products: string[], index: number, req: Request, res: Response, onEmpty: () => Promise<void>, banners: Banner[] = []): Promise<void> {
    const asin = products[index];
    if (!asin) {
      await onEmpty();
      return;
    }
    if (asin.startsWith(BANNER_PREFIX)) {
      const banner = banners.find(candidate => `${BANNER_PREFIX}${candidate.id}` === asin);
      if (banner) {
        this.sendBanner(res, banner);
        return;
      }
      // A banner removed since the list was read: the next item takes the card
      await this.sendChosen(products, index + 1, req, res, onEmpty, banners);
      return;
    }
    await this.handleProduct('id', asin, () => this.lookupById(asin), req, res,
      () => this.sendChosen(products, index + 1, req, res, onEmpty, banners));
  }

  /**
   * The most clicked products of the site first, then the portal's products while the site has
   * too few clicks. Clicks are only ranked for the sites of the Sites page: another host gets the
   * portal's products. Moves on to the next candidate when a product has left Amazon.
   */
  private async sendPopular(host: string | undefined, products: string[], index: number, req: Request, res: Response, onEmpty: () => Promise<void>): Promise<void> {
    const clicked = host ? await this.mostClickedOf(host) : [];
    const asin = [...new Set([...clicked, ...AmwApi.asinsOf(products)])][index];
    if (!asin) {
      await onEmpty();
      return;
    }
    await this.handleProduct('id', asin, () => this.lookupById(asin), req, res,
      () => this.sendPopular(host, products, index + 1, req, res, onEmpty));
  }

  /**
   * The discounted products of the searches together, in an order drawn for the page: a larger
   * discount comes first more often, and the cards of one page show different products.
   */
  private async sendDeals(searches: DealSearch[], pageHash: string, index: number, req: Request, res: Response, onEmpty: () => Promise<void>): Promise<void> {
    if (searches.length === 0) {
      await onEmpty();
      return;
    }
    const found = (await Promise.all(searches.map(search => this.dealsOf(search)))).flat();
    // A product found by two searches is drawn once, with its discount
    const deals = [...new Map(found.map(deal => [deal.asin, deal])).values()];
    await this.sendChosen(AmwApi.drawDeals(deals, pageHash), index, req, res, onEmpty);
  }

  /**
   * The products of one search, for the Best deals view: the same cache as the cards, so that a
   * preview costs one Amazon call at most every few hours.
   */
  public async previewDeals(search: DealSearch): Promise<{ asin: string; savings: number; product?: Product }[]> {
    const deals = await this.dealsOf(search);
    const products = new Map((await this.findProducts(deals.map(deal => deal.asin))).map(result => [result.id, result.product]));
    return deals.map(deal => ({ ...deal, product: products.get(deal.asin) ?? undefined }));
  }

  /**
   * Weighted sampling without replacement (Efraimidis and Spirakis): each product draws
   * u^(1/savings), u being stable for the page, so that a page keeps its cards between views.
   */
  private static drawDeals(deals: Deal[], pageHash: string): string[] {
    const key = ({ asin, savings }: Deal) => Math.pow(AmwApi.seeded(pageHash, asin), 1 / Math.max(1, savings));
    return deals.map(deal => ({ asin: deal.asin, key: key(deal) })).sort((a, b) => b.key - a.key).map(deal => deal.asin);
  }

  /**
   * The deals of a search: from memory, Redis, then Amazon. The products found go to the product
   * cache, so that their cards cost no other call. When Amazon fails, the last list is kept.
   */
  private async dealsOf(deals: DealsConfig & { maxProducts?: number }): Promise<Deal[]> {
    // The number joins the key only below the most: searches saved before it keep their cache
    const count = deals.maxProducts ?? Paapi.DEAL_CANDIDATES;
    const identity = [deals.keywords, deals.searchIndex, deals.minSavingPercent, ...(count < Paapi.DEAL_CANDIDATES ? [count] : [])];
    const key = `${AmwApi.DEALS_KEY_PREFIX}${createHash('sha1').update(JSON.stringify(identity)).digest('hex').slice(0, 16)}`;
    const remembered = this.deals.get(key);
    if (remembered) {
      return remembered;
    }
    let stored: { at: number; deals: Deal[] } | null = null;
    try {
      const raw = await this.cache?.get(key);
      stored = raw ? JSON.parse(raw) : null;
    } catch (error) {
      this.log.error(`Error reading the deals ${key}:`, error);
    }
    if (stored && Date.now() - stored.at < AmwApi.DEALS_TTL * 1000) {
      this.deals.set(key, stored.deals);
      return stored.deals;
    }
    return this.dealsCoalescer.run(key, () => this.searchDeals(key, deals, count, stored?.deals ?? []));
  }

  private async searchDeals(key: string, deals: DealsConfig, count: number, stale: Deal[]): Promise<Deal[]> {
    if (!this.breaker.tryAcquire()) {
      return stale;
    }
    let products: Product[];
    try {
      products = await this.withTimeout(this.paapi.searchDealsApi(deals, count), Paapi.REQUEST_TIMEOUT);
    } catch (error) {
      this.breaker.recordFailure();
      this.log.warn(`Deals search failed, keeping ${stale.length} earlier deals:`, error);
      return stale;
    }
    this.breaker.recordSuccess();
    const found = products.map(product => ({ asin: String(product.asin), savings: Number(product.savings) || 0 }));
    await Promise.all(products.map(product => this.saveInCache(this.generateCacheKey('id', String(product.asin)), product)));
    this.deals.set(key, found);
    try {
      await this.cache?.set(key, JSON.stringify({ at: Date.now(), deals: found }), 'EX', AmwApi.MAX_PRODUCT_AGE);
    } catch (error) {
      this.log.error(`Error saving the deals ${key}:`, error);
    }
    return found;
  }

  /**
   * A card of the site's own: no price, so none of the 24-hour rules of Amazon apply, and no
   * statistics, which count Amazon products. The widget shows it without the Amazon marks.
   */
  private sendBanner(res: Response, banner: Banner): void {
    setPublicCache(res, this.tunables.httpCache);
    res.status(200).json({ custom: true, id: banner.id, title: banner.title, image: banner.image, url: banner.url, ...(banner.label ? { label: banner.label } : {}) });
  }

  /** The products of a list without its banners: the other sources only show Amazon products. */
  private static asinsOf(items: string[]): string[] {
    return items.filter(item => !item.startsWith(BANNER_PREFIX));
  }

  private hostOf(referer: string | undefined): string | undefined {
    try {
      return referer ? new URL(referer).host : undefined;
    } catch {
      return undefined;
    }
  }

  private sendNoRecommendation(res: Response): void {
    this.sendError(res, 404, "Product Not Found", "No product is recommended for this page");
  }

  /**
   * The products set in the portal come first, then the most clicked ones of the site when
   * Recommendation.fallback is on. Moves on to the next candidate when a product has left Amazon.
   */
  private async sendFallback(host: string, chosen: string[], index: number, req: Request, res: Response, onEmpty: () => Promise<void>): Promise<void> {
    const clicked = this.tunables.effective.fallback ? await this.mostClickedOf(host) : [];
    const asin = [...new Set([...AmwApi.asinsOf(chosen), ...clicked])][index];
    if (!asin) {
      await onEmpty();
      return;
    }
    await this.handleProduct('id', asin, () => this.lookupById(asin), req, res,
      () => this.sendFallback(host, chosen, index + 1, req, res, onEmpty));
  }

  /** A statistics failure only costs the card: the page had no product anyway. */
  private async mostClickedOf(host: string): Promise<string[]> {
    const cached = this.mostClicked.get(host);
    if (cached || !this.stats) {
      return cached ?? [];
    }
    try {
      const asins = await this.stats.getMostClickedProducts(host, AmwApi.MOST_CLICKED_DAYS, AmwApi.MOST_CLICKED_CANDIDATES);
      this.mostClicked.set(host, asins);
      return asins;
    } catch (error) {
      this.log.error(`Failed to read the most clicked products of ${host}:`, error);
      return [];
    }
  }

  /**
   * Fresh cache → negative cache → Amazon (one call per key at a time, guarded by the circuit
   * breaker). When Amazon fails, a stale copy of the product is preferred over an error.
   */
  private async handleProduct(
    type: 'id' | 'keyword',
    value: string,
    lookup: () => Promise<Product | null>,
    req: Request,
    res: Response,
    onMissing?: () => Promise<void>
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(type, value);
    const record = (source: 'cache' | 'amazon' | 'notfound') => this.stats?.recordProduct(source, type, value, req.get('referer'));

    const cachedProduct = this.withinMaxAge(await this.findInCache(cacheKey));
    if (cachedProduct && this.isFresh(cachedProduct)) {
      this.log.info(`Product found in cache: ${value}`);
      this.sendSuccessResponse(res, cachedProduct);
      record('cache');
      return;
    }

    const answerMissing = async () => {
      record('notfound');
      if (onMissing) {
        await onMissing();
      } else {
        this.sendNotFoundResponse(res, cacheKey);
      }
    };

    if (await this.isKnownMissing(type, value)) {
      await answerMissing();
      return;
    }

    let product: Product | null;
    try {
      product = await this.coalescer.run(cacheKey, () => this.fetchFromAmazon(type, value, cacheKey, lookup));
    } catch (error) {
      if (cachedProduct && error instanceof AmazonError) {
        this.log.warn(`Amazon unavailable (${error.kind}), serving stale product: ${value}`);
        this.sendSuccessResponse(res, cachedProduct);
        record('cache');
        return;
      }
      this.log.error(`Error fetching product (${type}) ${value}:`, error);
      throw error;
    }

    if (product) {
      this.sendSuccessResponse(res, product);
      record('amazon');
    } else {
      await answerMissing();
    }
  }

  /**
   * Runs once per coalesced key, so the breaker counts real Amazon calls and the cache is
   * written once, whatever the number of waiting requests.
   */
  private async fetchFromAmazon(
    type: string,
    value: string,
    cacheKey: string,
    lookup: () => Promise<Product | null>
  ): Promise<Product | null> {
    if (!this.breaker.tryAcquire()) {
      throw new AmazonError('unavailable', 'Circuit breaker open, Amazon API not called', {
        retryAfter: this.breaker.retryAfterSeconds()
      });
    }

    let product: Product | null;
    try {
      product = await this.withTimeout(lookup(), Paapi.REQUEST_TIMEOUT);
    } catch (error) {
      // One failed batch is one failure, however many lookups were waiting for it
      if (!(typeof error === 'object' && error !== null && this.countedFailures.has(error))) {
        if (typeof error === 'object' && error !== null) this.countedFailures.add(error);
        this.breaker.recordFailure();
      }
      if (this.breaker.state === 'open') {
        this.log.warn(`Circuit breaker open: Amazon API calls suspended for ${this.breaker.retryAfterSeconds()}s`);
      }
      throw error;
    }

    // "Not found" is a valid answer: Amazon is healthy
    this.breaker.recordSuccess();
    if (product) {
      await this.saveInCache(cacheKey, product);
      this.stats?.rememberTitle(type as 'id' | 'keyword', value, product.title);
    } else {
      await this.rememberMissing(type, value);
    }
    return product;
  }

  /**
   * Products are kept `staleTtl` seconds beyond their freshness so that they can still be served
   * when Amazon is down, but never past MAX_PRODUCT_AGE (see withinMaxAge).
   */
  private isFresh(product: Product): boolean {
    return this.ageOf(product) < this.ttl;
  }

  /** Seconds since Amazon returned the product; Infinity when unknown, so it is never served. */
  private ageOf(product: Product): number {
    return typeof product.timestamp === 'number' ? Math.max(0, (Date.now() - product.timestamp) / 1000) : Infinity;
  }

  /** Drops a cached product too old to be shown, even as a fallback while Amazon is down. */
  private withinMaxAge(product: Product | null): Product | null {
    return product && this.ageOf(product) < AmwApi.MAX_PRODUCT_AGE ? product : null;
  }

  /**
   * Negative cache: a missing ASIN embedded in a popular page would otherwise cost an Amazon call
   * on every view. Stored in Redis when enabled, in a bounded in-memory LRU otherwise.
   */
  private async isKnownMissing(type: string, value: string): Promise<boolean> {
    if (this.notFoundTtl <= 0) {
      return false;
    }
    const key = `${AmwApi.NOT_FOUND_KEY_PREFIX}${type}:${value}`;
    if (!this.cache) {
      return this.memoryNotFound.get(key) === true;
    }
    try {
      return (await this.cache.exists(key)) === 1;
    } catch (error) {
      this.log.error(`Error reading the not-found cache for key ${key}:`, error);
      return false;
    }
  }

  private async rememberMissing(type: string, value: string): Promise<void> {
    if (this.notFoundTtl <= 0) {
      return;
    }
    const key = `${AmwApi.NOT_FOUND_KEY_PREFIX}${type}:${value}`;
    if (!this.cache) {
      this.memoryNotFound.set(key, true);
      return;
    }
    try {
      await this.cache.set(key, '1', 'EX', this.notFoundTtl);
    } catch (error) {
      this.log.error(`Error saving to the not-found cache for key ${key}:`, error);
    }
  }

  /** Builds keys like `amw:product:id:B08N5WRWNW`. */
  private generateCacheKey(type: string, value: string): string {
    return `${AmwApi.CACHE_KEY_PREFIX}${type}:${value}`;
  }

  /**
   * Rejects if `promise` has not settled after `ms`. The timer is cleared once the race is over
   * so that it does not keep running for 30 s after every request.
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AmazonError('timeout', `Request timeout after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private sendSuccessResponse(res: Response, product: Product): void {
    // Only successes are cacheable: errors keep the no-store default set by AmwServer.
    // Downstream caches must drop the product before it turns 24 hours old.
    setPublicCache(res, this.maxAgeFor(product));
    res.status(200).json(product);
  }

  private maxAgeFor(product: Product): number {
    const remaining = Math.floor(AmwApi.MAX_PRODUCT_AGE - this.ageOf(product));
    return Math.max(0, Math.min(this.tunables.httpCache, remaining));
  }

  private sendNotFoundResponse(res: Response, identifier: string): void {
    this.log.info(`Product not found in Amazon: ${identifier}`);
    res.status(404).json({
      error: "Product Not Found",
      message: `No product found for identifier: ${identifier}`,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Maps errors to 400 (validation), 502/503/504 (Amazon failure) or 500, without leaking
   * internal details. 404 is reserved for products Amazon reports as missing.
   */
  private handleError(error: unknown, req: Request, res: Response): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.log.error(`API Error: ${err.message}`, err);

    if (error instanceof ValidationError) {
      this.sendError(res, 400, "Validation Error", err.message);
    } else if (error instanceof AmazonError) {
      this.sendAmazonError(res, error);
    } else if (error instanceof RecommendationError) {
      this.sendRecommendationError(res, error);
    } else {
      this.sendError(res, 500, "Internal Server Error", "An unexpected error occurred");
    }
  }

  private sendRecommendationError(res: Response, error: RecommendationError): void {
    if (error.kind === 'forbidden') {
      this.sendError(res, 403, "Forbidden", "This page is not allowed to request new recommendations");
      return;
    }
    res.set('Retry-After', error.kind === 'limit' ? '3600' : '60');
    this.sendError(res, 503, "Service Unavailable", "No recommendation available for now, retry later");
  }

  private sendAmazonError(res: Response, error: AmazonError): void {
    switch (error.kind) {
      case 'timeout':
        this.sendError(res, 504, "Gateway Timeout", "Request timed out while fetching product data");
        break;
      case 'throttled':
        // Lets well-behaved clients and proxies back off instead of hammering an exhausted quota
        res.set('Retry-After', String(error.retryAfter ?? 60));
        this.sendError(res, 503, "Service Unavailable", "Amazon API rate limit reached, retry later");
        break;
      case 'unavailable':
        res.set('Retry-After', String(error.retryAfter ?? 60));
        this.sendError(res, 503, "Service Unavailable", "Amazon API temporarily unavailable, retry later");
        break;
      default:
        this.sendError(res, 502, "Bad Gateway", "Amazon API returned an error");
    }
  }

  private sendError(res: Response, status: number, error: string, message: string): void {
    res.status(status).json({
      error,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handler for `GET <path>/widget.js`: serves the minified widget produced by `npm run build`.
   */
  public setWidgetEndpoint(req: Request, res: Response): Promise<void> {
    return this.sendWidget(req, res);
  }

  /**
   * The globals of widget.js for the settings of a site, or of every site: null removes one that
   * the settings of every site set. Only known themes, effects, labels and HTML ids get here.
   */
  private widgetGlobals(host?: string): Record<string, unknown> {
    const { enabled, count, containerId, sites, wordsPerCard } = this.stuffingOf.current(host);
    // Only what is set, so that the default settings keep the shortest prefix
    const stuffing = {
      count, containerId,
      ...(wordsPerCard > 0 ? { wordsPerCard } : {}),
      // A site with its own number may add cards while the default adds none
      ...(Object.keys(sites).length > 0 ? { sites } : {}),
    };
    const stuffed = enabled !== false && (count > 0 || Object.values(sites).some(cards => cards > 0));
    const { mode, effects } = this.effectOf.current(host);
    const themeTest = this.themeTestOf.current(host);
    const buttonLabel = this.buttonLabelOf.current(host);
    const theme = themeTest.theme ?? this.tunables.theme;
    return {
      AMW_DEFAULT_THEME: theme === 'default' ? null : theme,
      AMW_STUFFING: stuffed ? stuffing : null,
      AMW_EFFECT: mode === 'none' ? null : mode,
      AMW_EFFECTS: mode === 'compare' ? effects : null,
      AMW_THEMES: themeTest.mode === 'compare' ? themeTest.themes : null,
      AMW_LABEL: buttonLabel.label === 'offer' ? null : buttonLabel.label,
      AMW_LABELS: buttonLabel.mode === 'compare' ? buttonLabel.labels : null,
    };
  }

  /**
   * The settings of the sites that set their own, applied by widget.js on these hosts over the
   * settings of every site.
   */
  private siteGlobals(hosts: string[]): string {
    const owned: [SiteScopedSetting<unknown>, string[]][] = [
      [this.stuffingOf as SiteScopedSetting<unknown>, ['AMW_STUFFING']],
      [this.effectOf as SiteScopedSetting<unknown>, ['AMW_EFFECT', 'AMW_EFFECTS']],
      [this.themeTestOf as SiteScopedSetting<unknown>, ['AMW_DEFAULT_THEME', 'AMW_THEMES']],
      [this.buttonLabelOf as SiteScopedSetting<unknown>, ['AMW_LABEL', 'AMW_LABELS']],
    ];
    const bySite: Record<string, Record<string, unknown>> = {};
    for (const host of hosts) {
      const names = owned.filter(([setting]) => setting.isOwn(host)).flatMap(([, keys]) => keys);
      if (names.length === 0) continue;
      const values = this.widgetGlobals(host);
      bySite[host] = Object.fromEntries(names.map(name => [name, values[name]]));
    }
    return Object.keys(bySite).length > 0 ? `window.AMW_SITE_SETTINGS=${JSON.stringify(bySite)};\n` : '';
  }

  /**
   * The stable widget.js with the settings of the server prepended. Hashed copies stay untouched:
   * their name promises their content, so integrations pinned to one choose the theme with
   * data-theme, only meet the list of sites on the API, and add no cards.
   * These values are safe to inject: Settings, StuffingSettings and SiteSettings only accept known themes,
   * effects, button labels, plain hosts, tracking IDs and HTML ids.
   */
  private async sendWidget(req: Request, res: Response): Promise<void> {
    await this.sites.refresh();
    const hosts = this.sites.hosts;
    await Promise.all([this.stuffingOf, this.effectOf, this.themeTestOf, this.buttonLabelOf].map(setting => setting.refresh(hosts)));
    // In widget.js rather than in the answers: a tag chosen from the Referer would stop CDNs from
    // sharing one cached product between sites
    const partnerTags = this.sites.partnerTags;
    const shared = this.widgetGlobals();
    const prefix = Object.entries(shared).filter(([, value]) => value !== null).map(([name, value]) => `window.${name}=${JSON.stringify(value)};\n`).join('') +
      (hosts.length === 0 ? '' : `window.AMW_ALLOWED_SITES=${JSON.stringify(hosts)};\n`) +
      (Object.keys(partnerTags).length > 0 ? `window.AMW_PARTNER_TAGS=${JSON.stringify(partnerTags)};\n`.replace(/^/, '') : '') +
      this.siteGlobals(hosts);
    if (prefix === '') {
      this.sendWidgetFile('widget.js', AmwApi.WIDGET_CACHE_CONTROL, req, res);
      return;
    }
    try {
      this.widgetSource ??= await fs.promises.readFile(path.join(this.projectDir, 'dist', 'widgets', 'widget.js'), 'utf8');
      // Same reason as sendWidgetFile: keeps the global middleware from rewriting Cache-Control
      (res as Response & { cacheControl?: unknown }).cacheControl = undefined;
      res.set({ 'Content-Type': AmwApi.WIDGET_CONTENT_TYPES['.js'], 'Cache-Control': AmwApi.WIDGET_CACHE_CONTROL });
      res.send(prefix + this.widgetSource);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.log.error('Widget file not found: run npm run build');
        this.sendWidgetNotFound('widget.js', res);
        return;
      }
      res.set('Cache-Control', 'no-store');
      this.handleError(error, req, res);
    }
  }

  /**
   * Handler for `GET <path>/widget.css`: the widget stylesheet, loaded by widget.js.
   */
  public setWidgetCssEndpoint(req: Request, res: Response): void {
    this.sendWidgetFile('widget.css', AmwApi.WIDGET_CACHE_CONTROL, req, res);
  }

  /**
   * Handler for `GET <path>/widget.<hash>.js|css`: content-hashed copies, cacheable forever.
   * The route only matches valid names; the check here keeps the handler safe on its own.
   */
  public setVersionedWidgetEndpoint(req: Request, res: Response): void {
    const fileName = String(req.params[0] ?? '');
    if (!AmwApi.VERSIONED_WIDGET_FILE.test(fileName)) {
      this.sendWidgetNotFound(fileName, res);
      return;
    }
    this.sendWidgetFile(fileName, AmwApi.VERSIONED_CACHE_CONTROL, req, res);
  }

  /**
   * Handler for `GET <path>/themes/<theme>.css`: the stylesheet of an alternative theme, loaded by
   * widget.js when that theme is active. The name comes from the fixed list of themes.
   */
  public setThemeCssEndpoint(theme: string, req: Request, res: Response): void {
    this.sendWidgetFile(`themes/${theme}.css`, AmwApi.WIDGET_CACHE_CONTROL, req, res);
  }

  /**
   * Handler for `GET <path>/widget-manifest.json`: maps widget.js / widget.css to their
   * current hashed names, for integrations that want the immutable URLs.
   */
  public setWidgetManifestEndpoint(req: Request, res: Response): void {
    this.sendWidgetFile('manifest.json', AmwApi.WIDGET_CACHE_CONTROL, req, res);
  }

  /**
   * Sends a file of `dist/widgets`. Passing `root` makes send check dot segments in the file name
   * only, so the project can be installed under a dot directory (`~/.local`, `.claude/worktrees`).
   * Content type and Cache-Control are set through `headers`, which only apply on success, so
   * that error bodies stay JSON and are not cached.
   */
  private sendWidgetFile(fileName: string, cacheControl: string, req: Request, res: Response): void {
    const root = path.join(this.projectDir, 'dist', 'widgets');
    const contentType = AmwApi.WIDGET_CONTENT_TYPES[path.extname(fileName)];
    // The global express-cache-controller middleware writes its default max-age when the headers
    // are sent; clearing its settings lets these routes keep their own Cache-Control
    (res as Response & { cacheControl?: unknown }).cacheControl = undefined;
    try {
      res.sendFile(fileName, {
        root,
        cacheControl: false,
        headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl }
      }, (error?: Error) => {
        if (!error || res.headersSent) {
          return;
        }
        const status = (error as Error & { statusCode?: number }).statusCode;
        if (status === 404) {
          // Usually means the widgets were not built (npm run build), or an outdated hashed name
          this.log.error(`Widget file not found: ${path.join(root, fileName)}`);
          this.sendWidgetNotFound(fileName, res);
          return;
        }
        res.set('Cache-Control', 'no-store');
        this.handleError(error, req, res);
      });
    } catch (error) {
      res.set('Cache-Control', 'no-store');
      this.handleError(error, req, res);
    }
  }

  private sendWidgetNotFound(fileName: string, res: Response): void {
    res.set('Cache-Control', 'no-store');
    res.status(404).json({
      error: "Not Found",
      message: `${fileName} is not available`,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * @returns The cached product, or null on a miss, when caching is disabled or when Redis fails
   * (a cache outage degrades to direct Amazon calls instead of failing the request).
   */
  private async findInCache(key: string): Promise<Product | null> {
    if (!this.cache) {
      return null;
    }

    try {
      const cachedData = await this.cache.get(key);
      
      if (cachedData) {
        metrics.recordCacheLookup('hit');
        this.log.info(`Product found in cache: ${key}`);
        return JSON.parse(cachedData);
      }

      metrics.recordCacheLookup('miss');
      this.log.info(`Product not found in cache: ${key}`);
      return null;
    } catch (error) {
      metrics.recordCacheLookup('error');
      this.log.error(`Error accessing cache for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Best effort: a Redis failure is logged and the request still succeeds.
   */
  private async saveInCache(key: string, product: Product): Promise<void> {
    if (!this.cache) {
      return;
    }

    try {
      this.log.info(`Saving product in cache: ${key}`);
      // Kept beyond its freshness so that it can be served while Amazon is down (see isFresh)
      await this.cache.set(key, JSON.stringify(product), 'EX', Math.min(this.ttl + this.staleTtl, AmwApi.MAX_PRODUCT_AGE));
    } catch (error) {
      this.log.error(`Error saving to cache for key ${key}:`, error);
    }
  }
}

export { AmwApi };