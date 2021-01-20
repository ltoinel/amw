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
import { Factory } from "../utils/ConfigLog4j";
import "reflect-metadata";
import {createConnection} from "typeorm";
import {Product} from "../entity/Product";

/**
 * API Implementation.
 */
class AmwApi {

  // Static attributes
  private static PROJECT_DIR: string = config.get('Server.projectDir');

  // Variables attributes
  private log;
  private paapi;

  /**
   * Main AmwServer constructor.
   */
  constructor() {

    // Initialize the logger
    this.log = Factory.getLogger("AmwApi");

    // Initialize the Paapi client
    this.paapi = new Paapi();
  };

  /**
   * Set the product API Endpoint.
   * @param req
   * @param res
   */
  public setProductEndpoint(req: any, res: any) {

    // Debug
    this.log.info(`GET /product | id=${req.query.id} | keyword=${req.query.keyword}`);

    // We get the product or search it
    if (req.query.id) {

      // We get the Item information on Amazon API
      this.paapi.getItemApi(req.query.id).then(product => this.returnResponse(product, req, res));

    } else if (req.query.keyword) {

      // We search the Item information on Amazon API
      this.paapi.searchItemApi(req.query.keyword).then(product => this.returnResponse(product, req, res));
    }
  }

  /**
   * Return a response to the caller.
   *
   * @param product
   * @param req
   * @param res
   */
  private returnResponse(product: any, req: any, res: any) {

    const productFound: boolean = (product !== undefined && product !== null);

    // We save and log the status
    if (req.query.id) {
      this.log.warn(`Product id found : ${req.query.id}`);
      this.saveProductStatus("id", req.query.id, productFound);
    } else if (req.query.keyword){
      this.log.warn(`Product keyword found : ${req.query.keyword}`);
      this.saveProductStatus("keyword", req.query.keyword, productFound);
    }

    // We return the right result
    if (productFound){
      res.json(product);
    } else {
      res.status(404).json("Product Not found");
    }

    return;
  }

  /**
   * Save the product status
   */
  private saveProductStatus(type: string, key: string, available: boolean){

    createConnection().then(async connection => {

      const product = new Product();
      product.type = type;
      product.key = key;
      product.available = available;
      await connection.manager.save(product);

    }).catch(error => this.log.error(`SQL error : ${error}`));
  }

  /**
   * Set the API Card endpoint.
   */
  public setCardEndpoint(req: any, res: any) {

    this.log.info(`GET /card | id=${req.query.id} | keyword=${req.query.keyword}`);
    res.sendFile(path.join(AmwApi.PROJECT_DIR + '/resources/html/card.html'));
  }

  /**
   * Set the Test Page endpoint.
   */
  public setRootEndpoint(req: any, res: any) {

    res.sendFile(path.join(AmwApi.PROJECT_DIR + '/resources/html/home.html'));
  }


}

export { AmwApi };