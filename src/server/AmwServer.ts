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
import express, { Request, Response } from "express";
import cors from 'cors';
import Redis from 'ioredis';
import cacheControl from "express-cache-controller";
import { getLogger } from "../utils/ConfigLog4j";
import { AmwApi } from "./AmwApi";
import { Logger } from "typescript-logging-log4ts-style";
import { Server } from 'http';

/**
 * AMW Server Class
 */
class AmwServer {

  // Static attributes
  private static readonly RELEASE: string = "3.0.0";
  private static readonly DEFAULT_PORT: number = 8080;
  private static readonly PORT: number = Number(config.get('Server.port')) || AmwServer.DEFAULT_PORT;
  private static readonly RELATIVE_PATH: string = config.get('Server.path') || '/amw';
  private static readonly DEBUG: boolean = config.get('Server.debug') === 'true' || config.get('Server.debug') === true;
  private static readonly CORS_ENABLED: boolean = config.get('Server.cors') === 'true' || config.get('Server.cors') === true;
  private static readonly CACHE_ENABLED: boolean = config.get('Redis.enabled') === true;
  private static readonly HTTP_CACHE: number = Number(config.get('Server.httpCache')) || 300;

  // Variables attributes
  private log : Logger;
  private app : express.Application;
  private api : AmwApi;
  private cache : Redis;
  private server?: Server;

  /**
   * Main AmwServer constructor.
   */
  constructor() {
    try {
      this.validateConfiguration();
      this.initializeLogger();
      this.initializeExpress();
      this.initializeRedis();
      this.initializeApi();
      this.setupRoutes();
      this.setupErrorHandling();
      this.setupGracefulShutdown();
    } catch (error) {
      this.log.error('Failed to initialize AMW Server:', error);
      throw error;
    }
  }

  /**
   * Validate server configuration
   */
  private validateConfiguration(): void {
    if (AmwServer.PORT < 1 || AmwServer.PORT > 65535) {
      throw new Error(`Invalid port configuration: ${AmwServer.PORT}. Must be between 1 and 65535.`);
    }

    if (!AmwServer.RELATIVE_PATH || !AmwServer.RELATIVE_PATH.startsWith('/')) {
      throw new Error(`Invalid relative path: ${AmwServer.RELATIVE_PATH}. Must start with '/'.`);
    }

    if (AmwServer.HTTP_CACHE < 0) {
      throw new Error(`Invalid HTTP cache configuration: ${AmwServer.HTTP_CACHE}. Must be >= 0.`);
    }
  }

  /**
   * Initialize logger
   */
  private initializeLogger(): void {
    this.log = getLogger("AmwServer");
    this.log.info("Logger initialized successfully");
  }

  /**
   * Initialize Express application
   */
  private initializeExpress(): void {
    this.app = express();

    // Enable CORS if configured
    if (AmwServer.CORS_ENABLED) {
      this.app.use(cors());
      this.log.info("CORS enabled");
    }

    // Configure cache control
    this.app.use(cacheControl({
      maxAge: AmwServer.HTTP_CACHE
    }));

    this.log.info("Express application initialized");
  }

  /**
   * Initialize Redis cache connection
   */
  private initializeRedis(): void {
    if (AmwServer.CACHE_ENABLED) {
      try {
        this.cache = new Redis({
          host: config.get('Redis.host'),
          port: config.get('Redis.port'),
          username: config.get('Redis.username'),
          password: config.get('Redis.password'),
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        });

        this.cache.on('connect', () => {
          this.log.info('Redis connection established');
        });

        this.cache.on('error', (error) => {
          this.log.error('Redis connection error:', error);
        });

        this.cache.on('close', () => {
          this.log.warn('Redis connection closed');
        });

      } catch (error) {
        this.log.error('Failed to initialize Redis:', error);
        throw new Error(`Redis initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      this.log.info("Redis cache is disabled");
    }
  }

  /**
   * Initialize API instance
   */
  private initializeApi(): void {
    this.api = new AmwApi(this.cache);
    this.log.info("API instance created");
  }

  /**
   * Setup application routes
   */
  private setupRoutes(): void {
    const basePath = AmwServer.RELATIVE_PATH;
    
    // Product endpoint
    this.app.get(`${basePath}/product`, (req: Request, res: Response) => {
      this.api.setProductEndpoint(req, res);
    });

    // Widget JavaScript endpoint
    this.app.get(`${basePath}/widget.js`, (req: Request, res: Response) => {
      this.api.setWidgetEndpoint(req, res);
    });

    // Health check endpoint
    this.app.get(`${basePath}/health`, (req: Request, res: Response) => {
      const healthStatus = {
        status: 'ok',
        version: AmwServer.RELEASE,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        redis: AmwServer.CACHE_ENABLED ? (this.cache && this.cache.status === 'ready' ? 'connected' : 'disconnected') : 'disabled'
      };
      
      res.status(200).json(healthStatus);
    });

    // Server info endpoint
    this.app.get(`${basePath}/info`, (req: Request, res: Response) => {
      const serverInfo = {
        name: 'Amazon Modern Widgets (AMW)',
        version: AmwServer.RELEASE,
        author: 'Ludovic Toinel',
        source: 'https://github.com/ltoinel/amw',
        endpoints: [
          `${basePath}/product`,
          `${basePath}/widget.js`,
          `${basePath}/health`,
          `${basePath}/info`
        ]
      };
      
      res.status(200).json(serverInfo);
    });

    this.log.info(`Routes configured with base path: ${basePath}`);
  }

  /**
   * Setup error handling middleware
   */
  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((error: Error, req: Request, res: Response, _next: express.NextFunction) => {
      this.log.error(`Unhandled error: ${error.message}`, error);
      
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal Server Error',
          message: AmwServer.DEBUG ? error.message : 'Something went wrong',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });

    this.log.info("Error handling middleware configured");
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        this.log.info(`Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown();
      });
    });
  }

  /**
   * Graceful shutdown handler
   */
  private async gracefulShutdown(): Promise<void> {
    try {
      this.log.info('Starting graceful shutdown...');
      
      // Close HTTP server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => {
            this.log.info('HTTP server closed');
            resolve();
          });
        });
      }
      
      // Close Redis connection if exists
      if (this.cache) {
        try {
          await this.cache.quit();
          this.log.info('Redis connection closed');
        } catch (redisError) {
          this.log.warn('Error closing Redis connection:', redisError);
        }
      }
      
      this.log.info('AMW Server shutdown completed successfully');
      // eslint-disable-next-line no-process-exit
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error(`Error during graceful shutdown: ${errorMessage}`, error);
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }
  }

  /**
   * Start the Express Webserver.
   */
  public async start(): Promise<void> {
    try {
      // Connect to Redis if enabled
      if (AmwServer.CACHE_ENABLED && this.cache) {
        await this.cache.connect();
        this.log.info('Redis connection established');
      }

      // Start the HTTP server
      const server = this.app.listen(AmwServer.PORT, () => {
        this.log.info(`AMW ${AmwServer.RELEASE} is Starting ...`);
        this.log.info(`Loading ${process.env.NODE_ENV || 'production'}.yaml settings`);
        this.log.info(`------------------------------------`);
        this.log.info(` |- Port = ${AmwServer.PORT}`);
        this.log.info(` |- Relative path = ${AmwServer.RELATIVE_PATH}`);
        this.log.info(` |- Redis cache = ${AmwServer.CACHE_ENABLED}`);
        this.log.info(` |- CORS = ${AmwServer.CORS_ENABLED}`);
        this.log.info(` |- Debug = ${AmwServer.DEBUG}`);
        this.log.info(` |- HTTP Cache = ${AmwServer.HTTP_CACHE}s`);
        this.log.info(`------------------------------------`);
        this.log.info(`>>> AMW Server Ready: http://localhost:${AmwServer.PORT}${AmwServer.RELATIVE_PATH}`);
        this.log.info(`>>> Health Check: http://localhost:${AmwServer.PORT}${AmwServer.RELATIVE_PATH}/health`);
      });

      // Handle server errors
      server.on('error', (error: Error) => {
        this.log.error(`Server error: ${error.message}`, error);
        // eslint-disable-next-line no-process-exit
        process.exit(1);
      });

      // Store server reference for graceful shutdown
      this.server = server;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error(`Failed to start server: ${errorMessage}`, error);
      throw error;
    }
  }

}

export { AmwServer };
