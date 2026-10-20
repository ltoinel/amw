/**
 * Per-route Cache-Control headers (#132, #124).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

const mockProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amw-cache-'));
fs.mkdirSync(path.join(mockProjectDir, 'dist', 'widgets'), { recursive: true });
fs.writeFileSync(path.join(mockProjectDir, 'dist', 'widgets', 'widget.js'), '/* widget */');

const mockConfig: Record<string, unknown> = {
  'Server.port': 8080,
  'Server.path': '/amw',
  'Server.debug': false,
  'Server.cors': false,
  'Server.projectDir': mockProjectDir,
  'Server.httpCache': 1234,
  'Server.rateLimit': 2,
  'Redis.enabled': false,
  'Redis.expire': 3600,
};

jest.mock('config', () => ({
  get: (key: string) => mockConfig[key],
  has: (key: string) => key in mockConfig,
}));

jest.mock('../src/utils/ConfigLog4j', () => ({
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockGetItemApi = jest.fn();
jest.mock('../src/server/Paapi', () => ({
  Paapi: jest.fn().mockImplementation(() => ({
    getItemApi: mockGetItemApi,
    searchItemApi: jest.fn(),
  })),
}));

import { AmwServer } from '../src/server/AmwServer';

describe('Cache-Control per route', () => {
  const app = new AmwServer().getApp();

  afterAll(() => {
    fs.rmSync(mockProjectDir, { recursive: true, force: true });
  });

  test('a found product is publicly cacheable for Server.httpCache seconds', async () => {
    mockGetItemApi.mockResolvedValueOnce({ title: 'Echo', url: 'u', image: 'i', brand: '', price: 1, timestamp: 1 });
    const res = await request(app).get('/amw/product?id=B08N5WRWNW').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=1234');
  });

  test('a product error is not cached', async () => {
    mockGetItemApi.mockResolvedValueOnce(null);
    const res = await request(app).get('/amw/product?id=B000000000').expect(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('a rate-limited request is not cached', async () => {
    // Server.rateLimit is 2 and the previous tests consumed it
    const res = await request(app).get('/amw/product?id=B08N5WRWNW').expect(429);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('a validation error is not cached', async () => {
    const res = await request(app).get('/amw/product');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('/health is never cached', async () => {
    const res = await request(app).get('/amw/health').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('an unknown route is not cached', async () => {
    const res = await request(app).get('/amw/nope').expect(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  // The stable widget URL is revalidated hourly so integrations pick up new releases;
  // the content-hashed copies (#135) carry the long-lived immutable policy instead.
  test('widget.js keeps its short stable-URL policy regardless of Server.httpCache', async () => {
    const res = await request(app).get('/amw/widget.js').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });
});
