/**
 * Amazon Associates rule: product data shown to visitors must be less than 24 hours old (#205).
 */

import express from 'express';
import request from 'supertest';
import { loadModules, createLoggerMock, createAmazonItem } from './helpers/mocks';

const mockLogger = createLoggerMock();
const mockGetItems = jest.fn();

jest.mock('../src/utils/logger', () => ({ getLogger: () => mockLogger }));

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({ getItems: mockGetItems, searchItems: jest.fn() })),
  GetItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => value },
  SearchItemsResource: { constructFromObject: (value: string) => value },
  Condition: { constructFromObject: (value: string) => value },
}));

const HOUR = 3600;
const DAY = 24 * HOUR;
const ID = 'B084DN3XVN';

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

function createApp(overrides: Record<string, unknown>, redis: ReturnType<typeof createFakeRedis>) {
  const { AmwApi } = loadModules({ 'Server.httpCache': 7 * DAY, ...overrides });
  const api = new AmwApi(redis as any);
  const app = express();
  app.get('/amw/product', (req, res) => api.setProductEndpoint(req, res));
  return app;
}

function cache(redis: ReturnType<typeof createFakeRedis>, ageSeconds: number | undefined) {
  const product = { title: 'Cached', ...(ageSeconds === undefined ? {} : { timestamp: Date.now() - ageSeconds * 1000 }) };
  redis.store.set(`amw:product:id:${ID}`, { value: JSON.stringify(product), ttl: 0 });
}

function amazonServerError() {
  return { status: 500, statusText: 'x', body: {}, response: { status: 500, headers: new Headers() } };
}

function maxAge(res: request.Response): number {
  return Number(/max-age=(\d+)/.exec(res.headers['cache-control'])?.[1]);
}

beforeEach(() => {
  mockGetItems.mockReset();
  mockGetItems.mockResolvedValue({ itemsResult: { items: [createAmazonItem()] } });
});

describe('Redis.expire cap', () => {
  it('caps a Redis.expire above 24 h, with a warning, and stores products for 24 h at most', async () => {
    const redis = createFakeRedis();
    const app = createApp({ 'Redis.expire': 2630000, 'Redis.staleExpire': 7 * DAY }, redis);

    await request(app).get(`/amw/product?id=${ID}`).expect(200);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis.expire (2630000s) exceeds the 24 h'));
    expect(redis.store.get(`amw:product:id:${ID}`)?.ttl).toBe(DAY);
  });

  it('refreshes a product cached for more than 24 h even with a larger Redis.expire', async () => {
    const redis = createFakeRedis();
    cache(redis, DAY + 60);

    const res = await request(createApp({ 'Redis.expire': 2630000 }, redis)).get(`/amw/product?id=${ID}`).expect(200);

    expect(res.body.title).toBe('Arduino Uno R3');
    expect(mockGetItems).toHaveBeenCalledTimes(1);
  });

  it('ignores a cached product without a timestamp, whose age is unknown', async () => {
    const redis = createFakeRedis();
    cache(redis, undefined);

    await request(createApp({ 'Redis.expire': DAY }, redis)).get(`/amw/product?id=${ID}`).expect(200);

    expect(mockGetItems).toHaveBeenCalledTimes(1);
  });
});

describe('stale fallback', () => {
  it('serves a stale product younger than 24 h when Amazon fails', async () => {
    const redis = createFakeRedis();
    cache(redis, 23 * HOUR);
    mockGetItems.mockRejectedValue(amazonServerError());

    const res = await request(createApp({ 'Redis.expire': HOUR }, redis)).get(`/amw/product?id=${ID}`).expect(200);

    expect(res.body.title).toBe('Cached');
    expect(maxAge(res)).toBeLessThanOrEqual(HOUR);
  });

  it('never serves a product older than 24 h, even when Amazon fails', async () => {
    const redis = createFakeRedis();
    cache(redis, DAY + 1);
    mockGetItems.mockRejectedValue(amazonServerError());

    await request(createApp({ 'Redis.expire': HOUR, 'Redis.staleExpire': 7 * DAY }, redis))
      .get(`/amw/product?id=${ID}`).expect(502);
  });
});

describe('Cache-Control max-age of products', () => {
  it('is capped at 24 h for a product just fetched from Amazon', async () => {
    const res = await request(createApp({ 'Redis.expire': HOUR }, createFakeRedis())).get(`/amw/product?id=${ID}`).expect(200);

    // A few seconds may elapse between the Amazon answer and the response on a loaded machine
    expect(maxAge(res)).toBeLessThanOrEqual(DAY);
    expect(maxAge(res)).toBeGreaterThan(DAY - 5);
  });

  it('keeps Server.httpCache when it is shorter than the remaining freshness', async () => {
    const res = await request(createApp({ 'Redis.expire': HOUR, 'Server.httpCache': 300 }, createFakeRedis()))
      .get(`/amw/product?id=${ID}`).expect(200);

    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('only covers what is left of the 24 h for a cached product', async () => {
    const redis = createFakeRedis();
    cache(redis, 20 * HOUR);

    const res = await request(createApp({ 'Redis.expire': DAY }, redis)).get(`/amw/product?id=${ID}`).expect(200);

    expect(res.body.title).toBe('Cached');
    // Age in Redis + max-age never exceeds 24 h
    expect(maxAge(res)).toBeLessThanOrEqual(4 * HOUR);
    expect(maxAge(res)).toBeGreaterThan(4 * HOUR - 5);
  });
});
