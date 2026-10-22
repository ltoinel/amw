/**
 * HTTP server: Express setup, Redis connection, routes and lifecycle.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import express, { Request, Response } from "express";
import cors from 'cors';
import compression from 'compression';
import Redis from 'ioredis';
import { rateLimit } from "express-rate-limit";
import { createRequestLogger, getLogger, Logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { AmwApi } from "./AmwApi";
import { buildOpenApiSpec } from "./OpenApi";
import { AdminApi } from "./AdminApi";
import { Stats, createClickHandler } from "./Stats";
import { noStore, publicCache, setNoStore } from "./CacheControl";
import { loadSettings, Settings } from "./Settings";
import { Server } from 'http';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Wires configuration, Redis and the API handlers into an Express application.
 */
class AmwServer {

  // package.json is the single source of truth (bumped by release-it). It is read at runtime because it
  // sits outside tsc's rootDir; the relative path is the same from src/server and dist/server.
  private static readonly RELEASE: string =
    JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version;

  private readonly settings: Settings;
  private log : Logger;
  private app : express.Application;
  private api : AmwApi;
  private stats : Stats;
  private admin? : AdminApi;
  private cache : Redis;
  private server?: Server;

  /**
   * Builds the application without listening; call start() to accept connections.
   * @param settings Read from the configuration files when omitted.
   * @throws Error on invalid configuration.
   */
  constructor(settings?: Settings) {
    try {
      // The logger comes first so that a configuration error can be logged by the catch below
      this.initializeLogger();
      this.settings = settings ?? loadSettings();
      this.initializeExpress();
      this.initializeRedis();
      this.initializeApi();
      this.setupRoutes();
      this.setupErrorHandling();
    } catch (error) {
      this.log.error('Failed to initialize AMW Server:', error);
      throw error;
    }
  }

  private initializeLogger(): void {
    this.log = getLogger("AmwServer");
    this.log.info("Logger initialized successfully");
  }

  private initializeExpress(): void {
    this.app = express();
    this.app.disable('x-powered-by');
    this.app.set('trust proxy', this.settings.server.trustProxy);
    // First middleware, so that every later log line and every response carries the request id
    // Polled every few seconds by Docker and Prometheus: logging them would drown the useful lines
    this.app.use(createRequestLogger([`${this.settings.server.path}/health`, `${this.settings.server.path}/metrics`]));
    this.app.use(metrics.httpMiddleware());

    // Brotli when the client accepts it, gzip otherwise: the minified widget shrinks about 3.5x.
    // Responses that already carry a Content-Encoding are passed through untouched, and
    // Vary: Accept-Encoding is set so that shared caches keep one variant per encoding.
    this.app.use(compression());

    if (this.settings.server.cors) {
      this.app.use(cors());
      this.log.info("CORS enabled");
    }

    // Registered before the routes so that errors, rate-limit answers and /health are never cached;
    // successful product and widget responses override it
    this.app.use(noStore);

    this.log.info("Express application initialized");
  }

  /**
   * Creates the Redis client without connecting (lazyConnect); start() opens the connection.
   */
  private initializeRedis(): void {
    if (this.settings.redis.enabled) {
      try {
        this.cache = new Redis({
          host: this.settings.redis.host,
          port: this.settings.redis.port,
          username: this.settings.redis.username,
          password: this.settings.redis.password,
          // Fail cache commands quickly so a Redis outage only degrades to direct Amazon calls
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

      } catch (error: unknown) {
        this.log.error('Failed to initialize Redis:', error);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Redis initialization failed: ${message}`,
          { cause: error }
        );
      }
    } else {
      this.log.info("Redis cache is disabled");
    }
  }

  private initializeApi(): void {
    this.stats = new Stats(this.cache);
    this.api = new AmwApi(this.cache, this.stats, this.settings);
    this.admin = AdminApi.fromSettings(this.stats, this.settings);
    this.log.info("API instance created");
  }

  private setupRoutes(): void {
    const basePath = this.settings.server.path;
    
    // Rate limited per client IP: every cache miss consumes the Amazon API quota.
    // /product and /products share the limiter, a batch counting as one request.
    const productLimiter = rateLimit({
      windowMs: 60 * 1000,
      limit: this.settings.server.rateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res, _next, options) => {
        metrics.recordRateLimitRejection(req);
        res.status(options.statusCode).send(options.message);
      }
    });
    this.app.get(`${basePath}/product`, productLimiter, (req: Request, res: Response) => {
      this.api.setProductEndpoint(req, res);
    });
    this.app.get(`${basePath}/products`, productLimiter, (req: Request, res: Response) => {
      this.api.setProductsEndpoint(req, res);
    });

    // Click beacon sent by the widget (no body, the ASIN is in the query string)
    const clickLimiter = rateLimit({
      windowMs: 60 * 1000,
      limit: this.settings.server.clickRateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false
    });
    this.app.post(`${basePath}/click`, clickLimiter, createClickHandler(this.stats));

    if (this.admin) {
      this.app.use(`${basePath}/admin`, this.admin.router());
      this.log.info(`Admin enabled at ${basePath}/admin (statistics ${this.stats.enabled ? 'enabled' : 'disabled: Redis is required'})`);
    }

    this.app.get(`${basePath}/widget.js`, publicCache(this.settings.server.httpCache), (req: Request, res: Response) => {
      this.api.setWidgetEndpoint(req, res);
    });

    this.app.get(`${basePath}/widget.css`, (req: Request, res: Response) => {
      this.api.setWidgetCssEndpoint(req, res);
    });

    // Content-hashed copies emitted by the build (widget.<hash>.js|css), cached as immutable
    const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionedWidget = new RegExp(`^${escapedBasePath}/(widget\\.[0-9a-f]{10}\\.(?:js|css))$`);
    this.app.get(versionedWidget, (req: Request, res: Response) => {
      this.api.setVersionedWidgetEndpoint(req, res);
    });

    this.app.get(`${basePath}/widget-manifest.json`, (req: Request, res: Response) => {
      this.api.setWidgetManifestEndpoint(req, res);
    });

    // Used by the Docker HEALTHCHECK
    this.app.get(`${basePath}/health`, (req: Request, res: Response) => {
      const healthStatus = {
        status: 'ok',
        version: AmwServer.RELEASE,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        redis: this.settings.redis.enabled ? (this.cache && this.cache.status === 'ready' ? 'connected' : 'disconnected') : 'disabled'
      };
      
      res.status(200).json(healthStatus);
    });

    if (this.settings.server.swagger) {
      this.setupSwaggerRoutes(basePath);
    }

    if (this.settings.server.metrics) {
      this.setupMetricsRoute(basePath);
    }

    this.app.get(`${basePath}/info`, (req: Request, res: Response) => {
      const endpoints = [
        `${basePath}/product`,
        `${basePath}/products`,
        `${basePath}/click`,
        `${basePath}/widget.js`,
        `${basePath}/health`,
        `${basePath}/info`
      ];
      if (this.settings.server.swagger) {
        endpoints.push(`${basePath}/openapi.json`, `${basePath}/docs/`);
      }
      if (this.settings.server.metrics) {
        endpoints.push(`${basePath}/metrics`);
      }
      const serverInfo = {
        name: 'Amazon Modern Widgets (AMW)',
        version: AmwServer.RELEASE,
        author: 'Ludovic Toinel',
        source: 'https://github.com/ltoinel/amw',
        endpoints
      };
      
      res.status(200).json(serverInfo);
    });

    this.log.info(`Routes configured with base path: ${basePath}`);
  }

  /**
   * Expose the OpenAPI document and Swagger UI (only called when Server.swagger is true).
   */
  private setupSwaggerRoutes(basePath: string): void {
    // Loaded lazily so that a disabled Swagger UI costs neither memory nor attack surface
    const swaggerUi: typeof import('swagger-ui-express') = require('swagger-ui-express');

    const spec = buildOpenApiSpec({
      basePath,
      version: AmwServer.RELEASE,
      rateLimit: this.settings.server.rateLimit,
      httpCache: this.settings.server.httpCache,
      clickRateLimit: this.settings.server.clickRateLimit
    });
    const specPath = `${basePath}/openapi.json`;
    const docsPath = `${basePath}/docs`;

    this.app.get(specPath, (req: Request, res: Response) => {
      res.status(200).json(spec);
    });

    // The UI loads its assets with "./" relative URLs, which only resolve under a trailing slash.
    // Non-strict routing also matches "/docs/" here, hence the explicit check to avoid a loop.
    this.app.get(docsPath, (req: Request, res: Response, next: express.NextFunction) => {
      if (req.originalUrl.split('?')[0].endsWith('/')) {
        next();
        return;
      }
      res.redirect(301, `${docsPath}/`);
    });

    // Swagger UI only needs same-origin resources; inline styles are required by its React renderer
    this.app.use(docsPath, (req: Request, res: Response, next: express.NextFunction) => {
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
      next();
    });

    this.app.use(docsPath, swaggerUi.serve, swaggerUi.setup(undefined, {
      customSiteTitle: 'AMW API',
      swaggerOptions: {
        // Forcing the spec URL ignores any ?url= query parameter, so the page cannot be
        // pointed at a third-party document
        url: specPath,
        queryConfigEnabled: false,
        // The default validator badge would send the spec to validator.swagger.io
        validatorUrl: null
      }
    }));

    this.log.info(`Swagger UI enabled at ${docsPath}/ (OpenAPI document: ${specPath})`);
  }

  private setupMetricsRoute(basePath: string): void {
    metrics.enableProcessMetrics();
    this.app.get(`${basePath}/metrics`, async (req: Request, res: Response) => {
      // A scrape must always see current values, whatever Server.httpCache says
      setNoStore(res);
      res.type(metrics.registry.contentType);
      res.send(await metrics.registry.metrics());
    });
    this.log.info(`Prometheus metrics enabled at ${basePath}/metrics`);
  }

  /**
   * Registered after the routes, as Express requires.
   */
  private setupErrorHandling(): void {
    // Error message is only exposed in debug mode
    this.app.use((error: Error, req: Request, res: Response, _next: express.NextFunction) => {
      this.log.error(`Unhandled error: ${error.message}`, error);
      
      if (!res.headersSent) {
        // The route may already have marked the response as cacheable
        setNoStore(res);
        res.status(500).json({
          error: 'Internal Server Error',
          message: this.settings.server.debug ? error.message : 'Something went wrong',
          timestamp: new Date().toISOString()
        });
      }
    });

    this.app.use((req: Request, res: Response) => {
      setNoStore(res);
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });

    this.log.info("Error handling middleware configured");
  }

  /**
   * SIGTERM comes from Docker stop, SIGINT from Ctrl+C, SIGUSR2 from nodemon-style restarts.
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
   * Stops accepting connections, lets in-flight requests finish, then closes Redis and exits.
   */
  private async gracefulShutdown(): Promise<void> {
    try {
      this.log.info('Starting graceful shutdown...');
      
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => {
            this.log.info('HTTP server closed');
            resolve();
          });
        });
      }
      
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
   * Express application, exposed so that tests can drive it without opening a port.
   */
  public getApp(): express.Application {
    return this.app;
  }

  /**
   * Connects to Redis (when enabled) before listening, so the first requests can use the cache.
   * @throws Error if Redis cannot be reached.
   */
  public async start(): Promise<void> {
    try {
      if (this.settings.redis.enabled && this.cache) {
        await this.cache.connect();
        this.log.info('Redis connection established');
      }

      const server = this.app.listen(this.settings.server.port, () => {
        this.log.info(`AMW ${AmwServer.RELEASE} is Starting ...`);
        this.log.info(`Loading ${process.env.NODE_ENV || 'production'}.yaml settings`);
        this.log.info(`------------------------------------`);
        this.log.info(` |- Port = ${this.settings.server.port}`);
        this.log.info(` |- Relative path = ${this.settings.server.path}`);
        this.log.info(` |- Redis cache = ${this.settings.redis.enabled}`);
        this.log.info(` |- CORS = ${this.settings.server.cors}`);
        this.log.info(` |- Debug = ${this.settings.server.debug}`);
        this.log.info(` |- HTTP Cache = ${this.settings.server.httpCache}s`);
        this.log.info(` |- Swagger UI = ${this.settings.server.swagger}`);
        this.log.info(` |- Metrics = ${this.settings.server.metrics}`);
        this.log.info(`------------------------------------`);
        this.log.info(`>>> AMW Server Ready: http://localhost:${this.settings.server.port}${this.settings.server.path}`);
        this.log.info(`>>> Health Check: http://localhost:${this.settings.server.port}${this.settings.server.path}/health`);
        if (this.settings.server.swagger) {
          this.log.info(`>>> Swagger UI: http://localhost:${this.settings.server.port}${this.settings.server.path}/docs/`);
        }
      });

      // Typically EADDRINUSE: nothing to recover, let the orchestrator restart us
      server.on('error', (error: Error) => {
        this.log.error(`Server error: ${error.message}`, error);
        // eslint-disable-next-line no-process-exit
        process.exit(1);
      });

      this.server = server;

      // Registered here rather than in the constructor: only a listening server owns the process signals
      this.setupGracefulShutdown();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error(`Failed to start server: ${errorMessage}`, error);
      throw error;
    }
  }

}

export { AmwServer };
