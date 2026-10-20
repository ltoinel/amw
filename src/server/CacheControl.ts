/**
 * Cache-Control helpers, set per route rather than globally.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import config from "config";
import { NextFunction, Request, Response } from "express";

// Cache-Control max-age in seconds for cacheable responses; 0 or unset falls back to 5 minutes
const HTTP_CACHE_SECONDS: number = Number(config.get('Server.httpCache')) || 300;

/**
 * Default for every response: a shared cache (CDN, proxy) must never keep an error, a rate-limit
 * answer or a health probe, otherwise a transient failure would be replayed for days.
 * Routes opt in to caching with setPublicCache() once they know the response is a success.
 */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function setPublicCache(res: Response, maxAge: number = HTTP_CACHE_SECONDS): void {
  res.set('Cache-Control', `public, max-age=${maxAge}`);
}

/** Route-level variant of setPublicCache() for responses that cannot fail after this point. */
function publicCache(maxAge: number = HTTP_CACHE_SECONDS) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    setPublicCache(res, maxAge);
    next();
  };
}

function setNoStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

export { HTTP_CACHE_SECONDS, noStore, setNoStore, setPublicCache, publicCache };
