/**
 * Mock Amazon Creators API
 * ----------------------------------------------
 * Minimal stand-in for the OAuth2 token endpoint and the catalog API, so the
 * real AMW server can be exercised end to end without Amazon credentials.
 * Response shapes follow what the amazon-creators-api SDK deserializes and
 * what Paapi.buildProduct() reads.
 */

import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';

export const MOCK_CREDENTIAL_ID = 'e2e-credential-id';
export const MOCK_CREDENTIAL_SECRET = 'e2e-credential-secret';
const MOCK_ACCESS_TOKEN = 'e2e-access-token';

// Magic item ids / keywords that make the mock simulate specific upstream behaviours
export const ASIN_NOT_FOUND = 'B0NOTFOUND';
export const ASIN_SERVER_ERROR = 'B0ERROR500';
export const ASIN_MALICIOUS = 'B0XSSPAYLO';
export const KEYWORD_NO_RESULT = 'nothingmatches';

export const MALICIOUS_TITLE = '<img src=x onerror="window.__amwXss=true">Evil product';

export interface MockAmazonApi {
  url: string;
  /** Catalog calls received so far, used to tell cache hits from upstream calls. */
  calls: { getItems: string[]; searchItems: string[] };
  close: () => Promise<void>;
}

function buildItem(asin: string, title: string) {
  return {
    asin,
    detailPageURL: `https://www.amazon.fr/dp/${asin}?tag=e2e-21&linkCode=ogi&th=1&psc=1`,
    images: {
      primary: {
        large: { url: `https://m.media-amazon.com/images/I/${asin}._SL500_.jpg`, height: 500, width: 500 }
      }
    },
    itemInfo: {
      title: { displayValue: title, label: 'Title', locale: 'fr_FR' },
      byLineInfo: { brand: { displayValue: 'E2E Brand', label: 'Brand', locale: 'fr_FR' } }
    },
    offersV2: {
      listings: [{
        price: {
          money: { amount: 49.99, currency: 'EUR', displayAmount: '49,99 €' },
          savings: { money: { amount: 10, currency: 'EUR', displayAmount: '10,00 €' }, percentage: 17 }
        }
      }]
    }
  };
}

/**
 * Realistic product data for a given ASIN, so that callers such as the
 * documentation screenshot script can show believable cards instead of the
 * generic "E2E product" items.
 */
export interface CatalogEntry {
  title: string;
  brand?: string;
  /** Formatted price; omitted means "no offer", which the widget shows as not available. */
  price?: string;
  /** Discount percentage; omitted or 0 means no savings badge. */
  savings?: number;
}

export interface MockAmazonApiOptions {
  catalog?: Record<string, CatalogEntry>;
}

function buildCatalogItem(asin: string, entry: CatalogEntry) {
  const item = buildItem(asin, entry.title);
  item.itemInfo.byLineInfo.brand.displayValue = entry.brand ?? '';
  const listing = item.offersV2.listings[0];
  listing.price.money.displayAmount = entry.price ?? '';
  listing.price.savings.percentage = entry.savings ?? 0;
  return {
    ...item,
    offersV2: {
      listings: entry.price === undefined ? [] : [{
        price: entry.savings ? listing.price : { money: listing.price.money }
      }]
    }
  };
}

function buildMaliciousItem(asin: string) {
  return {
    ...buildItem(asin, MALICIOUS_TITLE),
    detailPageURL: 'javascript:window.__amwXss=true',
    images: { primary: { large: { url: 'javascript:window.__amwXss=true', height: 500, width: 500 } } }
  };
}

function notFoundErrors(id: string) {
  return [{
    code: 'ItemNotAccessible',
    message: `The ItemId ${id} is not accessible through the Creators API.`
  }];
}

/**
 * Start the mock on a random free port.
 */
export async function startMockAmazonApi(options: MockAmazonApiOptions = {}): Promise<MockAmazonApi> {
  const catalog = options.catalog ?? {};
  const app = express();
  app.use(express.json());
  const calls: MockAmazonApi['calls'] = { getItems: [], searchItems: [] };

  // LWA (v3.x) token endpoint: JSON body, client credentials grant
  app.post('/auth/o2/token', (req, res) => {
    const { grant_type, client_id, client_secret } = req.body ?? {};
    if (grant_type !== 'client_credentials' || client_id !== MOCK_CREDENTIAL_ID || client_secret !== MOCK_CREDENTIAL_SECRET) {
      res.status(401).json({ error: 'invalid_client', error_description: 'Client authentication failed' });
      return;
    }
    res.json({ access_token: MOCK_ACCESS_TOKEN, token_type: 'bearer', expires_in: 3600 });
  });

  // Reject catalog calls that skipped the OAuth2 flow, as the real API would
  app.use('/catalog', (req, res, next) => {
    if (req.get('authorization') !== `Bearer ${MOCK_ACCESS_TOKEN}` || !req.get('x-marketplace')) {
      res.status(401).json({ errors: [{ code: 'Unauthorized', message: 'Missing or invalid credentials' }] });
      return;
    }
    next();
  });

  app.post('/catalog/v1/getItems', (req, res) => {
    const id: string = req.body?.itemIds?.[0] ?? '';
    calls.getItems.push(id);

    if (id === ASIN_SERVER_ERROR) {
      res.status(500).json({ errors: [{ code: 'InternalFailure', message: 'Internal error' }] });
    } else if (id === ASIN_NOT_FOUND) {
      res.json({ errors: notFoundErrors(id) });
    } else if (id === ASIN_MALICIOUS) {
      res.json({ itemsResult: { items: [buildMaliciousItem(id)] } });
    } else if (catalog[id]) {
      res.json({ itemsResult: { items: [buildCatalogItem(id, catalog[id])] } });
    } else {
      res.json({ itemsResult: { items: [buildItem(id, `E2E product ${id}`)] } });
    }
  });

  app.post('/catalog/v1/searchItems', (req, res) => {
    const keywords: string = req.body?.keywords ?? '';
    calls.searchItems.push(keywords);

    if (keywords === KEYWORD_NO_RESULT) {
      res.json({ errors: [{ code: 'NoResults', message: 'No results found for your request.' }] });
      return;
    }
    res.json({
      searchResult: {
        totalResultCount: 1,
        searchURL: `https://www.amazon.fr/s?k=${encodeURIComponent(keywords)}`,
        items: [buildItem('B0SEARCH01', `E2E result for ${keywords}`)]
      }
    });
  });

  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>(resolve => {
      server.closeAllConnections();
      server.close(() => resolve());
    })
  };
}
