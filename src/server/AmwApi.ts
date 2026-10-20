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
import { getLogger } from "../utils/ConfigLog4j";
import { Redis } from "ioredis";
import { Logger } from "typescript-logging-log4ts-style";

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
  private static readonly MAX_KEYWORD_LENGTH: number = 100;
  private static readonly MAX_ID_LENGTH: number = 50;
  // Upper bound on an Amazon call, so a slow upstream answers 504 instead of holding the socket
  private static readonly REQUEST_TIMEOUT: number = 30000;

  private readonly log: Logger;
  private readonly paapi: Paapi;
  private readonly cache: Redis | undefined;
  private readonly ttl: number;

  /**
   * @param cache Redis client, or undefined when caching is disabled (every request then hits Amazon).
   */
  constructor(cache?: Redis) {
    this.log = getLogger("AmwApi");
    this.cache = cache;
    this.paapi = new Paapi();
    // Cache TTL in seconds
    this.ttl = Number(config.get('Redis.expire')) || 3600;
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
    const cacheKey = this.generateCacheKey('id', id);
    
    const cachedProduct = await this.findInCache(cacheKey);
    if (cachedProduct) {
      this.log.info(`Product found in cache: ${id}`);
      this.sendSuccessResponse(res, cachedProduct);
      return;
    }

    try {
      const product = await this.withTimeout(this.paapi.getItemApi(id), AmwApi.REQUEST_TIMEOUT);

      await this.handleApiResponse(cacheKey, product, res);
    } catch (error) {
      this.log.error(`Error fetching product by ID ${id}:`, error);
      throw error;
    }
  }

  private async handleProductByKeyword(keyword: string, req: Request, res: Response): Promise<void> {
    const cacheKey = this.generateCacheKey('keyword', keyword);
    
    const cachedProduct = await this.findInCache(cacheKey);
    if (cachedProduct) {
      this.log.info(`Product found in cache: ${keyword}`);
      this.sendSuccessResponse(res, cachedProduct);
      return;
    }

    try {
      const product = await this.withTimeout(this.paapi.searchItemApi(keyword), AmwApi.REQUEST_TIMEOUT);

      await this.handleApiResponse(cacheKey, product, res);
    } catch (error) {
      this.log.error(`Error searching product by keyword ${keyword}:`, error);
      throw error;
    }
  }

  /**
   * Only found products are cached: a miss is retried against Amazon on the next request.
   * Paapi also returns null when the Amazon call fails, so upstream errors surface as 404.
   */
  private async handleApiResponse(cacheKey: string, product: Product | null, res: Response): Promise<void> {
    if (product) {
      await this.saveInCache(cacheKey, product);
      this.sendSuccessResponse(res, product);
    } else {
      this.sendNotFoundResponse(res, cacheKey);
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
      timer = setTimeout(() => reject(new Error(`Request timeout after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private sendSuccessResponse(res: Response, product: Product): void {
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
   * Maps errors to 400 (validation), 504 (timeout) or 500, without leaking internal details.
   */
  private handleError(error: unknown, req: Request, res: Response): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.log.error(`API Error: ${err.message}`, err);

    if (error instanceof ValidationError) {
      res.status(400).json({
        error: "Validation Error",
        message: err.message,
        timestamp: new Date().toISOString()
      });
    } else if (err.message.includes('timeout')) {
      res.status(504).json({
        error: "Gateway Timeout",
        message: "Request timed out while fetching product data",
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        error: "Internal Server Error",
        message: "An unexpected error occurred",
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handler for `GET <path>/widget.js`: serves the minified widget produced by `npm run build`.
   */
  public setWidgetEndpoint(req: Request, res: Response): void {
    this.sendWidgetFile('widget.js', 'application/javascript; charset=UTF-8', req, res);
  }

  /**
   * Sends a file of `dist/widgets`. Passing `root` makes send check dot segments in the file name
   * only, so the project can be installed under a dot directory (`~/.local`, `.claude/worktrees`).
   * The content type is set through `headers`, which only apply on success, so that error bodies
   * stay JSON.
   */
  private sendWidgetFile(fileName: string, contentType: string, req: Request, res: Response): void {
    const root = path.join(AmwApi.PROJECT_DIR, 'dist', 'widgets');
    try {
      res.sendFile(fileName, { root, headers: { 'Content-Type': contentType } }, (error?: Error) => {
        if (!error || res.headersSent) {
          return;
        }
        const status = (error as Error & { statusCode?: number }).statusCode;
        if (status === 404) {
          // Usually means the widgets were not built (npm run build)
          this.log.error(`Widget file not found: ${path.join(root, fileName)}`);
          res.status(404).json({
            error: "Not Found",
            message: `${fileName} is not available`,
            timestamp: new Date().toISOString()
          });
          return;
        }
        this.handleError(error, req, res);
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
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
      await this.cache.set(key, JSON.stringify(product), 'EX', this.ttl);
    } catch (error) {
      this.log.error(`Error saving to cache for key ${key}:`, error);
    }
  }
}

export { AmwApi };