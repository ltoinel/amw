/**
 * Tests of the Prometheus metrics: the Metrics recorder itself, then the `<path>/metrics` endpoint
 * of the real Express application, with the Amazon SDK, Redis and the logger replaced by mocks.
 */

import express from 'express';
import request from 'supertest';
import { Metrics } from '../src/utils/metrics';
import { loadModules, createLoggerMock, createRedisMock, createAmazonItem } from './helpers/mocks';

const mockLogger = createLoggerMock();
const mockRedis = createRedisMock();
const mockGetItems = jest.fn();

jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

jest.mock('ioredis', () => {
  const Redis = jest.fn().mockImplementation(() => mockRedis);
  return { __esModule: true, default: Redis, Redis };
});

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({ getItems: mockGetItems, searchItems: jest.fn() })),
  GetItemsRequestContent: jest.fn().mockImplementation((partnerTag, itemIds) => ({ partnerTag, itemIds })),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => value },
  SearchItemsResource: { constructFromObject: (value: string) => value },
  Condition: { constructFromObject: (value: string) => value },
}));

beforeEach(() => {
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
  mockGetItems.mockResolvedValue({ itemsResult: { items: [createAmazonItem()] } });
});

describe('Metrics', () => {
  it('records HTTP requests by route pattern and status, never by raw URL', async () => {
    const metrics = new Metrics();
    const app = express();
    app.use(metrics.httpMiddleware());
    app.get('/amw/product', (_req, res) => { res.json({}); });

    await request(app).get('/amw/product?id=B084DN3XVN');
    await request(app).get('/random/path');
    const output = await metrics.registry.metrics();

    expect(output).toContain('amw_http_requests_total{method="GET",route="/amw/product",status="200"} 1');
    expect(output).toContain('amw_http_requests_total{method="GET",route="unmatched",status="404"} 1');
    expect(output).toMatch(/amw_http_request_duration_seconds_count\{method="GET",route="\/amw\/product",status="200"\} 1/);
    expect(output).not.toContain('B084DN3XVN');
  });

  it('times Amazon calls by outcome and rethrows failures', async () => {
    const metrics = new Metrics();
    const classify = (found: boolean) => (found ? 'found' as const : 'not_found' as const);

    await expect(metrics.observeAmazonCall('getItems', async () => true, classify)).resolves.toBe(true);
    await metrics.observeAmazonCall('searchItems', async () => false, classify);
    await expect(metrics.observeAmazonCall('getItems', async () => { throw new Error('boom'); }, classify)).rejects.toThrow('boom');
    const output = await metrics.registry.metrics();

    expect(output).toContain('amw_amazon_request_duration_seconds_count{operation="getItems",outcome="found"} 1');
    expect(output).toContain('amw_amazon_request_duration_seconds_count{operation="searchItems",outcome="not_found"} 1');
    expect(output).toContain('amw_amazon_request_duration_seconds_count{operation="getItems",outcome="error"} 1');
  });

  it('counts cache lookups by result', async () => {
    const metrics = new Metrics();
    metrics.recordCacheLookup('hit');
    metrics.recordCacheLookup('hit');
    metrics.recordCacheLookup('miss');
    const output = await metrics.registry.metrics();

    expect(output).toContain('amw_cache_lookups_total{result="hit"} 2');
    expect(output).toContain('amw_cache_lookups_total{result="miss"} 1');
  });

  it('adds process metrics only once enabled', async () => {
    const metrics = new Metrics();
    expect(await metrics.registry.metrics()).not.toContain('amw_process_cpu_seconds_total');

    metrics.enableProcessMetrics();
    expect(await metrics.registry.metrics()).toContain('amw_process_cpu_seconds_total');
  });
});

describe('GET /metrics', () => {
  function createApp(overrides: Record<string, unknown> = {}) {
    const { AmwServer } = loadModules(overrides);
    return new AmwServer().getApp();
  }

  it('is not exposed by default', async () => {
    const app = createApp({ 'Server.metrics': undefined });

    expect((await request(app).get('/amw/metrics')).status).toBe(404);
    expect((await request(app).get('/amw/info')).body.endpoints).not.toContain('/amw/metrics');
  });

  it('is not exposed when Server.metrics is false', async () => {
    expect((await request(createApp({ 'Server.metrics': false })).get('/amw/metrics')).status).toBe(404);
  });

  it.each([[true], ['true']])('exposes Prometheus metrics when Server.metrics is %p', async (enabled) => {
    const app = createApp({ 'Server.metrics': enabled });
    const res = await request(app).get('/amw/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.text).toContain('amw_process_cpu_seconds_total');
    expect((await request(app).get('/amw/info')).body.endpoints).toContain('/amw/metrics');
  });

  it('reports product requests, Amazon calls, cache lookups and rate-limit rejections', async () => {
    const app = createApp({ 'Server.metrics': true, 'Server.rateLimit': 2, 'Redis.enabled': true });
    // A cache hit must be fresh (timestamped) or the product is fetched again from Amazon
    mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify({ ...createAmazonItem(), timestamp: Date.now() }));

    await request(app).get('/amw/product?id=B084DN3XVN');
    await request(app).get('/amw/product?id=B084DN3XVN');
    expect((await request(app).get('/amw/product?id=B084DN3XVN')).status).toBe(429);
    const output = (await request(app).get('/amw/metrics')).text;

    expect(output).toContain('amw_http_requests_total{method="GET",route="/amw/product",status="200"} 2');
    expect(output).toContain('amw_http_requests_total{method="GET",route="/amw/product",status="429"} 1');
    expect(output).toContain('amw_rate_limit_rejections_total{route="/amw/product"} 1');
    expect(output).toContain('amw_amazon_request_duration_seconds_count{operation="getItems",outcome="found"} 1');
    expect(output).toContain('amw_cache_lookups_total{result="miss"} 1');
    expect(output).toContain('amw_cache_lookups_total{result="hit"} 1');
  });

  it('counts a /products batch as a single Amazon call', async () => {
    const app = createApp({ 'Server.metrics': true });
    mockGetItems.mockResolvedValue({ itemsResult: { items: [createAmazonItem({ asin: 'B084DN3XVN' })] } });

    expect((await request(app).get('/amw/products?ids=B084DN3XVN,B08N5WRWNW')).status).toBe(200);
    const output = (await request(app).get('/amw/metrics')).text;

    expect(output).toContain('amw_http_requests_total{method="GET",route="/amw/products",status="200"} 1');
    expect(output).toContain('amw_amazon_request_duration_seconds_count{operation="getItems",outcome="found"} 1');
  });
});
