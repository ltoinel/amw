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
import { setPublicCache } from "./CacheControl";
import { CircuitBreaker, RequestCoalescer, TtlLruCache } from "./Resilience";
import { getLogger } from "../utils/ConfigLog4j";
import { Redis } from "ioredis";
import { Logger } from "typescript-logging-log4ts-style";
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
  // Bounds the in-memory not-found cache used when Redis is disabled
  private static readonly MEMORY_NOT_FOUND_ENTRIES: number = 1000;
  private static readonly MAX_KEYWORD_LENGTH: number = 100;
  private static readonly MAX_ID_LENGTH: number = 50;
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
    // The resilience settings are optional so that existing configuration files keep working
    this.staleTtl = AmwApi.optionalNumber('Redis.staleExpire', 604800);
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
      const params = this.validateAndExtractParams(req);
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
   * @throws ValidationError when no usable `id` or `keyword` is provided.
   */
  private validateAndExtractParams(req: Request): ProductParams {
    const { id, keyword } = req.query;

    if (!id && !keyword) {
      throw new ValidationError('Missing required parameter: id or keyword');
    }

    // Repeated parameters (?id=a&id=b) are parsed as arrays by Express
    if (id && typeof id !== 'string') {
      throw new ValidationError('Parameter id must be a string');
    }

    if (keyword && typeof keyword !== 'string') {
      throw new ValidationError('Parameter keyword must be a string');
    }

    if (id && id.length > AmwApi.MAX_ID_LENGTH) {
      throw new ValidationError(`ID too long (max ${AmwApi.MAX_ID_LENGTH} characters)`);
    }

    if (keyword && keyword.length > AmwApi.MAX_KEYWORD_LENGTH) {
      throw new ValidationError(`Keyword too long (max ${AmwApi.MAX_KEYWORD_LENGTH} characters)`);
    }

    const sanitizedParams: ProductParams = {};
    if (id) {
      sanitizedParams.id = this.sanitizeInput(id as string);
    }
    if (keyword) {
      sanitizedParams.keyword = this.sanitizeInput(keyword as string);
    }

    // Sanitization may leave nothing usable (e.g. "?id=%20")
    if (!sanitizedParams.id && !sanitizedParams.keyword) {
      throw new ValidationError('Missing required parameter: id or keyword');
    }

    return sanitizedParams;
  }

  /**
   * Strips control characters (log injection) and HTML-significant characters.
   * Values are never interpolated into HTML or shell, this is defence in depth.
   */
  private sanitizeInput(input: string): string {
    // eslint-disable-next-line no-control-regex
    return input.replace(/[\x00-\x1f\x7f<>"']/g, '').trim();
  }

  private logRequest(req: Request, params: ProductParams): void {
    // req.ip honours the Server.trustProxy setting, so X-Forwarded-For cannot be spoofed
    const ip = req.ip || 'unknown';
    const referer = this.sanitizeInput(req.get('referer') || '') || 'none';
    
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

    const cachedProduct = await this.findInCache(cacheKey);
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
   * when Amazon is down. Entries without a timestamp predate this rule and expire with their key.
   */
  private isFresh(product: Product): boolean {
    return typeof product.timestamp !== 'number' || Date.now() - product.timestamp < this.ttl * 1000;
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
    // Only successes are cacheable: errors keep the no-store default set by AmwServer
    setPublicCache(res);
    res.status(200).json(product);
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
      await this.cache.set(key, JSON.stringify(product), 'EX', this.ttl + this.staleTtl);
    } catch (error) {
      this.log.error(`Error saving to cache for key ${key}:`, error);
    }
  }
}

export { AmwApi };