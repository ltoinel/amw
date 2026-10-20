/**
 * HTTP status mapping of Amazon Creators API failures (#127).
 */

import request from 'supertest';
import express from 'express';

const mockConfig: Record<string, unknown> = {
  'Server.debug': false,
  'Server.projectDir': '/tmp',
  'Redis.expire': 3600,
  'Amazon.credentialId': 'id',
  'Amazon.credentialSecret': 'secret',
  'Amazon.version': '3.2',
  'Amazon.partnerTag': 'tag-21',
  'Amazon.marketplace': 'www.amazon.fr',
  'Amazon.condition': 'New',
};

jest.mock('config', () => ({
  get: (key: string) => mockConfig[key],
  has: (key: string) => key in mockConfig,
}));

jest.mock('../src/utils/logger', () => ({
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockGetItems = jest.fn();
const mockSearchItems = jest.fn();

jest.mock('amazon-creators-api', () => {
  class Stub {
    static constructFromObject(value: unknown) { return value; }
    constructor(..._args: unknown[]) { /* request DTO */ }
  }
  return {
    ApiClient: class { },
    TypedDefaultApi: class {
      getItems = mockGetItems;
      searchItems = mockSearchItems;
    },
    GetItemsRequestContent: Stub,
    GetItemsResource: Stub,
    SearchItemsRequestContent: Stub,
    SearchItemsResource: Stub,
    Condition: Stub,
  };
});

import { AmazonError, classifyAmazonError, parseRetryAfter } from '../src/server/AmazonError';
import { AmwApi } from '../src/server/AmwApi';

const amazonItem = {
  asin: 'B08N5WRWNW',
  detailPageURL: 'https://www.amazon.fr/dp/B08N5WRWNW',
  images: { primary: { large: { url: 'https://m.media-amazon.com/x.jpg' } } },
  itemInfo: { title: { displayValue: 'Echo Dot' } },
};

function httpError(status: number, headers: Record<string, string> = {}) {
  return { status, statusText: 'x', body: {}, response: { status, headers: new Headers(headers) } };
}

describe('classifyAmazonError', () => {
  test('HTTP 404 from Amazon means the item does not exist', () => {
    expect(classifyAmazonError(httpError(404))).toBeNull();
  });

  test('HTTP 429 is throttling and carries Retry-After', () => {
    const err = classifyAmazonError(httpError(429, { 'retry-after': '12' }));
    expect(err?.kind).toBe('throttled');
    expect(err?.retryAfter).toBe(12);
  });

  test('HTTP 429 without Retry-After falls back to a default delay', () => {
    expect(classifyAmazonError(httpError(429))?.retryAfter).toBe(60);
  });

  test('aborted fetch is a timeout', () => {
    expect(classifyAmazonError({ error: new Error('aborted'), statusText: 'Request timeout' })?.kind).toBe('timeout');
  });

  test.each([
    ['HTTP 500', httpError(500)],
    ['HTTP 401', httpError(401)],
    ['network failure', { error: new TypeError('fetch failed') }],
    ['OAuth2 failure', Object.assign(new Error('OAuth2 token request failed with status 404'), { status: 404 })],
  ])('%s is an upstream error', (_label, error) => {
    expect(classifyAmazonError(error)?.kind).toBe('upstream');
  });

  test('reads Retry-After from a plain header object', () => {
    const err = classifyAmazonError({ status: 429, response: { headers: { 'retry-after': '7' } } });
    expect(err?.retryAfter).toBe(7);
  });

  test('returns an AmazonError unchanged', () => {
    const original = new AmazonError('timeout', 'x');
    expect(classifyAmazonError(original)).toBe(original);
  });

  test.each([[undefined], [''], ['soon']])('parseRetryAfter(%p) falls back to 60 seconds', (value) => {
    expect(parseRetryAfter(value)).toBe(60);
  });

  test('parseRetryAfter accepts an HTTP date', () => {
    const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
    expect(parseRetryAfter(inTenSeconds)).toBeGreaterThanOrEqual(9);
    expect(parseRetryAfter(inTenSeconds)).toBeLessThanOrEqual(10);
  });
});

describe('GET /product status codes', () => {
  let app: express.Application;

  beforeEach(() => {
    mockGetItems.mockReset();
    mockSearchItems.mockReset();
    const api = new AmwApi();
    app = express();
    app.get('/amw/product', (req, res) => api.setProductEndpoint(req, res));
  });

  test('200 when Amazon returns the item', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [amazonItem] } });
    const res = await request(app).get('/amw/product?id=B08N5WRWNW').expect(200);
    expect(res.body.title).toBe('Echo Dot');
  });

  test('404 when Amazon answers without the item', async () => {
    mockGetItems.mockResolvedValue({ errors: [{ code: 'ItemNotAccessible', message: 'x' }] });
    const res = await request(app).get('/amw/product?id=B08N5WRWNW').expect(404);
    expect(res.body).toEqual({ error: 'Product Not Found', message: expect.any(String), timestamp: expect.any(String) });
  });

  test('404 when Amazon answers HTTP 404 to a search', async () => {
    mockSearchItems.mockRejectedValue(httpError(404));
    await request(app).get('/amw/product?keyword=nothing').expect(404);
  });

  test('404 when Amazon returns an item that cannot be displayed', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [{ asin: 'B08N5WRWNW' }] } });
    await request(app).get('/amw/product?id=B08N5WRWNW').expect(404);
  });

  test('503 with a default Retry-After when the error has none', async () => {
    mockGetItems.mockRejectedValue(new AmazonError('throttled', 'quota'));
    const res = await request(app).get('/amw/product?id=B08N5WRWNW').expect(503);
    expect(res.headers['retry-after']).toBe('60');
  });

  test('502 on an Amazon server error', async () => {
    mockGetItems.mockRejectedValue(httpError(500));
    const res = await request(app).get('/amw/product?id=B08N5WRWNW').expect(502);
    expect(res.body).toEqual({ error: 'Bad Gateway', message: expect.any(String), timestamp: expect.any(String) });
  });

  test('502 on invalid credentials', async () => {
    mockGetItems.mockRejectedValue(new Error('OAuth2 token request failed with status 401'));
    await request(app).get('/amw/product?id=B08N5WRWNW').expect(502);
  });

  test('503 with Retry-After when Amazon throttles', async () => {
    mockGetItems.mockRejectedValue(httpError(429, { 'retry-after': '5' }));
    const res = await request(app).get('/amw/product?id=B08N5WRWNW').expect(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body.error).toBe('Service Unavailable');
  });

  test('504 when the SDK aborts the request', async () => {
    mockGetItems.mockRejectedValue({ error: new Error('aborted'), statusText: 'Request timeout' });
    await request(app).get('/amw/product?id=B08N5WRWNW').expect(504);
  });

  test('504 when the server-side timeout fires', async () => {
    mockGetItems.mockRejectedValue(new AmazonError('timeout', 'Request timeout after 30000ms'));
    await request(app).get('/amw/product?id=B08N5WRWNW').expect(504);
  });
});
