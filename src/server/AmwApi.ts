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

/**
 * API Implementation.
 */
class AmwApi {

  // Static attributes
  private static PROJECT_DIR: string =  config.get('Server.projectDir');

  // Variables attributes
  private log;
  private paapi;

  /**
   * Main AmwServer constructor.
   */
  constructor(){
      // Initialize the logger
      this.log = Factory.getLogger("AmwApi");

      // Initialize the Paapi client
      this.paapi = new Paapi();
  };

  /**
   * Set the product API Endpoint.
   */
  public setProductEndpoint(req: any, res: any){

    // Debug
    this.log.info(`GET /product | id=${req.query.id} | keyword=${req.query.keyword}`);

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
    if (product !== undefined && product !== null) {
      this.log.info("Product found");
      res.json(product);
      return;
    } else {
      this.log.warn(`Product not found : ${req.query.id} | ${req.query.keyword}`);
      res.status(404).json("Product Not found");
      return;
    }
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
  public setTestEndpoint(req: any, res: any) {

    res.sendFile(path.join(AmwApi.PROJECT_DIR + '/resources/html/test.html'));
  }


}

export { AmwApi };