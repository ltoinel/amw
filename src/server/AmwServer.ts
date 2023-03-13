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
import cors from 'cors';
import { Factory } from "../utils/ConfigLog4j";
import { AmwApi } from "./AmwApi";

/**
 * AMW Server Class
 */
class AmwServer {

  // Static attributes
  private static RELEASE: string = "2.3.0";
  private static PORT: string = config.get('Server.port');
  private static RELATIVE_PATH: string = config.get('Server.path');
  private static DEBUG: string = config.get('Server.debug');
  private static CORS_ENABLED: string = config.get('Server.cors');
  private static CACHE_ENABLED: boolean = config.get('Redis.enabled');

  // Variables attributes
  private log;
  private app;
  private api;

  /**
   * Main AmwServer constructor.
   */
  constructor() {

    // Initialize the logger
    this.log = Factory.getLogger("AmwServer");

    // Initialize the express server
    this.app = express();

    // We allow CORS
    if (AmwServer.CORS_ENABLED) {
      this.app.use(cors());
    }

    // Create a new API instance
    this.api = new AmwApi();

    // Root page for documentation
    this.app.get(AmwServer.RELATIVE_PATH + '/', (req: any, res: any) => this.api.setRootEndpoint(req, res));


    // The product API endpoint
    this.app.get(AmwServer.RELATIVE_PATH + '/product', (req: any, res: any) => this.api.setProductEndpoint(req, res));
  

    // Returns a product HTML Card.
    this.app.get(AmwServer.RELATIVE_PATH + '/card', (req: any, res: any) => this.api.setCardEndpoint(req, res));
  };

  /**
   * Start the Express Webserver.
   */
  public start() {

    // Listen on the defined port, 8080 by default.
    this.app.listen(AmwServer.PORT, () => {
      this.log.info(`AMW ${AmwServer.RELEASE} is Starting ...`);
      this.log.info(`Loading ${process.env.NODE_ENV}.yaml settings`);
      this.log.info(`------------------------------------`);
      this.log.info(` |- Relative path = ${AmwServer.RELATIVE_PATH}`);
      this.log.info(` |- Redis cache = ${AmwServer.CACHE_ENABLED}`);
      this.log.info(` |- Cors = ${AmwServer.CORS_ENABLED}`);
      this.log.info(` |- Debug = ${AmwServer.DEBUG}`);
      this.log.info(`------------------------------------`);
      this.log.info(`>>> AMW Server Ready : http://localhost:${AmwServer.PORT}${AmwServer.RELATIVE_PATH}`);
    });
  }

}

export { AmwServer };