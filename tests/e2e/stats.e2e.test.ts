/**
 * End-to-end tests of the usage statistics: the click beacon, the admin API
 * and, when REDIS_HOST designates a Redis instance, a full collection round-trip.
 */

import { randomUUID } from 'crypto';
import { AmwServer, Json, isRedisReachable, startAmwServer } from './support/amwServer';
import { ASIN_NOT_FOUND, MockAmazonApi, startMockAmazonApi } from './support/mockAmazonApi';

const PASSWORD = 'e2e admin password';
const describeWithRedis = process.env.REDIS_HOST ? describe : describe.skip;

async function login(amw: AmwServer): Promise<Record<string, string>> {
  const response = await fetch(`${amw.baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  });
  expect(response.status).toBe(200);
  const { token } = await response.json() as Json;
  return { Authorization: `Bearer ${token}` };
}

async function getJson(amw: AmwServer, path: string, headers: Record<string, string>): Promise<Json> {
  const response = await fetch(`${amw.baseUrl}${path}`, { headers });
  expect(response.status).toBe(200);
  return await response.json() as Json;
}

describe('Usage statistics without Redis (e2e)', () => {
  let mock: MockAmazonApi;
  let amw: AmwServer;

  beforeAll(async () => {
    mock = await startMockAmazonApi();
    amw = await startAmwServer({
      mockApiUrl: mock.url,
      config: { Admin: { enabled: true } },
      env: { AMW_ADMIN_PASSWORD: PASSWORD }
    });
  });

  afterAll(async () => {
    await amw?.stop();
    await mock?.close();
  });

  it('accepts a click beacon with 204, no cookie and no caching', async () => {
    const response = await fetch(`${amw.baseUrl}/click?id=B084DN3XVN`, { method: 'POST' });

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a click beacon without a valid ASIN', async () => {
    const response = await fetch(`${amw.baseUrl}/click?id=not-an-asin`, { method: 'POST' });

    expect(response.status).toBe(400);
  });

  it('serves the built administration portal', async () => {
    const response = await fetch(`${amw.baseUrl}/admin/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await response.text()).toContain('<title>AMW Admin</title>');
  });

  it('protects the admin API and says that statistics require Redis', async () => {
    expect((await fetch(`${amw.baseUrl}/admin/api/status`)).status).toBe(401);

    const auth = await login(amw);
    expect(await getJson(amw, '/admin/api/status', auth)).toMatchObject({ stats: false, message: 'Statistics require Redis' });
    expect((await fetch(`${amw.baseUrl}/admin/api/stats/daily`, { headers: auth })).status).toBe(503);
  });
});

describeWithRedis('Usage statistics with Redis (e2e)', () => {
  let mock: MockAmazonApi;
  let amw: AmwServer;

  // Statistics accumulate in the shared Redis: a unique ASIN isolates this run
  const asin = `B0${randomUUID().slice(0, 8).toUpperCase()}`;

  beforeAll(async () => {
    if (!(await isRedisReachable())) {
      throw new Error(`REDIS_HOST is set but Redis is not reachable at ${process.env.REDIS_HOST}`);
    }
    mock = await startMockAmazonApi();
    amw = await startAmwServer({
      mockApiUrl: mock.url,
      config: {
        Redis: {
          enabled: true,
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT) || 6379,
          expire: 60
        },
        Admin: { enabled: true }
      },
      env: { AMW_ADMIN_PASSWORD: PASSWORD }
    });
  });

  afterAll(async () => {
    await amw?.stop();
    await mock?.close();
  });

  it('reports lookups and clicks through the admin API', async () => {
    const referer = 'https://blog.example/post';
    const before = (await getJson(amw, '/admin/api/stats/daily?days=1', await login(amw)))[0];

    expect((await fetch(`${amw.baseUrl}/product?id=${asin}`)).status).toBe(200);
    expect((await fetch(`${amw.baseUrl}/product?id=${asin}`)).status).toBe(200);
    expect((await fetch(`${amw.baseUrl}/product?id=${ASIN_NOT_FOUND}`, { headers: { Referer: `${referer}?utm=1` } })).status).toBe(404);
    expect((await fetch(`${amw.baseUrl}/click?id=${asin}`, { method: 'POST' })).status).toBe(204);
    // Collection is fire-and-forget: give the writes a moment to land
    await new Promise(resolve => setTimeout(resolve, 200));

    const auth = await login(amw);
    const [today] = await getJson(amw, '/admin/api/stats/daily?days=1', auth) as Json[];
    expect(today.amazon - before.amazon).toBeGreaterThanOrEqual(1);
    expect(today.cache - before.cache).toBeGreaterThanOrEqual(1);
    expect(today.notfound - before.notfound).toBeGreaterThanOrEqual(1);
    expect(today.clicks - before.clicks).toBeGreaterThanOrEqual(1);

    const products = await getJson(amw, '/admin/api/stats/products?days=1&limit=500', auth) as Json[];
    expect(products.find(product => product.value === asin)).toMatchObject({ impressions: 2, clicks: 1, ctr: 0.5 });

    const notFound = await getJson(amw, '/admin/api/stats/notfound?limit=500', auth) as Json[];
    const missing = notFound.find(product => product.value === ASIN_NOT_FOUND);
    expect(missing?.referers).toEqual(expect.arrayContaining([expect.objectContaining({ url: referer })]));
  });
});
