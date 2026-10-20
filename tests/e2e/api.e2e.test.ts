/**
 * End-to-end tests of the HTTP API: the compiled server runs as a separate
 * process and talks to a mock Amazon Creators API over real HTTP.
 */

import fs from 'fs';
import path from 'path';
import { AmwServer, Json, PROJECT_DIR, startAmwServer } from './support/amwServer';
import {
  ASIN_MALICIOUS,
  ASIN_NOT_FOUND,
  ASIN_SERVER_ERROR,
  KEYWORD_NO_RESULT,
  MockAmazonApi,
  startMockAmazonApi
} from './support/mockAmazonApi';

describe('AMW API (e2e)', () => {
  let mock: MockAmazonApi;
  let amw: AmwServer;

  beforeAll(async () => {
    mock = await startMockAmazonApi();
    amw = await startAmwServer({ mockApiUrl: mock.url });
  });

  afterAll(async () => {
    await amw?.stop();
    await mock?.close();
  });

  describe('GET /health', () => {
    it('reports the server as up with Redis disabled', async () => {
      const response = await fetch(`${amw.baseUrl}/health`);
      const body = await response.json() as Json;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ status: 'ok', redis: 'disabled' });
      expect(typeof body.version).toBe('string');
    });
  });

  describe('GET /product', () => {
    it('returns the product built from GetItems when queried by id', async () => {
      const response = await fetch(`${amw.baseUrl}/product?id=B08N5WRWNW`);
      const product = await response.json() as Json;

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
      expect(product).toMatchObject({
        asin: 'B08N5WRWNW',
        title: 'E2E product B08N5WRWNW',
        brand: 'E2E Brand',
        price: '49,99 €',
        savings: 17,
        image: 'https://m.media-amazon.com/images/I/B08N5WRWNW._SL500_.jpg'
      });
      expect(product.url).toMatch(/^https:\/\/www\.amazon\.fr\/dp\/B08N5WRWNW\?tag=e2e-21/);
      expect(typeof product.timestamp).toBe('number');
      expect(mock.calls.getItems).toContain('B08N5WRWNW');
    });

    it('returns the first SearchItems result when queried by keyword', async () => {
      const response = await fetch(`${amw.baseUrl}/product?keyword=${encodeURIComponent('raspberry pi')}`);
      const product = await response.json() as Json;

      expect(response.status).toBe(200);
      expect(product).toMatchObject({ asin: 'B0SEARCH01', title: 'E2E result for raspberry pi', price: '49,99 €' });
      expect(mock.calls.searchItems).toContain('raspberry pi');
    });

    it('returns 404 when Amazon does not know the item', async () => {
      const response = await fetch(`${amw.baseUrl}/product?id=${ASIN_NOT_FOUND}`);
      const body = await response.json() as Json;

      expect(response.status).toBe(404);
      expect(body.error).toBe('Product Not Found');
    });

    it('returns 404 when a keyword search has no result', async () => {
      const response = await fetch(`${amw.baseUrl}/product?keyword=${KEYWORD_NO_RESULT}`);

      expect(response.status).toBe(404);
    });

    // An Amazon outage must not be mistaken for a missing product
    it('returns 502 without leaking details when the Amazon API fails with 500', async () => {
      const response = await fetch(`${amw.baseUrl}/product?id=${ASIN_SERVER_ERROR}`);
      const text = await response.text();

      expect(response.status).toBe(502);
      expect(text).not.toMatch(/InternalFailure/);
    });

    // The widget is responsible for neutralizing hostile values; the API passes them through as JSON data
    it('serves hostile product data as JSON, never as HTML', async () => {
      const response = await fetch(`${amw.baseUrl}/product?id=${ASIN_MALICIOUS}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
    });

    it.each([
      ['no parameter', ''],
      ['an empty id', '?id='],
      ['a whitespace-only id', '?id=%20'],
      ['an id made only of stripped characters', '?id=%3C%3E'],
      ['an id longer than 50 characters', `?id=${'A'.repeat(51)}`],
      ['a keyword longer than 100 characters', `?keyword=${'a'.repeat(101)}`],
      ['an id given as an array', '?id=A&id=B']
    ])('rejects %s with 400', async (_label, query) => {
      const response = await fetch(`${amw.baseUrl}/product${query}`);
      const body = await response.json() as Json;

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation Error');
    });
  });

  describe('GET /widget.js', () => {
    it('serves the minified widget as JavaScript', async () => {
      const response = await fetch(`${amw.baseUrl}/widget.js`);
      const script = await response.text();
      const source = fs.readFileSync(path.join(PROJECT_DIR, 'src', 'widgets', 'widget.js'), 'utf8');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/javascript/);
      expect(script.startsWith('/* Amazon Modern Widgets')).toBe(true);
      expect(script).toContain('AmwWidget');
      expect(script.length).toBeLessThan(source.length * 0.8);
      expect(script).not.toContain('Widget configuration');
    });
  });

  describe('HTTP headers', () => {
    it('sets a public Cache-Control max-age from Server.httpCache on found products', async () => {
      const response = await fetch(`${amw.baseUrl}/product?id=B08N5WRWNW`);

      expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    });

    it('never lets shared caches store errors or health probes', async () => {
      const responses = await Promise.all([
        fetch(`${amw.baseUrl}/health`),
        fetch(`${amw.baseUrl}/product?id=${ASIN_NOT_FOUND}`),
        fetch(`${amw.baseUrl}/does-not-exist`)
      ]);

      for (const response of responses) {
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
    });

    it('caches the stable widget URLs for one hour and the hashed copies forever', async () => {
      const stable = await fetch(`${amw.baseUrl}/widget.js`);
      expect(stable.headers.get('cache-control')).toBe('public, max-age=3600');

      const manifest = await (await fetch(`${amw.baseUrl}/widget-manifest.json`)).json() as Record<string, string>;
      for (const hashedFile of Object.values(manifest)) {
        const hashed = await fetch(`${amw.baseUrl}/${hashedFile}`);
        expect(hashed.status).toBe(200);
        expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      }
    });

    it('does not disclose the framework through X-Powered-By', async () => {
      const responses = await Promise.all([
        fetch(`${amw.baseUrl}/health`),
        fetch(`${amw.baseUrl}/product?id=B08N5WRWNW`),
        fetch(`${amw.baseUrl}/does-not-exist`)
      ]);

      for (const response of responses) {
        expect(response.headers.get('x-powered-by')).toBeNull();
      }
    });

    it('returns a JSON 404 for unknown routes', async () => {
      const response = await fetch(`${amw.baseUrl}/does-not-exist`);

      expect(response.status).toBe(404);
      expect((await response.json() as Json).error).toBe('Not Found');
    });
  });
});

describe('AMW rate limiting (e2e)', () => {
  const RATE_LIMIT = 3;
  let mock: MockAmazonApi;
  let amw: AmwServer;

  beforeAll(async () => {
    mock = await startMockAmazonApi();
    amw = await startAmwServer({ mockApiUrl: mock.url, config: { Server: { rateLimit: RATE_LIMIT } } });
  });

  afterAll(async () => {
    await amw?.stop();
    await mock?.close();
  });

  it(`answers 429 once a client exceeds ${RATE_LIMIT} product requests per minute`, async () => {
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT + 1; i++) {
      statuses.push((await fetch(`${amw.baseUrl}/product?id=B08N5WRWNW`)).status);
    }

    expect(statuses.slice(0, RATE_LIMIT)).toEqual(Array(RATE_LIMIT).fill(200));
    expect(statuses[RATE_LIMIT]).toBe(429);
    expect(mock.calls.getItems).toHaveLength(RATE_LIMIT);
  });

  it('exposes the standard RateLimit headers', async () => {
    const response = await fetch(`${amw.baseUrl}/product?id=B08N5WRWNW`);

    expect(response.headers.get('ratelimit-policy')).toContain(`q=${RATE_LIMIT}`);
  });

  it('does not rate limit the widget and health endpoints', async () => {
    const [widget, health] = await Promise.all([
      fetch(`${amw.baseUrl}/widget.js`),
      fetch(`${amw.baseUrl}/health`)
    ]);

    expect(widget.status).toBe(200);
    expect(health.status).toBe(200);
  });
});
