/**
 * API Implementation.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

// Lets import our required libraries
import config from "config";
import path from "path";
import { Request, Response } from "express";
import { Paapi } from "./Paapi";
import { getLogger } from "../utils/ConfigLog4j";
import { Redis } from "ioredis";
import { Logger } from "typescript-logging-log4ts-style";

// Interfaces for type safety
interface ProductParams {
  id?: string;
  keyword?: string;
}

interface ErrorResponse {
  error: string;
  message: string;
  timestamp: string;
}

// Custom error classes
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * API Implementation.
 */
class AmwApi {

  // Static attributes
  private static readonly PROJECT_DIR: string = config.get('Server.projectDir');
  private static readonly CACHE_KEY_PREFIX: string = 'amw:product:';
  private static readonly MAX_KEYWORD_LENGTH: number = 100;
  private static readonly MAX_ID_LENGTH: number = 50;
  private static readonly REQUEST_TIMEOUT: number = 30000; // 30 seconds

  // Variables attributes
  private readonly log: Logger;
  private readonly paapi: Paapi;
  private readonly cache: Redis | undefined;
  private readonly ttl: number;

  /**
   * Main AmwApi constructor.
   */
  constructor(cache?: Redis) {
    // Initialize the logger
    this.log = getLogger("AmwApi");

    // The cache to optimize the API calls to Amazon
    this.cache = cache;

    // Initialize the Paapi client
    this.paapi = new Paapi();

    // Get TTL configuration with fallback
    this.ttl = Number(config.get('Redis.expire')) || 3600; // 1 hour default

    // Validate configuration
    this.validateConfiguration();

    this.log.info("AmwApi initialized successfully");
  }

  /**
   * Validate configuration settings
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
   * Set the API Search endpoint.
   *
   * @param req The request object.
   * @param res The response object.
   */
  public async setProductEndpoint(req: Request, res: Response): Promise<void> {
    try {
      // Validate and extract parameters
      const params = this.validateAndExtractParams(req);
      
      // Log the request
      this.logRequest(req, params);

      // Handle product search by ID or keyword
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
   * Validate and extract request parameters
   */
  private validateAndExtractParams(req: Request): ProductParams {
    const { id, keyword } = req.query;

    // Check if at least one parameter is provided
    if (!id && !keyword) {
      throw new ValidationError('Missing required parameter: id or keyword');
    }

    // Validate parameter types
    if (id && typeof id !== 'string') {
      throw new ValidationError('Parameter id must be a string');
    }

    if (keyword && typeof keyword !== 'string') {
      throw new ValidationError('Parameter keyword must be a string');
    }

    // Validate parameter lengths
    if (id && id.length > AmwApi.MAX_ID_LENGTH) {
      throw new ValidationError(`ID too long (max ${AmwApi.MAX_ID_LENGTH} characters)`);
    }

    if (keyword && keyword.length > AmwApi.MAX_KEYWORD_LENGTH) {
      throw new ValidationError(`Keyword too long (max ${AmwApi.MAX_KEYWORD_LENGTH} characters)`);
    }

    // Sanitize parameters
    const sanitizedParams: ProductParams = {};
    if (id) {
      sanitizedParams.id = this.sanitizeInput(id as string);
    }
    if (keyword) {
      sanitizedParams.keyword = this.sanitizeInput(keyword as string);
    }

    return sanitizedParams;
  }

  /**
   * Sanitize input to prevent injection attacks
   */
  private sanitizeInput(input: string): string {
    return input.trim().replace(/[<>\"']/g, '');
  }

  /**
   * Log the incoming request
   */
  private logRequest(req: Request, params: ProductParams): void {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
    const referer = req.get('referer') || 'none';
    
    this.log.info(`GET /product | id=${params.id || 'none'} | keyword=${params.keyword || 'none'} | IP=${ip} | Referer=${referer}`);
  }

  /**
   * Handle product search by ID
   */
  private async handleProductById(id: string, req: Request, res: Response): Promise<void> {
    const cacheKey = this.generateCacheKey('id', id);
    
    // Check cache first
    const cachedProduct = await this.findInCache(cacheKey);
    if (cachedProduct) {
      this.log.info(`Product found in cache: ${id}`);
      this.sendSuccessResponse(res, cachedProduct);
      return;
    }

    // Fetch from Amazon API
    try {
      const product = await Promise.race([
        this.paapi.getItemApi(id),
        this.createTimeout(AmwApi.REQUEST_TIMEOUT)
      ]);

      await this.handleApiResponse(cacheKey, product, res);
    } catch (error) {
      this.log.error(`Error fetching product by ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Handle product search by keyword
   */
  private async handleProductByKeyword(keyword: string, req: Request, res: Response): Promise<void> {
    const cacheKey = this.generateCacheKey('keyword', keyword);
    
    // Check cache first
    const cachedProduct = await this.findInCache(cacheKey);
    if (cachedProduct) {
      this.log.info(`Product found in cache: ${keyword}`);
      this.sendSuccessResponse(res, cachedProduct);
      return;
    }

    // Fetch from Amazon API
    try {
      const product = await Promise.race([
        this.paapi.searchItemApi(keyword),
        this.createTimeout(AmwApi.REQUEST_TIMEOUT)
      ]);

      await this.handleApiResponse(cacheKey, product, res);
    } catch (error) {
      this.log.error(`Error searching product by keyword ${keyword}:`, error);
      throw error;
    }
  }

  /**
   * Handle API response and caching
   */
  private async handleApiResponse(cacheKey: string, product: any, res: Response): Promise<void> {
    if (product && product !== null && product !== undefined) {
      // Save to cache
      await this.saveInCache(cacheKey, product);
      
      // Send response
      this.sendSuccessResponse(res, product);
    } else {
      this.sendNotFoundResponse(res, cacheKey);
    }
  }

  /**
   * Generate cache key with prefix
   */
  private generateCacheKey(type: string, value: string): string {
    return `${AmwApi.CACHE_KEY_PREFIX}${type}:${value}`;
  }

  /**
   * Create timeout promise for API requests
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Request timeout after ${ms}ms`)), ms);
    });
  }

  /**
   * Send successful response with product data
   */
  private sendSuccessResponse(res: Response, product: any): void {
    res.status(200).json(product);
  }

  /**
   * Send not found response
   */
  private sendNotFoundResponse(res: Response, identifier: string): void {
    this.log.info(`Product not found in Amazon: ${identifier}`);
    res.status(404).json({
      error: "Product Not Found",
      message: `No product found for identifier: ${identifier}`,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle errors and send appropriate response
   */
  private handleError(error: any, req: Request, res: Response): void {
    this.log.error(`API Error: ${error.message}`, error);

    if (error instanceof ValidationError) {
      res.status(400).json({
        error: "Validation Error",
        message: error.message,
        timestamp: new Date().toISOString()
      });
    } else if (error.message.includes('timeout')) {
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
   * Set the API Card endpoint.
   *
   * @param req The request object.
   * @param res The response object.
   */
  public setCardEndpoint(req: Request, res: Response): void {
    try {
      res.type('text/html');
      res.sendFile(path.join(AmwApi.PROJECT_DIR, 'resources', 'card.html'));
    } catch (error) {
      this.handleError(error, req, res);
    }
  }

  /**
   * Set the Widget endpoint.
   *
   * @param req The request object.
   * @param res The response object.
   */
  public setWidgetEndpoint(req: Request, res: Response): void {
    try {
      res.type('application/javascript');
      res.sendFile(path.join(AmwApi.PROJECT_DIR, 'resources', 'widget.js'));
    } catch (error) {
      this.handleError(error, req, res);
    }
  }

  /**
   * Find the product in the cache.
   *
   * @param key The key to find in the cache.
   * @returns The cached product if found, null otherwise.
   */
  private async findInCache(key: string): Promise<any | null> {
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
   * Save the product in the cache.
   * 
   * @param key The key to save in the cache.
   * @param product The product to save.
   */
  private async saveInCache(key: string, product: any): Promise<void> {
    if (!this.cache) {
      return;
    }

    try {
      this.log.info(`Saving product in cache: ${key}`);
      await this.cache.set(key, JSON.stringify(product), 'EX', this.ttl);
    } catch (error) {
      this.log.error(`Error saving to cache for key ${key}:`, error);
      // Don't throw error, caching failure shouldn't break the request
    }
  }
}

export { AmwApi };