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
import expressRedisCache from "express-redis-cache";
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
  private cache;

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

    // If redis cache is enabled
    if (AmwServer.CACHE_ENABLED) {
      this.cache = expressRedisCache({
        host: config.get('Redis.host'),
        port: config.get('Redis.port'),
        auth_pass: config.get('Redis.password'),
        expire: config.get('Redis.expire')
      });
    };

    // Create a new API instance
    this.api = new AmwApi();

    // Root page for documentation
    this.app.get(AmwServer.RELATIVE_PATH + '/', (req: any, res: any) => this.api.setRootEndpoint(req, res));

    // Returns a product description in JSON.
    if (AmwServer.CACHE_ENABLED && this.cache !== undefined) {

      // If the cache is enabled we use it !
      this.app.get(AmwServer.RELATIVE_PATH + '/product', this.cache.route(), (req: any, res: any) => this.api.setProductEndpoint(req, res));

    } else {

      // The cache is disabled, we dont use it !
      this.app.get(AmwServer.RELATIVE_PATH + '/product', (req: any, res: any) => this.api.setProductEndpoint(req, res));
    }

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