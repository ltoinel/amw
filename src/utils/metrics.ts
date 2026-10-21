/**
 * Prometheus metrics (prom-client), exposed at `<path>/metrics` when Server.metrics is enabled.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { Request, RequestHandler } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export type AmazonOperation = "getItems" | "searchItems";
export type AmazonOutcome = "found" | "not_found" | "error";
export type CacheResult = "hit" | "miss" | "error";

// Unmatched URLs (scanners, typos) share one label value: raw paths would create unbounded series
const UNMATCHED_ROUTE = "unmatched";

/**
 * Metrics are always recorded (a counter increment is negligible) so that call sites need no
 * enabled checks; only the endpoint and the process metrics depend on Server.metrics.
 * A dedicated registry, rather than prom-client's global one, lets tests build isolated instances.
 */
export class Metrics {
  public readonly registry = new Registry();

  private readonly httpRequests = new Counter({
    name: "amw_http_requests_total",
    help: "HTTP requests by route and status code",
    labelNames: ["method", "route", "status"] as const,
    registers: [this.registry],
  });

  private readonly httpDuration = new Histogram({
    name: "amw_http_request_duration_seconds",
    help: "HTTP request duration by route and status code",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  private readonly amazonDuration = new Histogram({
    name: "amw_amazon_request_duration_seconds",
    help: "Amazon Creators API call duration by operation and outcome (found, not_found, error)",
    labelNames: ["operation", "outcome"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  private readonly cacheLookups = new Counter({
    name: "amw_cache_lookups_total",
    help: "Redis product cache lookups by result (hit, miss, error)",
    labelNames: ["result"] as const,
    registers: [this.registry],
  });

  private readonly rateLimitRejections = new Counter({
    name: "amw_rate_limit_rejections_total",
    help: "Requests rejected by the per-IP rate limiter",
    labelNames: ["route"] as const,
    registers: [this.registry],
  });

  public enableProcessMetrics(): void {
    collectDefaultMetrics({ register: this.registry, prefix: "amw_" });
  }

  /** Records every response, including errors and 404s, once it has been sent. */
  public httpMiddleware(): RequestHandler {
    return (req, res, next) => {
      const stopTimer = this.httpDuration.startTimer();
      res.on("finish", () => {
        const labels = { method: req.method, route: Metrics.routeOf(req), status: String(res.statusCode) };
        this.httpRequests.inc(labels);
        stopTimer(labels);
      });
      next();
    };
  }

  /** Times an Amazon call; `classify` maps its result to an outcome, a rejection counts as an error. */
  public async observeAmazonCall<T>(operation: AmazonOperation, call: () => Promise<T>, classify: (result: T) => AmazonOutcome): Promise<T> {
    const stopTimer = this.amazonDuration.startTimer({ operation });
    try {
      const result = await call();
      stopTimer({ outcome: classify(result) });
      return result;
    } catch (error) {
      stopTimer({ outcome: "error" });
      throw error;
    }
  }

  public recordCacheLookup(result: CacheResult): void {
    this.cacheLookups.inc({ result });
  }

  public recordRateLimitRejection(req: Request): void {
    this.rateLimitRejections.inc({ route: Metrics.routeOf(req) });
  }

  // The matched route pattern (e.g. /amw/product), never the raw URL with its query string
  private static routeOf(req: Request): string {
    return req.route?.path ? `${req.baseUrl}${req.route.path}` : UNMATCHED_ROUTE;
  }
}

export const metrics = new Metrics();
