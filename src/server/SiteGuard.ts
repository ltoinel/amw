/**
 * Restricts the widget API to the sites of Server.allowedSites.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { NextFunction, Request, Response } from "express";
import { noStore } from "./Stats";

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Whether a page at this URL may use the API. An empty list allows every site. */
function isAllowedSite(url: string, allowedSites: string[]): boolean {
  if (allowedSites.length === 0) return true;
  const host = hostOf(url);
  return host !== undefined && allowedSites.includes(host);
}

/**
 * Rejects the requests of a browser on another site. It is no authentication: these headers can
 * be forged outside a browser, and a request without any is let through, as privacy settings
 * remove the Referer of legitimate visitors. It stops other sites from showing the cards and
 * from adding to the statistics, not someone determined to read a product.
 */
function createSiteGuard(allowedSites: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Origin first: "null" (sandboxed frame, local file) is a site that is not on the list
    const source = req.get('origin') ?? req.get('referer');
    if (source === undefined || isAllowedSite(source, allowedSites)) {
      next();
      return;
    }
    // Never stored by a CDN, where it would block the allowed sites too
    noStore(res);
    res.status(403).json({
      error: 'Forbidden',
      message: 'This site is not allowed to use the widget (Server.allowedSites)',
      timestamp: new Date().toISOString()
    });
  };
}

export { createSiteGuard, isAllowedSite };
