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
   * Set the API Search endpoint.
   * @param req The request object.
   * @param res The response object.
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
   * Return the response about the product.
   *
   * @param product
   * @param req
   * @param res
   * @returns
   */

  private returnResponse(product: any, req: any, res: any) {

   
    // We return the right result
    if (productFound){
      res.json(product);
    } else {
      res.status(404).json("Product Not found");
    }

    return;
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