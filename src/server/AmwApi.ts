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
import { Paapi } from "./Paapi";
import { getLogger } from "../utils/ConfigLog4j";
import { Redis } from "ioredis";
import { Logger } from "typescript-logging-log4ts-style";

/**
 * API Implementation.
 */
class AmwApi {

  // Static attributes
  private static PROJECT_DIR: string = config.get('Server.projectDir');

  // Variables attributes
  private log: Logger
  private paapi: Paapi;
  private cache: Redis;
  private ttl: number = config.get('Redis.expire');

  /**
   * Main AmwServer constructor.
   */
  constructor(cache: Redis) {

    // Initialize the logger.
    this.log = getLogger("AmwApi");

    // The cache to optimize the API calls to Amazon.
    this.cache = cache;

    // Initialize the Paapi client.
    this.paapi = new Paapi();

  };

  /**
   * Set the API Search endpoint.
   *
   * @param req The request object.
   * @param res The response object.
   */
  public async setProductEndpoint(req: any, res: any) {

    // Debug
    this.log.info(`GET /product | id=${req.query.id} | keyword=${req.query.keyword}`);

    // Search a product by ID
    if (req.query.id) {

      var productFound = await this.findInCache(req.query.id, req, res)

      if (!productFound) {

        // We get the Item information on Amazon API
        this.paapi.getItemApi(req.query.id).then(product => this.returnResponse(req.query.id, product, req, res, true));

      }

      // Search a product by keyword
    } else if (req.query.keyword) {

      var productFound = await this.findInCache(req.query.id, req, res)

      if (!productFound) {

        // We search the Item information on Amazon API
        this.paapi.searchItemApi(req.query.keyword).then(product => this.returnResponse(req.query.keyword, product, req, res, true));
      }

    }
  }

  /**
   * Return the response about the product.
   *
   * @param key The key to find in the cache.
   * @param product The product to return.
   * @param req The request object.
   * @param res The response object.
   * @returns The product
   */
  private returnResponse(key: string, product: any, req: any, res: any, saveInCache: boolean) {

    // We return the result only if it has been found
    if (product !== undefined && product !== null) {
      if (saveInCache) {
        this.saveInCache(key, product);
      }
      res.json(product);

    } else {
      // We log that the product has not been found
      this.log.info(`Product not found in Paapi : ${req.query.id} | ${req.query.keyword}`);
      res.status(404).json("Product Not found");
    }

    return;
  }

  /**
   * Set the API Card endpoint.
   *
   * @param req The request object.
   * @param res The response object.
   */
  public setCardEndpoint(req: any, res: any) {

    this.log.info(`GET /card | id=${req.query.id} | keyword=${req.query.keyword}`);
    res.sendFile(path.join(AmwApi.PROJECT_DIR + '/resources/html/card.html'));
  }

  /**
   * Set the Test Page endpoint.
   *
   * @param req The request object.
   * @param res The response object.
   */
  public setRootEndpoint(req: any, res: any) {

    res.sendFile(path.join(AmwApi.PROJECT_DIR + '/resources/html/home.html'));
  }

  /**
   * Find the product in the cache.
   *
   * @param key The key to find in the cache.
   * @param req The request object.
   * @param res The response object.
   * @returns True if the product has been found in the cache. False otherwise.
   */
  private async findInCache(key: string, req: any, res: any) {
    if (this.cache !== undefined) {
      const cachedData = await this.cache.get(key);
      if (cachedData) {
        this.log.info(`Product found in cache : ${key}`);
        this.returnResponse(key, JSON.parse(cachedData), req, res, false)
        return true;
      }

      this.log.info(`Product not found in cache : ${key}`);
    }
    return false;
  }

  /**
   * Save the product in the cache.
   * 
   * @param key The key to save in the cache.
   * @param product The product to save.
   */
  private saveInCache(key: string, product: any) {
    // We save the response if the cache is enabled
    if (this.cache !== undefined) {
      this.log.info(`Saving product in cache : ${key}`);
      this.cache.set(key, JSON.stringify(product), 'EX', this.ttl);
    } else {
      this.log.info(`Cache is disabled, we dont save the product : ${key}`);
    }
  }
}

export { AmwApi };