/**
 * Usage statistics wired into the real AmwServer application: /product hooks,
 * the /click beacon and the admin API, with Redis replaced by an in-memory fake.
 */

import request from 'supertest';
import { loadModules, createLoggerMock, createAmazonItem } from './helpers/mocks';

const mockLogger = createLoggerMock();
const mockGetItems = jest.fn();
const mockSearchItems = jest.fn();
const PASSWORD = 'correct horse battery';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

jest.mock('ioredis', () => {
  const { createFakeRedis } = jest.requireActual('./helpers/fakeRedis');
  const Redis = jest.fn().mockImplementation(() => Object.assign(createFakeRedis(), { on: jest.fn() }));
  return { __esModule: true, default: Redis, Redis };
});

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({ getItems: mockGetItems, searchItems: mockSearchItems })),
  GetItemsRequestContent: jest.fn().mockImplementation((partnerTag, itemIds) => ({ partnerTag, itemIds })),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => value },
  SearchItemsResource: { constructFromObject: (value: string) => value },
  Condition: { constructFromObject: (value: string) => value },
}));

const flush = () => new Promise(resolve => setImmediate(resolve));

function createApp(overrides: Record<string, unknown> = {}) {
  const { AmwServer } = loadModules(overrides);
  return new AmwServer().getApp();
}

async function login(app: ReturnType<typeof createApp>): Promise<Record<string, string>> {
  const res = await request(app).post('/amw/admin/api/login').send({ password: PASSWORD });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.token}` };
}

// The first import compiles every server module; done once here so that slow
// machines do not hit the per-test timeout
beforeAll(() => {
  loadModules();
}, 60000);

beforeEach(() => {
  process.env.AMW_ADMIN_PASSWORD = PASSWORD;
});

afterEach(() => {
  delete process.env.AMW_ADMIN_PASSWORD;
});

describe('Statistics through the server', () => {
  it('counts Amazon, cache and not-found lookups and clicks, and serves them to the admin', async () => {
    const app = createApp({ 'Redis.enabled': true, 'Admin.enabled': true });

    mockGetItems.mockResolvedValueOnce({ itemsResult: { items: [createAmazonItem()] } });
    expect((await request(app).get('/amw/product?id=B084DN3XVN')).status).toBe(200);
    expect((await request(app).get('/amw/product?id=B084DN3XVN')).status).toBe(200);
    mockGetItems.mockResolvedValueOnce({ itemsResult: { items: [] } });
    expect((await request(app).get('/amw/product?id=B00GONE001').set('Referer', 'https://blog.example/post?a=1')).status).toBe(404);
    expect((await request(app).post('/amw/click?id=B084DN3XVN')).status).toBe(204);
    await flush();

    const auth = await login(app);
    const daily = await request(app).get('/amw/admin/api/stats/daily?days=1').set(auth);
    expect(daily.body).toEqual([expect.objectContaining({ amazon: 1, cache: 1, notfound: 1, clicks: 1 })]);

    const products = await request(app).get('/amw/admin/api/stats/products').set(auth);
    expect(products.body[0]).toMatchObject({ value: 'B084DN3XVN', title: 'Arduino Uno R3', impressions: 2, clicks: 1, ctr: 0.5 });

    const notFound = await request(app).get('/amw/admin/api/stats/notfound').set(auth);
    expect(notFound.body[0]).toMatchObject({ value: 'B00GONE001', count: 1, referers: [{ url: 'https://blog.example/post', count: 1 }] });
  });

  it('counts keyword lookups too', async () => {
    const app = createApp({ 'Redis.enabled': true, 'Admin.enabled': true });
    mockSearchItems.mockResolvedValueOnce({ searchResult: { items: [] } });

    const res = await request(app).get('/amw/product?keyword=arduino');
    await flush();
    const auth = await login(app);
    const daily = await request(app).get('/amw/admin/api/stats/daily?days=1').set(auth);
    // An empty search result is a real "not found", unlike an Amazon failure
    expect(res.status).toBe(404);
    expect(daily.body[0].notfound).toBe(1);
  });

  it('accepts click beacons without Redis and rejects invalid ASINs', async () => {
    const app = createApp();
    expect((await request(app).post('/amw/click?id=B084DN3XVN')).status).toBe(204);
    expect((await request(app).post('/amw/click?id=nope')).status).toBe(400);
  });

  it('does not expose the admin by default', async () => {
    const res = await request(createApp()).get('/amw/admin/api/status');
    expect(res.status).toBe(404);
  });

  it('reports that statistics require Redis when the admin runs without it', async () => {
    const app = createApp({ 'Admin.enabled': true });
    const auth = await login(app);
    const res = await request(app).get('/amw/admin/api/status').set(auth);
    expect(res.body).toMatchObject({ stats: false, message: 'Statistics require Redis' });
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('statistics disabled: Redis is required'));
  });

  it('refuses to start when the admin is enabled without a password', () => {
    delete process.env.AMW_ADMIN_PASSWORD;
    const { AmwServer } = loadModules({ 'Admin.enabled': true });
    expect(() => new AmwServer()).toThrow('AMW_ADMIN_PASSWORD is not set');
  });
});
