/**
 * Main Server Class
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

// Lets import our required libraries
import config from "config";
import express, { Request } from "express";
import path from "path";
import { Factory } from "../utils/ConfigLog4j";
import { AmwApi } from "./AmwApi";

/**
 * AMW Server Class
 */
class AmwServer {

  private RELEASE: string = "1.4.0";
  private PORT: string = config.get('Server.port');
  private RELATIVE_PATH: string = config.get('Server.path');
  private log;
  private app;
  private api;

  /**
   * Main AmwServer constructor.
   */
  constructor(){
      // Initialize the logger
      this.log = Factory.getLogger("AmwServer");

      // Initialize the express server
      this.app = express();

      // Create a new API instance
      this.api = new AmwApi();

      // Returns a product description in JSON.
      this.app.get(this.RELATIVE_PATH + '/product', (req: any, res: any) => this.api.setProductEndpoint(req,res));

      // Returns a product HTML Card.
      this.app.get(this.RELATIVE_PATH + '/card', (req: any, res: any) =>this.api.setCardEndpoint(req,res));
  };

  /**
   * Start the Webserver
   */
  public start(){

    // Listen on the defined port, 8080 by default.
    this.app.listen(this.PORT, () => {
      this.log.info(`AMW ${this.RELEASE} is listening on port ${this.PORT} ...`);
      this.log.info(`Loading ${process.env.NODE_ENV} settings`);
      this.log.info(`Debug is ${config.get('Server.debug')}`);
    });
  }

}

export { AmwServer };