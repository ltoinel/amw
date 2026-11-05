/**
 * Reads the title of a page of an allowed site, for the product recommendations.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { MAX_TITLE_LENGTH, sanitizeTitle } from "./Schemas";

type FetchPage = (url: string, init: RequestInit) => Promise<Response>;

/** The page could not be read for now: unlike a missing page, this is worth retrying. */
class PageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageFetchError';
  }
}

const FETCH_TIMEOUT = 5 * 1000;
const MAX_REDIRECTS = 3;
// The title sits at the top of the page: there is no need to hold a whole document in memory
const MAX_BYTES = 256 * 1024;
const USER_AGENT = 'AmazonModernWidgets (+https://github.com/ltoinel/amw)';

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (entity, decimal, hex, name) => {
    if (name) {
      return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    }
    const code = decimal ? Number(decimal) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/**
 * The og:title first: <title> usually carries the name of the site as well.
 * @returns null when the page has no usable title.
 */
function extractTitle(html: string): string | null {
  let raw: string | undefined;
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (/\b(?:property|name)\s*=\s*["']og:title["']/i.test(tag)) {
      const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
      raw = content?.[1] ?? content?.[2];
      break;
    }
  }
  raw = raw?.trim() ? raw : /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const title = raw ? sanitizeTitle(decodeEntities(raw)).slice(0, MAX_TITLE_LENGTH) : '';
  return title || null;
}

/** Stops at </head> or MAX_BYTES, and releases the connection either way. */
async function readHead(response: Response): Promise<string> {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  try {
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(html)) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return html;
}

/**
 * The URL comes from a client's Referer, so this is a server-side request to an address a client
 * chose: redirects are followed by hand, as an allowed page must not lead AMW anywhere else.
 *
 * @param isAllowed Applied to each redirect target; the caller has checked `url` itself.
 * @returns The title, or null when the page has none (missing page, not HTML, blocked redirect).
 * @throws PageFetchError when the site cannot answer for now.
 */
async function fetchPageTitle(url: URL, isAllowed: (target: URL) => boolean, fetchPage: FetchPage): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetchPage(current.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
      });
    } catch (error) {
      throw new PageFetchError(`Cannot reach ${current.href}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      let target: URL;
      try {
        target = new URL(location, current);
      } catch {
        return null;
      }
      if (!isAllowed(target)) {
        return null;
      }
      current = target;
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new PageFetchError(`${current.href} answered HTTP ${response.status}`);
    }
    if (!response.ok || !/\bhtml\b/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return null;
    }
    return extractTitle(await readHead(response));
  }
  return null;
}

export { fetchPageTitle, extractTitle, PageFetchError };
export type { FetchPage };
