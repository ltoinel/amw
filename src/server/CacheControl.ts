/**
 * Cache-Control helpers, set per route rather than globally.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { NextFunction, Request, Response } from "express";

/**
 * Default for every response: a shared cache (CDN, proxy) must never keep an error, a rate-limit
 * answer or a health probe, otherwise a transient failure would be replayed for days.
 * Routes opt in to caching with setPublicCache() once they know the response is a success.
 */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function setPublicCache(res: Response, maxAge: number): void {
  res.set('Cache-Control', `public, max-age=${maxAge}`);
}

/** Route-level variant of setPublicCache() for responses that cannot fail after this point. */
function publicCache(maxAge: number) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    setPublicCache(res, maxAge);
    next();
  };
}

function setNoStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

export { noStore, setNoStore, setPublicCache, publicCache };
