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
import { ExpressRedisCache } from "express-redis-cache";
import { Factory } from "../utils/ConfigLog4j";

/**
 * API Implementation.
 */
class AmwApi {

  // Is cached enabled ?
  private CACHE_ENABLED: boolean = config.get('Redis.enabled');
  private PROJECT_DIR: string =  config.get('Server.projectDir');
  private log;
  private cache;
  private paapi;

  /**
   * Main AmwServer constructor.
   */
  constructor(){
      // Initialize the logger
      this.log = Factory.getLogger("AmwApi");

      // If redis cache is enabled
      if (this.CACHE_ENABLED) {
          this.cache  =  new ExpressRedisCache({
          host: config.get('Redis.host'),
          port: config.get('Redis.port'),
          auth_pass: config.get('Redis.password'),
          expire: config.get('Redis.expire')
        });
      };

      // Initialize the Paapi client
      this.paapi = new Paapi();
  };

  /**
   * Set the product API Endpoint.
   */
  public setProductEndpoint(req: any, res: any){

    // Debug
    this.log.info(`GET /product?id=${req.query.id}&keyword=${req.query.keyword}`);

    // If the cache is enabled we use it
    if (this.CACHE_ENABLED && this.cache !== undefined) this.cache.route();

    // We get the product or search it
    if (req.query.id) {

      // We get the Item information on Amazon API
      this.paapi.getItemApi(req.query.id).then(product => this.returnResponse(product,req,res));

    } else if (req.query.keyword) {

      // We search the Item information on Amazon API
      this.paapi.searchItemApi(req.query.keyword).then(product => this.returnResponse(product,req,res));
    }
  }

  private returnResponse(product: any,req: any, res: any){

    // We return the result only if it has been found
    if (product !== undefined) {
      this.log.info("Product found");
      res.json(product);
      return;
    } else {
      this.log.warn(`Product not found : ${req.query.id} | ${req.query.keyword}`);
      res.json("Not found");
      return;
    }
  }

  /**
   * Set the API Card endpoint.
   */
  public setCardEndpoint(req: any, res: any) {

      this.log.info(`GET /card?id=${req.query.id}&keyword=${req.query.keyword}`);
      res.sendFile(path.join(this.PROJECT_DIR + '/resources/html/card.html'));
  }

}

export { AmwApi };