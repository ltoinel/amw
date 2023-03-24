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
import { createClient } from "redis";
import { Paapi } from "./Paapi";
import { Factory } from "../utils/ConfigLog4j";

/**
 * API Implementation.
 */
class AmwApi {
  // Static attributes
  private static PROJECT_DIR: string = config.get("Server.projectDir");

  // Variables attributes
  private log;
  private paapi;
  private cache;

  /**
   * Main AmwServer constructor.
   */
  constructor() {
    // Initialize the logger
    this.log = Factory.getLogger("AmwApi");

    // Initialize the Paapi client
    this.paapi = new Paapi();

    // If redis cache is enabled
    if (config.get("Redis.enabled")) {
      // We create the redis client
      this.cache = createClient({
        url: config.get("Redis.url")
      });

      this.cache.on("error", (error) => this.log.error(`Error : ${error}`));
    }
  }

  /**
   * Get the product from the cache.
   * @param id The product id.
   * @returns The product.
   * @returns null if the product is not in the cache.
   * @returns null if the cache is not enabled.
   */
  public getProductFromCache(id: string) {
    if (this.cache === undefined) return null;
    const product = this.cache.get(id);
    return product;
  }

  /**
   * Save the product in the cache.
   * @param id The product id.
   * @param product The product.
   * @returns null if the cache is not enabled.
   */
  public saveProductInCache(id: string, product: any) {
    if (this.cache === undefined) return null;
    this.cache.set(id, product);
  }

  /**
   * Set the API Search endpoint.
   * @param req The request.
   * @param res The response.
   */
  public setProductEndpoint(req: any, res: any) {
    // Debug
    this.log.info(
      `GET /product | id=${req.query.id} | keyword=${req.query.keyword}`
    );

    // We initialize the product
    let product = null;

    // We get the product by ID
    if (req.query.id) {
      product = this.getProductById(req.query.id);

      // We get the product by keyword
    } else if (req.query.keyword) {
      product = this.searchProductByKeyword(req.query.keyword);
    }

    this.returnResponse(product, res);
  }

  /**
   * Get the product by its id.
   * @param id The product id.
   * @returns The product.
   */
  public async getProductById(id: string) {
    // We try to find the product in the cache
    const productFromCache = this.getProductFromCache(id);

    // The product is in the cache
    if (productFromCache) {
      return productFromCache;
    }

    // We get the Item information on Amazon API
    const product = await this.paapi.getItemApi(id);
    this.saveProductInCache(id, product);

    return product;
  }

  /**
   * Get the product by its id.
   * @param keyword The product keyword.
   * @returns The product.
   * @returns null if the product is not found.
   */
  public async searchProductByKeyword(keyword: string) {
    // We try to find the product in the cache
    const productFromCache = this.getProductFromCache(keyword);

    // The product is in the cache
    if (productFromCache) {
        return productFromCache;
    }

    // We search the Item information on Amazon API
    const product = await this.paapi.searchItemApi(keyword);
    this.saveProductInCache(keyword, product);


    return product;
  }

  /**
   * Return the response about the product.
   * @param product The product.
   * @param res The response object.
   * @returns The product.
   * @returns 404 if the product is not found.
   */
  private returnResponse(product: any, res: any) {
    // We return the result only if it has been found
    if (product !== undefined && product !== null) {
      res.json(product);
      return;
    } else {
      res.status(404).json("Product Not found");
      return;
    }
  }

  /**
   * Set the API Card endpoint.
   * @param req The request object.
   * @param res The response object.
   */
  public setCardEndpoint(req: any, res: any) {
    // Return the card HTML page
    this.log.info(
      `GET /card | id=${req.query.id} | keyword=${req.query.keyword}`
    );
    res.sendFile(path.join(AmwApi.PROJECT_DIR + "/resources/html/card.html"));
  }

  /**
   * Set the Test Page endpoint.
   * @param req The request object.
   * @param res The response object.
   */
  public setRootEndpoint(req: any, res: any) {
    // Return the home sample page
    res.sendFile(path.join(AmwApi.PROJECT_DIR + "/resources/html/home.html"));
  }
}

export { AmwApi };
