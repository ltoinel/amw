/**
 * GET <path>/products?ids=... batch endpoint (#142).
 */

import express from 'express';
import request from 'supertest';
import { loadModules, createLoggerMock, createAmazonItem, createProjectDir } from './helpers/mocks';

const mockLogger = createLoggerMock();
const mockGetItems = jest.fn();

jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({ getItems: mockGetItems, searchItems: jest.fn() })),
  GetItemsRequestContent: jest.fn().mockImplementation((partnerTag, itemIds) => ({ partnerTag, itemIds })),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => value },
  SearchItemsResource: { constructFromObject: (value: string) => value },
  Condition: { constructFromObject: (value: string) => value },
}));

const A = 'B000000001';
const B = 'B000000002';
const C = 'B000000003';

function item(asin: string) {
  return createAmazonItem({ asin, itemInfo: { title: { displayValue: `Product ${asin}` } } });
}

/** Answers GetItems with the requested ASINs that are listed in `known`. */
function amazonKnows(...known: string[]) {
  mockGetItems.mockImplementation(async (_marketplace: string, req: { itemIds: string[] }) => ({
    itemsResult: { items: req.itemIds.filter(id => known.includes(id)).map(item) },
  }));
}

function createFakeRedis() {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, _mode: string, ttl: number) => {
      store.set(key, { value, ttl });
      return 'OK';
    }),
    exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  };
}

function createApiApp(overrides: Record<string, unknown> = {}, redis?: ReturnType<typeof createFakeRedis>) {
  const { AmwApi } = loadModules({ 'Redis.expire': 600, ...overrides });
  const api = new AmwApi(redis as any);
  const app = express();
  app.get('/amw/product', (req, res) => api.setProductEndpoint(req, res));
  app.get('/amw/products', (req, res) => api.setProductsEndpoint(req, res));
  return app;
}

function createServerApp(overrides: Record<string, unknown> = {}) {
  const { AmwServer } = loadModules({ 'Server.projectDir': createProjectDir(), ...overrides });
  return new AmwServer().getApp();
}

function amazonServerError() {
  return { status: 500, statusText: 'Internal Server Error', body: {}, response: { status: 500, headers: new Headers() } };
}

beforeEach(() => mockGetItems.mockReset());

describe('GET /products validation', () => {
  it.each([
    ['no ids', ''],
    ['an empty list', '?ids=,,'],
    ['a repeated ids parameter', `?ids=${A}&ids=${B}`],
    ['a lowercase ASIN', '?ids=b000000001'],
    ['a too short ASIN', '?ids=B00000001'],
    ['a hostile value', '?ids=%3Cscript%3E'],
    ['more than 10 ASINs', `?ids=${Array.from({ length: 11 }, (_, i) => `B0000000${String(i).padStart(2, '0')}`).join(',')}`],
  ])('rejects %s with 400', async (_label, query) => {
    const res = await request(createApiApp()).get(`/amw/products${query}`).expect(400);

    expect(res.body).toEqual({ error: 'Validation Error', message: expect.any(String), timestamp: expect.any(String) });
    expect(mockGetItems).not.toHaveBeenCalled();
  });
});

describe('GET /products lookups', () => {
  it('fetches every product with a single GetItems call and keeps the request order', async () => {
    amazonKnows(A, C);

    const res = await request(createApiApp()).get(`/amw/products?ids=${C},${B}, ${A},${C}`).expect(200);

    expect(res.body.results).toEqual([
      { id: C, status: 200, product: expect.objectContaining({ asin: C, title: `Product ${C}` }) },
      { id: B, status: 404 },
      { id: A, status: 200, product: expect.objectContaining({ asin: A }) },
    ]);
    expect(mockGetItems).toHaveBeenCalledTimes(1);
    expect(mockGetItems.mock.calls[0][1].itemIds).toEqual([C, B, A]);
  });

  it('answers from the cache and the not-found cache before calling Amazon', async () => {
    const redis = createFakeRedis();
    amazonKnows(A, B);
    const app = createApiApp({}, redis);
    await request(app).get(`/amw/products?ids=${A},${C}`).expect(200);
    mockGetItems.mockClear();

    const res = await request(app).get(`/amw/products?ids=${A},${B},${C}`).expect(200);

    expect(res.body.results.map((r: { status: number }) => r.status)).toEqual([200, 200, 404]);
    expect(mockGetItems).toHaveBeenCalledTimes(1);
    expect(mockGetItems.mock.calls[0][1].itemIds).toEqual([B]);
    expect(redis.store.get(`amw:product:id:${A}`)?.ttl).toBe(Math.min(600 + 86400, 86400));
    expect(redis.store.get(`amw:notfound:id:${C}`)).toEqual({ value: '1', ttl: 3600 });
  });

  it('never lets the response outlive the 24 h freshness of its oldest product', async () => {
    const redis = createFakeRedis();
    const twentyHours = 20 * 3600 * 1000;
    redis.store.set(`amw:product:id:${A}`, { value: JSON.stringify({ title: 'Old', timestamp: Date.now() - twentyHours }), ttl: 0 });
    redis.store.set(`amw:product:id:${B}`, { value: JSON.stringify({ title: 'New', timestamp: Date.now() }), ttl: 0 });
    const { AmwApi } = loadModules({ 'Redis.expire': 86400, 'Server.httpCache': 604800 });
    const api = new AmwApi(redis as any);
    const app = express();
    app.get('/amw/products', (req, res) => api.setProductsEndpoint(req, res));

    const res = await request(app).get(`/amw/products?ids=${A},${B}`).expect(200);

    const maxAge = Number(/max-age=(\d+)/.exec(res.headers['cache-control'])?.[1]);
    expect(maxAge).toBeLessThanOrEqual(4 * 3600);
    expect(maxAge).toBeGreaterThan(4 * 3600 - 5);
  });

  it('records usage statistics per product', async () => {
    amazonKnows(A);
    const stats = { recordProduct: jest.fn() };
    const { AmwApi } = loadModules();
    const api = new AmwApi(undefined, stats as any);
    const app = express();
    app.get('/amw/products', (req, res) => api.setProductsEndpoint(req, res));

    await request(app).get(`/amw/products?ids=${A},${B}`).set('Referer', 'https://blog.example/page').expect(200);

    expect(stats.recordProduct).toHaveBeenCalledWith('amazon', 'id', A, 'https://blog.example/page');
    expect(stats.recordProduct).toHaveBeenCalledWith('notfound', 'id', B, 'https://blog.example/page');
  });

  it('does not call Amazon when everything is cached', async () => {
    const redis = createFakeRedis();
    redis.store.set(`amw:product:id:${A}`, { value: JSON.stringify({ title: 'Cached', timestamp: Date.now() }), ttl: 0 });

    const res = await request(createApiApp({}, redis)).get(`/amw/products?ids=${A}`).expect(200);

    expect(res.body.results).toEqual([{ id: A, status: 200, product: expect.objectContaining({ title: 'Cached' }) }]);
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('shares an in-flight /product call for the same ASIN', async () => {
    let answerSingle!: (value: unknown) => void;
    mockGetItems
      .mockImplementationOnce(() => new Promise(resolve => { answerSingle = resolve; }))
      .mockImplementation(async (_m: string, req: { itemIds: string[] }) => ({ itemsResult: { items: req.itemIds.map(item) } }));
    const app = createApiApp();

    const single = request(app).get(`/amw/product?id=${A}`).then(r => r);
    while (mockGetItems.mock.calls.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const batch = request(app).get(`/amw/products?ids=${A},${B}`).then(r => r);
    while (mockGetItems.mock.calls.length < 2) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    answerSingle({ itemsResult: { items: [item(A)] } });

    expect((await single).status).toBe(200);
    expect((await batch).body.results.map((r: { status: number }) => r.status)).toEqual([200, 200]);
    expect(mockGetItems).toHaveBeenCalledTimes(2);
    expect(mockGetItems.mock.calls[1][1].itemIds).toEqual([B]);
  });
});

describe('GET /products failures', () => {
  it('reports the Amazon failure per id and serves stale products', async () => {
    const redis = createFakeRedis();
    redis.store.set(`amw:product:id:${A}`, {
      value: JSON.stringify({ title: 'Stale', timestamp: Date.now() - 601 * 1000 }),
      ttl: 0,
    });
    mockGetItems.mockRejectedValue(amazonServerError());

    const res = await request(createApiApp({}, redis)).get(`/amw/products?ids=${A},${B}`).expect(200);

    expect(res.body.results).toEqual([
      { id: A, status: 200, product: expect.objectContaining({ title: 'Stale' }) },
      { id: B, status: 502 },
    ]);
  });

  it.each([
    ['throttling', { status: 429, response: { headers: new Headers() } }, 503],
    ['a timeout', { error: new Error('aborted'), statusText: 'Request timeout' }, 504],
  ])('maps %s to status %i', async (_label, error, status) => {
    mockGetItems.mockRejectedValue(error);

    const res = await request(createApiApp()).get(`/amw/products?ids=${A}`).expect(200);

    expect(res.body.results).toEqual([{ id: A, status }]);
  });

  it('counts a failed batch once for the circuit breaker, then answers 503 per id', async () => {
    mockGetItems.mockRejectedValue(amazonServerError());
    const app = createApiApp({ 'Amazon.breakerThreshold': 1 });

    await request(app).get(`/amw/products?ids=${A},${B}`).expect(200);
    const res = await request(app).get(`/amw/products?ids=${C}`).expect(200);

    expect(res.body.results).toEqual([{ id: C, status: 503 }]);
    expect(mockGetItems).toHaveBeenCalledTimes(1);
  });

  it('reports unexpected errors as 500', async () => {
    const { AmwApi, Paapi } = loadModules();
    jest.spyOn(Paapi.prototype, 'getItemsApi').mockRejectedValue(new Error('bug'));
    const app = express();
    const api = new AmwApi();
    app.get('/amw/products', (req, res) => api.setProductsEndpoint(req, res));

    const res = await request(app).get(`/amw/products?ids=${A}`).expect(200);

    expect(res.body.results).toEqual([{ id: A, status: 500 }]);
  });
});

describe('GET /products route', () => {
  it('is cacheable only when every product was found', async () => {
    amazonKnows(A);
    const app = createServerApp();

    const found = await request(app).get(`/amw/products?ids=${A}`).expect(200);
    const partial = await request(app).get(`/amw/products?ids=${A},${B}`).expect(200);

    expect(found.headers['cache-control']).toBe('public, max-age=3600');
    expect(partial.headers['cache-control']).toBe('no-store');
  });

  it('shares the /product rate limit', async () => {
    amazonKnows(A);
    const app = createServerApp({ 'Server.rateLimit': 2 });

    await request(app).get(`/amw/product?id=${A}`).expect(200);
    await request(app).get(`/amw/products?ids=${A}`).expect(200);
    await request(app).get(`/amw/products?ids=${A}`).expect(429);
  });
});

describe('Paapi.getItemsApi', () => {
  it('maps the returned items by ASIN and skips unusable ones', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [item(A), { asin: B }] } });
    const { Paapi } = loadModules();

    const products = await new Paapi().getItemsApi([A, B, C]);

    expect([...products.keys()]).toEqual([A]);
  });

  it('treats an Amazon 404 as "none found"', async () => {
    mockGetItems.mockRejectedValue({ status: 404, response: { headers: new Headers() } });
    const { Paapi } = loadModules();

    await expect(new Paapi().getItemsApi([A])).resolves.toEqual(new Map());
  });

  it('dumps the response in debug mode', async () => {
    mockGetItems.mockResolvedValue({});
    const { Paapi } = loadModules({ 'Server.debug': true });

    await expect(new Paapi().getItemsApi([A])).resolves.toEqual(new Map());
    expect(mockLogger.debug).toHaveBeenCalledWith('API called successfully.');
  });
});
