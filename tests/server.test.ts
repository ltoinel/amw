/**
 * HTTP-level tests of the real Express application built by AmwServer,
 * with the Amazon SDK, Redis and the logger replaced by mocks.
 */

import request from 'supertest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadModules,
  createLoggerMock,
  createRedisMock,
  createAmazonItem,
  createProjectDir,
} from './helpers/mocks';

const mockLogger = createLoggerMock();
const mockRedis = createRedisMock();
const mockRedisConstructor = jest.fn();
const mockGetItems = jest.fn();
const mockSearchItems = jest.fn();

jest.mock('../src/utils/ConfigLog4j', () => ({ getLogger: () => mockLogger }));

jest.mock('ioredis', () => {
  const Redis = jest.fn().mockImplementation((options) => {
    mockRedisConstructor(options);
    return mockRedis;
  });
  return { __esModule: true, default: Redis, Redis };
});

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({
    getItems: mockGetItems,
    searchItems: mockSearchItems,
  })),
  GetItemsRequestContent: jest.fn().mockImplementation((partnerTag, itemIds) => ({ partnerTag, itemIds })),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => value },
  SearchItemsResource: { constructFromObject: (value: string) => value },
  Condition: { constructFromObject: (value: string) => value },
}));

function createApp(overrides: Record<string, unknown> = {}) {
  const { AmwServer } = loadModules(overrides);
  return new AmwServer().getApp();
}

beforeEach(() => {
  // clearMocks only resets calls, so restore the default behaviours explicitly
  mockRedis.status = 'ready';
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
  mockGetItems.mockResolvedValue({ itemsResult: { items: [createAmazonItem()] } });
  mockSearchItems.mockResolvedValue({ searchResult: { items: [createAmazonItem()] } });
});

describe('GET /product parameter validation', () => {
  const app = () => createApp();

  it.each([
    ['no parameter', ''],
    ['an empty id', '?id='],
    ['an id emptied by sanitization', '?id=%20%3C%3E%20'],
    ['a keyword emptied by sanitization', '?keyword=%22%27%0A'],
  ])('rejects %s with 400', async (_label, query) => {
    const res = await request(app()).get(`/amw/product${query}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Validation Error',
      message: 'Missing required parameter: id or keyword',
    });
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it.each([
    ['id', '?id=a&id=b', 'Parameter id must be a string'],
    ['keyword', '?keyword=a&keyword=b', 'Parameter keyword must be a string'],
  ])('rejects a repeated %s parameter (array) with 400', async (_name, query, message) => {
    const res = await request(app()).get(`/amw/product${query}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it('rejects an id longer than 50 characters', async () => {
    const res = await request(app()).get(`/amw/product?id=${'A'.repeat(51)}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID too long (max 50 characters)');
  });

  it('rejects a keyword longer than 100 characters', async () => {
    const res = await request(app()).get(`/amw/product?keyword=${'a'.repeat(101)}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Keyword too long (max 100 characters)');
  });

  it('accepts parameters at the maximum length', async () => {
    const res = await request(app()).get(`/amw/product?id=${'A'.repeat(50)}`);

    expect(res.status).toBe(200);
  });

  it('strips control characters, quotes and angle brackets before querying Amazon', async () => {
    const res = await request(app()).get('/amw/product?id=%20B0%3Cscript%3E84%22%0A');

    expect(res.status).toBe(200);
    expect(mockGetItems.mock.calls[0][1].itemIds).toEqual(['B0script84']);
  });
});

describe('GET /product without cache', () => {
  it('returns the product mapped from GetItems when searching by id', async () => {
    const res = await request(createApp()).get('/amw/product?id=B084DN3XVN');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      asin: 'B084DN3XVN',
      title: 'Arduino Uno R3',
      brand: 'Arduino',
      image: 'https://m.media-amazon.com/images/I/arduino.jpg',
      url: 'https://www.amazon.fr/dp/B084DN3XVN?tag=test-21',
      price: '24,99 €',
      savings: 15,
      timestamp: expect.any(Number),
    });
    expect(mockGetItems).toHaveBeenCalledWith(
      'www.amazon.fr',
      expect.objectContaining({ partnerTag: 'test-21', itemIds: ['B084DN3XVN'], condition: 'New' })
    );
    expect(mockSearchItems).not.toHaveBeenCalled();
  });

  it('returns the first SearchItems result when searching by keyword', async () => {
    const res = await request(createApp()).get('/amw/product?keyword=arduino%20uno');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Arduino Uno R3');
    expect(mockSearchItems).toHaveBeenCalledWith(
      'www.amazon.fr',
      expect.objectContaining({ partnerTag: 'test-21', keywords: 'arduino uno', itemCount: 1 })
    );
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('prefers the id when both id and keyword are given', async () => {
    await request(createApp()).get('/amw/product?id=B084DN3XVN&keyword=arduino');

    expect(mockGetItems).toHaveBeenCalledTimes(1);
    expect(mockSearchItems).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty item list', { itemsResult: { items: [] } }],
    ['no itemsResult', {}],
  ])('returns 404 when Amazon returns %s', async (_label, response) => {
    mockGetItems.mockResolvedValue(response);

    const res = await request(createApp()).get('/amw/product?id=B000000000');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: 'Product Not Found',
      message: 'No product found for identifier: amw:product:id:B000000000',
    });
  });

  it('returns 404 when a keyword search has no result', async () => {
    mockSearchItems.mockResolvedValue({ searchResult: { items: [] } });

    const res = await request(createApp()).get('/amw/product?keyword=nothing');

    expect(res.status).toBe(404);
  });

  it('returns 503 with Retry-After and logs the HTTP status when Amazon throttles', async () => {
    mockGetItems.mockRejectedValue({ status: 429, response: { body: { message: 'TooManyRequests' } } });

    const res = await request(createApp()).get('/amw/product?id=B084DN3XVN');

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 429'));
  });

  it('returns 502 when a keyword search throws', async () => {
    mockSearchItems.mockRejectedValue(new Error('socket hang up'));

    const res = await request(createApp()).get('/amw/product?keyword=arduino');

    expect(res.status).toBe(502);
    expect(mockLogger.error).toHaveBeenCalledWith('Error message: socket hang up');
  });
});

describe('GET /product unexpected failures', () => {
  it.each([
    ['id', '?id=B084DN3XVN', 'getItemApi'],
    ['keyword', '?keyword=arduino', 'searchItemApi'],
  ] as const)('returns a generic 500 when the %s lookup rejects', async (_label, query, method) => {
    const { AmwServer, Paapi } = loadModules();
    jest.spyOn(Paapi.prototype, method).mockRejectedValue(new Error('secret internal detail'));

    const res = await request(new AmwServer().getApp()).get(`/amw/product${query}`);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  it('returns 504 when the lookup times out', async () => {
    const { AmwServer, Paapi } = loadModules();
    // Required after loadModules() so that the class matches the one AmwApi checks with instanceof
    const { AmazonError } = require('../src/server/AmazonError');
    jest.spyOn(Paapi.prototype, 'getItemApi').mockRejectedValue(new AmazonError('timeout', 'Request timeout after 30000ms'));

    const res = await request(new AmwServer().getApp()).get('/amw/product?id=B084DN3XVN');

    expect(res.status).toBe(504);
    expect(res.body.error).toBe('Gateway Timeout');
  });
});

describe('GET /product with the Redis cache', () => {
  const app = () => createApp({ 'Redis.enabled': true, 'Redis.expire': 600 });

  it('serves a cache hit without calling Amazon', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ title: 'Cached product' }));

    const res = await request(app()).get('/amw/product?id=B084DN3XVN');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ title: 'Cached product' });
    expect(mockRedis.get).toHaveBeenCalledWith('amw:product:id:B084DN3XVN');
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('serves a keyword cache hit without calling Amazon', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ title: 'Cached product' }));

    const res = await request(app()).get('/amw/product?keyword=arduino');

    expect(res.status).toBe(200);
    expect(mockRedis.get).toHaveBeenCalledWith('amw:product:keyword:arduino');
    expect(mockSearchItems).not.toHaveBeenCalled();
  });

  it('fetches from Amazon on a cache miss and stores the product with the configured TTL', async () => {
    const res = await request(app()).get('/amw/product?id=B084DN3XVN');

    expect(res.status).toBe(200);
    expect(mockGetItems).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'amw:product:id:B084DN3XVN',
      JSON.stringify(res.body),
      'EX',
      600
    );
  });

  it('does not cache a product that was not found', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [] } });

    const res = await request(app()).get('/amw/product?id=B000000000');

    expect(res.status).toBe(404);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('falls back to Amazon when reading the cache fails', async () => {
    mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app()).get('/amw/product?id=B084DN3XVN');

    expect(res.status).toBe(200);
    expect(mockGetItems).toHaveBeenCalledTimes(1);
  });

  it('still answers when writing the cache fails', async () => {
    mockRedis.set.mockRejectedValue(new Error('READONLY'));

    const res = await request(app()).get('/amw/product?id=B084DN3XVN');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Arduino Uno R3');
  });
});

describe('GET /product rate limiting', () => {
  it('answers 429 once a client exceeds Server.rateLimit requests per minute', async () => {
    const app = createApp({ 'Server.rateLimit': 2 });

    const first = await request(app).get('/amw/product?id=B084DN3XVN');
    await request(app).get('/amw/product?id=B084DN3XVN');
    const third = await request(app).get('/amw/product?id=B084DN3XVN');

    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-policy']).toMatch(/q=2; w=60;/);
    expect(third.status).toBe(429);
    expect(mockGetItems).toHaveBeenCalledTimes(2);
  });

  it('defaults to 120 requests per minute when Server.rateLimit is not configured', async () => {
    const res = await request(createApp({ 'Server.rateLimit': undefined })).get('/amw/product?id=B084DN3XVN');

    expect(res.headers['ratelimit-policy']).toMatch(/q=120;/);
  });

  it('does not rate limit the other endpoints', async () => {
    const app = createApp({ 'Server.rateLimit': 1 });

    await request(app).get('/amw/health');
    const res = await request(app).get('/amw/health');

    expect(res.status).toBe(200);
  });
});

describe('GET /health', () => {
  it('reports the version and a disabled Redis cache', async () => {
    const res = await request(createApp()).get('/amw/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', version: '4.0.0', redis: 'disabled' });
    expect(typeof res.body.uptime).toBe('number');
  });

  it.each([
    ['ready', 'connected'],
    ['reconnecting', 'disconnected'],
  ])('maps a Redis status of %s to %s', async (status, expected) => {
    mockRedis.status = status;

    const res = await request(createApp({ 'Redis.enabled': true })).get('/amw/health');

    expect(res.body.redis).toBe(expected);
  });
});

describe('GET /widget.js', () => {
  it('serves the built widget as JavaScript', async () => {
    const projectDir = createProjectDir('window.AmwWidget = {};');

    const res = await request(createApp({ 'Server.projectDir': projectDir })).get('/amw/widget.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/javascript/);
    expect(res.text).toBe('window.AmwWidget = {};');
  });

  it('serves the widget when the project lives under a dot directory', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'amw-test-'));
    const projectDir = path.join(parent, '.local', 'amw');
    fs.mkdirSync(path.join(projectDir, 'dist', 'widgets'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'dist', 'widgets', 'widget.js'), 'window.AmwWidget = {};');

    const res = await request(createApp({ 'Server.projectDir': projectDir })).get('/amw/widget.js');

    expect(res.status).toBe(200);
    expect(res.text).toBe('window.AmwWidget = {};');
  });

  it('answers a JSON 404 when the widget has not been built', async () => {
    const res = await request(createApp({ 'Server.projectDir': '/nonexistent' })).get('/amw/widget.js');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toMatchObject({ error: 'Not Found', message: 'widget.js is not available' });
  });

  it('answers a JSON 500 without details on other file errors', async () => {
    const projectDir = createProjectDir();
    // A directory where the file is expected makes send fail with a non-404 error
    fs.rmSync(path.join(projectDir, 'dist', 'widgets', 'widget.js'));
    fs.mkdirSync(path.join(projectDir, 'dist', 'widgets', 'widget.js'));

    const res = await request(createApp({ 'Server.projectDir': projectDir })).get('/amw/widget.js');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toMatchObject({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
  });
});

describe('Other routes and middleware', () => {
  it('describes the endpoints on /info', async () => {
    const res = await request(createApp({ 'Server.path': '/item' })).get('/item/info');

    expect(res.status).toBe(200);
    expect(res.body.endpoints).toEqual(['/item/product', '/item/widget.js', '/item/health', '/item/info']);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/amw/unknown');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Not Found', message: 'Route /amw/unknown not found' });
  });

  it('sets Cache-Control from Server.httpCache and hides X-Powered-By', async () => {
    const res = await request(createApp({ 'Server.httpCache': 42 })).get('/amw/health');

    expect(res.headers['cache-control']).toBe('max-age=42');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sends CORS headers only when Server.cors is enabled', async () => {
    const withCors = await request(createApp({ 'Server.cors': 'true' })).get('/amw/health');
    const withoutCors = await request(createApp()).get('/amw/health');

    expect(withCors.headers['access-control-allow-origin']).toBe('*');
    expect(withoutCors.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('honours Server.trustProxy when resolving the client IP', async () => {
    const app = createApp({ 'Server.trustProxy': 1 });

    await request(app).get('/amw/product?id=B084DN3XVN').set('X-Forwarded-For', '203.0.113.7');

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('IP=203.0.113.7'));
  });
});

describe('AmwServer configuration', () => {
  it.each([
    ['an out of range port', { 'Server.port': 70000 }, /Invalid port configuration: 70000/],
    ['a relative path without a leading slash', { 'Server.path': 'amw' }, /Invalid relative path: amw/],
    ['a negative HTTP cache', { 'Server.httpCache': -1 }, /Invalid HTTP cache configuration: -1/],
    ['an empty project directory', { 'Server.projectDir': '' }, /Server.projectDir configuration is required/],
    ['a negative Redis TTL', { 'Redis.expire': -5 }, /Redis.expire must be a positive number/],
  ])('refuses to start with %s', (_label, overrides, message) => {
    const { AmwServer } = loadModules(overrides);

    expect(() => new AmwServer()).toThrow(message);
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize AMW Server:', expect.any(Error));
  });

  it('falls back to defaults for empty port, path and HTTP cache settings', async () => {
    const app = createApp({
      'Server.port': null,
      'Server.path': '',
      'Server.httpCache': 0,
      'Server.trustProxy': undefined,
    });

    const res = await request(app).get('/amw/health');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('max-age=300');
  });

  it('creates the Redis client lazily with the configured credentials', () => {
    const { AmwServer } = loadModules({
      'Redis.enabled': true,
      'Redis.host': 'redis.local',
      'Redis.port': 6380,
      'Redis.username': 'amw',
      'Redis.password': 'secret',
    });

    new AmwServer();

    expect(mockRedisConstructor).toHaveBeenCalledWith({
      host: 'redis.local',
      port: 6380,
      username: 'amw',
      password: 'secret',
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    expect(mockRedis.on.mock.calls.map(([event]) => event)).toEqual(['connect', 'error', 'close']);
  });

  it('logs Redis connection events', () => {
    const { AmwServer } = loadModules({ 'Redis.enabled': true });
    new AmwServer();
    const handlers = Object.fromEntries(mockRedis.on.mock.calls);

    handlers.connect();
    handlers.error(new Error('ECONNRESET'));
    handlers.close();

    expect(mockLogger.info).toHaveBeenCalledWith('Redis connection established');
    expect(mockLogger.error).toHaveBeenCalledWith('Redis connection error:', expect.any(Error));
    expect(mockLogger.warn).toHaveBeenCalledWith('Redis connection closed');
  });

  it('wraps a Redis client creation failure', () => {
    const { AmwServer } = loadModules({ 'Redis.enabled': true });
    const Redis = jest.requireMock('ioredis').default as jest.Mock;
    Redis.mockImplementationOnce(() => {
      throw new Error('bad options');
    });

    expect(() => new AmwServer()).toThrow('Redis initialization failed: bad options');
  });
});

describe('AmwServer lifecycle', () => {
  const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'] as const;
  let listenersBefore: Map<string, Function[]>;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    listenersBefore = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!listenersBefore.get(signal)!.includes(listener)) {
          process.removeListener(signal, listener as NodeJS.SignalsListener);
        }
      }
    }
    exitSpy.mockRestore();
  });

  function newSignalListener(signal: string): () => void {
    return process.listeners(signal as NodeJS.Signals).find(
      (listener) => !listenersBefore.get(signal)!.includes(listener)
    ) as () => void;
  }

  function startWithFakeHttpServer(overrides: Record<string, unknown> = {}) {
    const { AmwServer } = loadModules(overrides);
    const amwServer = new AmwServer();
    const httpServer = Object.assign(new EventEmitter(), {
      close: jest.fn((callback: () => void) => callback()),
    });
    const listen = jest.spyOn(amwServer.getApp(), 'listen').mockImplementation(((
      _port: number,
      callback: () => void
    ) => {
      callback();
      return httpServer;
    }) as never);
    return { amwServer, httpServer, listen };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('does not register process signal handlers until started', () => {
    const { AmwServer } = loadModules();

    new AmwServer();

    for (const signal of signals) {
      expect(process.listeners(signal)).toHaveLength(listenersBefore.get(signal)!.length);
    }
  });

  it('listens on the configured port and registers the shutdown handlers', async () => {
    const { amwServer, listen } = startWithFakeHttpServer({ 'Server.port': 9090 });

    await amwServer.start();

    expect(listen).toHaveBeenCalledWith(9090, expect.any(Function));
    for (const signal of signals) {
      expect(newSignalListener(signal)).toBeDefined();
    }
  });

  it('connects to Redis before listening when the cache is enabled', async () => {
    const { amwServer } = startWithFakeHttpServer({ 'Redis.enabled': true });

    await amwServer.start();

    expect(mockRedis.connect).toHaveBeenCalledTimes(1);
  });

  it('fails to start when Redis is unreachable', async () => {
    mockRedis.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { amwServer, listen } = startWithFakeHttpServer({ 'Redis.enabled': true });

    await expect(amwServer.start()).rejects.toThrow('ECONNREFUSED');
    expect(listen).not.toHaveBeenCalled();
  });

  it('exits with code 1 on an HTTP server error', async () => {
    const { amwServer, httpServer } = startWithFakeHttpServer();
    await amwServer.start();

    httpServer.emit('error', new Error('EADDRINUSE'));

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('closes the HTTP server and Redis, then exits with code 0 on SIGTERM', async () => {
    const { amwServer, httpServer } = startWithFakeHttpServer({ 'Redis.enabled': true });
    await amwServer.start();

    newSignalListener('SIGTERM')();
    await flush();

    expect(httpServer.close).toHaveBeenCalled();
    expect(mockRedis.quit).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('still exits with code 0 when closing Redis fails', async () => {
    mockRedis.quit.mockRejectedValueOnce(new Error('already closed'));
    const { amwServer } = startWithFakeHttpServer({ 'Redis.enabled': true });
    await amwServer.start();

    newSignalListener('SIGINT')();
    await flush();

    expect(mockLogger.warn).toHaveBeenCalledWith('Error closing Redis connection:', expect.any(Error));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits with code 1 when the shutdown itself fails', async () => {
    const { amwServer, httpServer } = startWithFakeHttpServer();
    httpServer.close.mockImplementation(() => {
      throw new Error('close failed');
    });
    await amwServer.start();

    newSignalListener('SIGUSR2')();
    await flush();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
