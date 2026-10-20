/**
 * Request coalescing, negative cache, circuit breaker and stale cache (#131).
 */

import express from 'express';
import request from 'supertest';
import { loadModules, createLoggerMock, createAmazonItem } from './helpers/mocks';
import { CircuitBreaker, RequestCoalescer, TtlLruCache } from '../src/server/Resilience';

const mockLogger = createLoggerMock();
const mockGetItems = jest.fn();
const mockSearchItems = jest.fn();

jest.mock('../src/utils/ConfigLog4j', () => ({ getLogger: () => mockLogger }));

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({
    getItems: mockGetItems,
    searchItems: mockSearchItems,
  })),
  GetItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => value },
  SearchItemsResource: { constructFromObject: (value: string) => value },
  Condition: { constructFromObject: (value: string) => value },
}));

/** Minimal in-memory stand-in for the ioredis commands AmwApi uses. */
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

function createApp(overrides: Record<string, unknown> = {}, redis?: ReturnType<typeof createFakeRedis>) {
  const { AmwApi } = loadModules({ 'Redis.expire': 600, ...overrides });
  const api = new AmwApi(redis as any);
  const app = express();
  app.get('/amw/product', (req, res) => api.setProductEndpoint(req, res));
  return app;
}

function amazonServerError() {
  return { status: 500, statusText: 'Internal Server Error', body: {}, response: { status: 500, headers: new Headers() } };
}

beforeEach(() => {
  mockGetItems.mockReset();
  mockSearchItems.mockReset();
});

describe('RequestCoalescer', () => {
  it('shares one in-flight promise per key and forgets it once settled', async () => {
    const coalescer = new RequestCoalescer<number>();
    let resolve!: (value: number) => void;
    const task = jest.fn(() => new Promise<number>(r => { resolve = r; }));

    const first = coalescer.run('k', task);
    const second = coalescer.run('k', task);
    expect(task).toHaveBeenCalledTimes(1);
    expect(coalescer.size).toBe(1);

    resolve(42);
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
    expect(coalescer.size).toBe(0);

    await coalescer.run('k', async () => 1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejection to every waiter and allows a retry', async () => {
    const coalescer = new RequestCoalescer<number>();
    const failing = coalescer.run('k', async () => { throw new Error('boom'); });

    await expect(failing).rejects.toThrow('boom');
    await expect(coalescer.run('k', async () => 2)).resolves.toBe(2);
  });
});

describe('TtlLruCache', () => {
  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new TtlLruCache<string>(10, 1000, () => now);
    cache.set('a', 'A');

    now = 999;
    expect(cache.get('a')).toBe('A');
    now = 1000;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry beyond its capacity', () => {
    const cache = new TtlLruCache<string>(2, 60000);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.get('a');
    cache.set('c', 'C');

    expect(cache.get('a')).toBe('A');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('C');
    expect(cache.size).toBe(2);
  });
});

describe('CircuitBreaker', () => {
  it('opens after the threshold of consecutive failures and fails fast during the cooldown', () => {
    let now = 0;
    const breaker = new CircuitBreaker(2, 30000, () => now);

    breaker.recordFailure();
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordFailure();

    expect(breaker.state).toBe('open');
    expect(breaker.tryAcquire()).toBe(false);
    now = 10000;
    expect(breaker.retryAfterSeconds()).toBe(20);
  });

  it('lets a single trial call through after the cooldown and closes on success', () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 1000, () => now);
    breaker.recordFailure();

    now = 1000;
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.state).toBe('half-open');
    expect(breaker.tryAcquire()).toBe(false);

    breaker.recordSuccess();
    expect(breaker.state).toBe('closed');
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.retryAfterSeconds()).toBe(1);
  });

  it('re-opens when the trial call fails', () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 1000, () => now);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    now = 1500;
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordFailure();

    expect(breaker.state).toBe('open');
    expect(breaker.tryAcquire()).toBe(false);
  });

  it('a success resets the failure count', () => {
    const breaker = new CircuitBreaker(2, 1000);
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();

    expect(breaker.state).toBe('closed');
  });

  it('never opens with a threshold of 0', () => {
    const breaker = new CircuitBreaker(0, 1000);
    for (let i = 0; i < 10; i++) breaker.recordFailure();

    expect(breaker.state).toBe('closed');
    expect(breaker.tryAcquire()).toBe(true);
  });
});

describe('GET /product request coalescing', () => {
  it('makes a single Amazon call for concurrent requests on the same product', async () => {
    let answer!: (value: unknown) => void;
    mockGetItems.mockReturnValue(new Promise(resolve => { answer = resolve; }));
    const app = createApp();

    const pending = Array.from({ length: 5 }, () => request(app).get('/amw/product?id=B084DN3XVN').then(r => r));
    // Hold Amazon's answer until every request has reached the handler, whatever the machine load
    const received = () => mockLogger.info.mock.calls.filter(([message]) => String(message).startsWith('GET /product')).length;
    while (received() < 5) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    answer({ itemsResult: { items: [createAmazonItem()] } });
    const responses = await Promise.all(pending);

    expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(mockGetItems).toHaveBeenCalledTimes(1);
  });
});

describe('GET /product negative cache', () => {
  beforeEach(() => mockGetItems.mockResolvedValue({ itemsResult: { items: [] } }));

  it('remembers a missing product in memory when Redis is disabled', async () => {
    const app = createApp();

    await request(app).get('/amw/product?id=B000000000').expect(404);
    await request(app).get('/amw/product?id=B000000000').expect(404);

    expect(mockGetItems).toHaveBeenCalledTimes(1);
  });

  it('remembers a missing product in Redis with Redis.notFoundExpire', async () => {
    const redis = createFakeRedis();
    mockSearchItems.mockResolvedValue({ searchResult: { items: [] } });
    const app = createApp({ 'Redis.notFoundExpire': 120 }, redis);

    await request(app).get('/amw/product?keyword=nothing').expect(404);
    mockSearchItems.mockClear();
    await request(app).get('/amw/product?keyword=nothing').expect(404);

    expect(redis.store.get('amw:notfound:keyword:nothing')).toEqual({ value: '1', ttl: 120 });
    expect(mockSearchItems).not.toHaveBeenCalled();
  });

  it('is disabled by Redis.notFoundExpire: 0', async () => {
    const app = createApp({ 'Redis.notFoundExpire': 0 });

    await request(app).get('/amw/product?id=B000000000').expect(404);
    await request(app).get('/amw/product?id=B000000000').expect(404);

    expect(mockGetItems).toHaveBeenCalledTimes(2);
  });

  it('still asks Amazon when the not-found cache cannot be read or written', async () => {
    const redis = createFakeRedis();
    redis.exists.mockRejectedValue(new Error('ECONNRESET'));
    redis.set.mockRejectedValue(new Error('READONLY'));
    const app = createApp({}, redis);

    await request(app).get('/amw/product?id=B000000000').expect(404);
    await request(app).get('/amw/product?id=B000000000').expect(404);

    expect(mockGetItems).toHaveBeenCalledTimes(2);
  });
});

describe('GET /product circuit breaker', () => {
  it('stops calling Amazon after repeated failures and answers 503 with Retry-After', async () => {
    mockGetItems.mockRejectedValue(amazonServerError());
    const app = createApp({ 'Amazon.breakerThreshold': 2, 'Amazon.breakerCooldown': 45 });

    await request(app).get('/amw/product?id=B084DN3XVN').expect(502);
    await request(app).get('/amw/product?id=B084DN3XVN').expect(502);
    const res = await request(app).get('/amw/product?id=B000000001').expect(503);

    expect(res.headers['retry-after']).toBe('45');
    expect(res.body).toEqual({
      error: 'Service Unavailable',
      message: 'Amazon API temporarily unavailable, retry later',
      timestamp: expect.any(String),
    });
    expect(mockGetItems).toHaveBeenCalledTimes(2);
  });

  it('does not count "not found" answers as failures', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [] } });
    const app = createApp({ 'Amazon.breakerThreshold': 1, 'Redis.notFoundExpire': 0 });

    await request(app).get('/amw/product?id=B000000000').expect(404);
    await request(app).get('/amw/product?id=B000000000').expect(404);

    expect(mockGetItems).toHaveBeenCalledTimes(2);
  });
});

describe('GET /product stale cache', () => {
  const tenMinutes = 600 * 1000;

  function cachedProduct(redis: ReturnType<typeof createFakeRedis>, ageMs: number) {
    const product = { title: 'Cached Arduino', timestamp: Date.now() - ageMs };
    redis.store.set('amw:product:id:B084DN3XVN', { value: JSON.stringify(product), ttl: 0 });
    return product;
  }

  it('serves a fresh cached product without calling Amazon', async () => {
    const redis = createFakeRedis();
    cachedProduct(redis, 1000);

    const res = await request(createApp({}, redis)).get('/amw/product?id=B084DN3XVN').expect(200);

    expect(res.body.title).toBe('Cached Arduino');
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('refreshes a stale product from Amazon and keeps it for Redis.expire + Redis.staleExpire', async () => {
    const redis = createFakeRedis();
    cachedProduct(redis, tenMinutes + 1);
    mockGetItems.mockResolvedValue({ itemsResult: { items: [createAmazonItem()] } });

    const res = await request(createApp({ 'Redis.staleExpire': 3600 }, redis)).get('/amw/product?id=B084DN3XVN').expect(200);

    expect(res.body.title).toBe('Arduino Uno R3');
    expect(redis.store.get('amw:product:id:B084DN3XVN')?.ttl).toBe(600 + 3600);
  });

  it('serves the stale product when Amazon fails', async () => {
    const redis = createFakeRedis();
    cachedProduct(redis, tenMinutes + 1);
    mockGetItems.mockRejectedValue(amazonServerError());

    const res = await request(createApp({}, redis)).get('/amw/product?id=B084DN3XVN').expect(200);

    expect(res.body.title).toBe('Cached Arduino');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('serving stale product'));
  });

  it('serves the stale product while the circuit is open', async () => {
    const redis = createFakeRedis();
    cachedProduct(redis, tenMinutes + 1);
    mockGetItems.mockRejectedValue(amazonServerError());
    const app = createApp({ 'Amazon.breakerThreshold': 1 }, redis);

    await request(app).get('/amw/product?id=B000000001').expect(502);
    const res = await request(app).get('/amw/product?id=B084DN3XVN').expect(200);

    expect(res.body.title).toBe('Cached Arduino');
    expect(mockGetItems).toHaveBeenCalledTimes(1);
  });

  it('answers the Amazon error when there is nothing stale to serve', async () => {
    const redis = createFakeRedis();
    mockGetItems.mockRejectedValue(amazonServerError());

    await request(createApp({}, redis)).get('/amw/product?id=B084DN3XVN').expect(502);
  });
});

describe('resilience configuration', () => {
  it.each([
    ['Redis.staleExpire', -1],
    ['Redis.notFoundExpire', 'soon'],
    ['Amazon.breakerThreshold', -2],
    ['Amazon.breakerCooldown', 'x'],
  ])('refuses an invalid %s', (key, value) => {
    const { AmwApi } = loadModules({ [key]: value });

    expect(() => new AmwApi()).toThrow(`${key} must be a positive number or 0`);
  });

  it('uses the defaults for empty values', () => {
    const { AmwApi } = loadModules({ 'Redis.staleExpire': '', 'Amazon.breakerThreshold': null });

    expect(() => new AmwApi()).not.toThrow();
  });
});
