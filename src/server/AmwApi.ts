/**
 * HTTP handlers for the product and widget endpoints.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import config from "config";
import path from "path";
import { Request, Response } from "express";
import { Paapi } from "./Paapi";
import { AmazonError } from "./AmazonError";
import { CircuitBreaker, RequestCoalescer, TtlLruCache } from "./Resilience";
import { HTTP_CACHE_SECONDS, setPublicCache } from "./CacheControl";
import { parseQuery, productQuerySchema, productsQuerySchema, sanitizeText } from "./Schemas";
import { z } from "zod";
import { getLogger, Logger } from "../utils/logger";
import { Redis } from "ioredis";
import type { Stats } from "./Stats";

interface ProductParams {
  id?: string;
  keyword?: string;
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

  private static readonly PROJECT_DIR: string = config.get('Server.projectDir');
  private static readonly CACHE_KEY_PREFIX: string = 'amw:product:';
  private static readonly NOT_FOUND_KEY_PREFIX: string = 'amw:notfound:';
  // Amazon Associates rules: displayed price and availability must be less than 24 hours old,
  // whatever the cache layer (Redis, stale fallback, browsers and CDNs) they come from
  private static readonly MAX_PRODUCT_AGE: number = 86400;
  // Bounds the in-memory not-found cache used when Redis is disabled
  private static readonly MEMORY_NOT_FOUND_ENTRIES: number = 1000;
  // Upper bound on an Amazon call, so a slow upstream answers 504 instead of holding the socket
  private static readonly REQUEST_TIMEOUT: number = 30000;
  // Stable widget URLs stay short-lived so that existing integrations pick up new releases
  private static readonly WIDGET_CACHE_CONTROL: string = 'public, max-age=3600';
  // Content-hashed widget files never change: a new build produces new names
  private static readonly VERSIONED_CACHE_CONTROL: string = 'public, max-age=31536000, immutable';
  // Names written by scripts/build-widgets.js (widget.<10 hex chars>.js|css)
  private static readonly VERSIONED_WIDGET_FILE: RegExp = /^widget\.[0-9a-f]{10}\.(js|css)$/;
  private static readonly WIDGET_CONTENT_TYPES: Record<string, string> = {
    '.js': 'application/javascript; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8'
  };

  private readonly log: Logger;
  private readonly paapi: Paapi;
  private readonly cache: Redis | undefined;
  private readonly ttl: number;
  private readonly stats: Stats | undefined;
  private readonly staleTtl: number;
  private readonly notFoundTtl: number;
  private readonly breaker: CircuitBreaker;
  private readonly coalescer = new RequestCoalescer<Product | null>();
  private readonly memoryNotFound: TtlLruCache<true>;

  /**
   * @param cache Redis client, or undefined when caching is disabled (every request then hits Amazon).
   */
  constructor(cache?: Redis, stats?: Stats) {
    this.log = getLogger("AmwApi");
    this.cache = cache;
    this.stats = stats;
    this.paapi = new Paapi();
    // Cache TTL in seconds
    this.ttl = Number(config.get('Redis.expire')) || 3600;
    if (this.ttl > AmwApi.MAX_PRODUCT_AGE) {
      this.log.warn(`Redis.expire (${this.ttl}s) exceeds the 24 h price freshness required by Amazon, using ${AmwApi.MAX_PRODUCT_AGE}s`);
      this.ttl = AmwApi.MAX_PRODUCT_AGE;
    }
    // The resilience settings are optional so that existing configuration files keep working
    this.staleTtl = AmwApi.optionalNumber('Redis.staleExpire', AmwApi.MAX_PRODUCT_AGE);
    this.notFoundTtl = AmwApi.optionalNumber('Redis.notFoundExpire', 3600);
    this.breaker = new CircuitBreaker(
      AmwApi.optionalNumber('Amazon.breakerThreshold', 5),
      AmwApi.optionalNumber('Amazon.breakerCooldown', 60) * 1000
    );
    this.memoryNotFound = new TtlLruCache<true>(AmwApi.MEMORY_NOT_FOUND_ENTRIES, this.notFoundTtl * 1000);
    this.validateConfiguration();

    this.log.info("AmwApi initialized successfully");
  }

  /**
   * Fails fast at startup rather than on the first request.
   */
  private validateConfiguration(): void {
    if (!AmwApi.PROJECT_DIR) {
      throw new Error('Server.projectDir configuration is required');
    }

    if (this.ttl <= 0) {
      throw new Error('Redis.expire must be a positive number');
    }
  }

  /**
   * @throws Error when the key is set to something else than a number >= 0 (0 disables the feature).
   */
  private static optionalNumber(key: string, defaultValue: number): number {
    const raw = config.has(key) ? config.get(key) : null;
    if (raw === null || raw === undefined || raw === '') {
      return defaultValue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${key} must be a positive number or 0`);
    }
    return value;
  }

  /**
   * Handler for `GET <path>/product?id=<ASIN>` or `?keyword=<text>`.
   * `id` takes precedence when both are given. Never rejects: every error becomes an HTTP response.
   */
  public async setProductEndpoint(req: Request, res: Response): Promise<void> {
    try {
      const params: ProductParams = this.parse(productQuerySchema, req);
      this.logRequest(req, params);

      if (params.id) {
        await this.handleProductById(params.id, req, res);
      } else if (params.keyword) {
        await this.handleProductByKeyword(params.keyword, req, res);
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
  private async fetchBatchFromAmazon(ids: string[]): Promise<Map<string, Product | null>> {
    if (!this.breaker.tryAcquire()) {
      throw new AmazonError('unavailable', 'Circuit breaker open, Amazon API not called', {
        retryAfter: this.breaker.retryAfterSeconds()
      });
    }

    let found: Map<string, Product>;
    try {
      found = await this.withTimeout(this.paapi.getItemsApi(ids), AmwApi.REQUEST_TIMEOUT);
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
    
    this.log.info(`GET /product | id=${params.id || 'none'} | keyword=${params.keyword || 'none'} | IP=${ip} | Referer=${referer}`);
  }

  private async handleProductById(id: string, req: Request, res: Response): Promise<void> {
    await this.handleProduct('id', id, () => this.paapi.getItemApi(id), req, res);
  }

  private async handleProductByKeyword(keyword: string, req: Request, res: Response): Promise<void> {
    await this.handleProduct('keyword', keyword, () => this.paapi.searchItemApi(keyword), req, res);
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
    res: Response
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

    if (await this.isKnownMissing(type, value)) {
      this.sendNotFoundResponse(res, cacheKey);
      record('notfound');
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
      this.sendNotFoundResponse(res, cacheKey);
      record('notfound');
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
      product = await this.withTimeout(lookup(), AmwApi.REQUEST_TIMEOUT);
    } catch (error) {
      this.breaker.recordFailure();
      if (this.breaker.state === 'open') {
        this.log.warn(`Circuit breaker open: Amazon API calls suspended for ${this.breaker.retryAfterSeconds()}s`);
      }
      throw error;
    }

    // "Not found" is a valid answer: Amazon is healthy
    this.breaker.recordSuccess();
    if (product) {
      await this.saveInCache(cacheKey, product);
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
    return Math.max(0, Math.min(HTTP_CACHE_SECONDS, remaining));
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
    } else {
      this.sendError(res, 500, "Internal Server Error", "An unexpected error occurred");
    }
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
  public setWidgetEndpoint(req: Request, res: Response): void {
    this.sendWidgetFile('widget.js', AmwApi.WIDGET_CACHE_CONTROL, req, res);
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
    const root = path.join(AmwApi.PROJECT_DIR, 'dist', 'widgets');
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
        this.log.info(`Product found in cache: ${key}`);
        return JSON.parse(cachedData);
      }

      this.log.info(`Product not found in cache: ${key}`);
      return null;
    } catch (error) {
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