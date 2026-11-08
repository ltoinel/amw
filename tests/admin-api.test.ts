/**
 * Unit tests for the administration API (src/server/AdminApi.ts)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createFakeRedis } from './helpers/fakeRedis';

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

const mockConfig: Record<string, unknown> = { 'Server.projectDir': '/nonexistent' };
jest.mock('config', () => ({
  has: (key: string) => key in mockConfig,
  get: (key: string) => mockConfig[key]
}));

import { AdminApi } from '../src/server/AdminApi';
import { Stats } from '../src/server/Stats';
import { loadSettings } from '../src/server/Settings';
import { Insights, InsightsError } from '../src/server/Insights';
import { RecommendationStore } from '../src/server/RecommendationStore';
import { EffectSettings, StuffingSettings, ThemeTestSettings } from '../src/server/StuffingSettings';

const PASSWORD = 'correct horse battery';

function buildApp(stats: Stats, loginRateLimit?: number, insights?: Insights): { app: express.Application; admin: AdminApi } {
  const admin = new AdminApi(stats, { password: PASSWORD, secret: 'test-secret', loginRateLimit, insights });
  const app = express();
  app.use('/amw/admin', admin.router());
  return { app, admin };
}

async function login(app: express.Application): Promise<string> {
  const res = await request(app).post('/amw/admin/api/login').send({ password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token;
}

describe('AdminApi configuration', () => {
  afterEach(() => {
    delete mockConfig['Admin.enabled'];
  });

  test('is disabled by default', () => {
    expect(AdminApi.fromSettings(new Stats(), loadSettings(), {})).toBeUndefined();
  });

  test('refuses to start without a password', () => {
    mockConfig['Admin.enabled'] = true;
    expect(() => AdminApi.fromSettings(new Stats(), loadSettings(), {})).toThrow('AMW_ADMIN_PASSWORD is not set');
  });

  test('refuses a weak password', () => {
    mockConfig['Admin.enabled'] = true;
    expect(() => AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: 'short' }))
      .toThrow('at least 12 characters');
  });

  test('reads the password and the options when enabled', () => {
    mockConfig['Admin.enabled'] = true;
    mockConfig['Admin.tokenTtl'] = 60;
    mockConfig['Admin.loginRateLimit'] = 3;
    const admin = AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_ADMIN_SECRET: 's' });
    expect(admin).toBeInstanceOf(AdminApi);
    const { expiresAt } = admin!.createToken(0);
    expect(expiresAt).toBe(new Date(60 * 1000).toISOString());
  });

  test('reports the build version from the Docker build arguments', async () => {
    mockConfig['Admin.enabled'] = true;
    try {
      const status = async (env: NodeJS.ProcessEnv) => {
        const admin = AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, ...env }, '5.1.0')!;
        const app = express();
        app.use('/amw/admin', admin.router());
        const token = await login(app);
        return (await request(app).get('/amw/admin/api/status').set('Authorization', `Bearer ${token}`)).body.version;
      };
      expect(await status({ AMW_REVISION: 'd3d5300a1b2c', AMW_BUILD_DATE: '2026-10-31T09:00:00Z' }))
        .toEqual({ release: '5.1.0', revision: 'd3d5300a1b2c', buildDate: '2026-10-31T09:00:00Z' });
      // Outside a Docker build, or with unexpected values: nothing but the release
      expect(await status({ AMW_REVISION: '<script>', AMW_BUILD_DATE: 'soon' }))
        .toEqual({ release: '5.1.0', revision: null, buildDate: null });
    } finally {
      delete mockConfig['Admin.enabled'];
    }
  });

  test('only a boolean true enables it', () => {
    mockConfig['Admin.enabled'] = 'yes';
    expect(AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD })).toBeUndefined();
  });
});

describe('AdminApi tokens', () => {
  const { admin } = buildApp(new Stats());

  test('accepts a fresh token and rejects it once expired', () => {
    const { token } = admin.createToken(1000);
    expect(admin.verifyToken(token, 1000)).toBe(true);
    expect(admin.verifyToken(token, 1000 + 3600 * 1000)).toBe(false);
  });

  test('rejects tampered or malformed tokens', () => {
    const { token } = admin.createToken(1000);
    const [expiry, signature] = token.split('.');
    expect(admin.verifyToken(`${Number(expiry) + 1}.${signature}`, 1000)).toBe(false);
    expect(admin.verifyToken(`${expiry}.${signature.slice(0, -1)}A`, 1000)).toBe(false);
    expect(admin.verifyToken(`${expiry}.${signature}.x`, 1000)).toBe(false);
    expect(admin.verifyToken('garbage', 1000)).toBe(false);
  });

  test('rejects a token signed with another secret', () => {
    const other = new AdminApi(new Stats(), { password: PASSWORD, secret: 'other-secret' });
    expect(admin.verifyToken(other.createToken().token)).toBe(false);
  });
});

describe('AdminApi routes', () => {
  test('rejects a wrong password', async () => {
    const { app } = buildApp(new Stats());
    const res = await request(app).post('/amw/admin/api/login').send({ password: 'wrong password!' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test('rejects a login without a password field', async () => {
    const { app } = buildApp(new Stats());
    const res = await request(app).post('/amw/admin/api/login').send({});
    expect(res.status).toBe(401);
  });

  test('answers 503 when reading the statistics fails', async () => {
    const stats = new Stats(createFakeRedis());
    jest.spyOn(stats, 'getNotFound').mockRejectedValue(new Error('connection lost'));
    const { app } = buildApp(stats);
    const token = await login(app);
    const res = await request(app).get('/amw/admin/api/stats/notfound').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('Statistics are temporarily unavailable');
  });

  test('rate limits failed logins', async () => {
    const { app } = buildApp(new Stats(), 2);
    for (let i = 0; i < 2; i++) {
      await request(app).post('/amw/admin/api/login').send({ password: 'wrong password!' });
    }
    const res = await request(app).post('/amw/admin/api/login').send({ password: PASSWORD });
    expect(res.status).toBe(429);
  });

  test('requires a bearer token and never caches', async () => {
    const { app } = buildApp(new Stats());
    const anonymous = await request(app).get('/amw/admin/api/status');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');

    const forged = await request(app).get('/amw/admin/api/status').set('Authorization', 'Bearer 99999999999999.abc');
    expect(forged.status).toBe(401);
  });

  test('reports that statistics require Redis', async () => {
    const { app } = buildApp(new Stats());
    const token = await login(app);

    const status = await request(app).get('/amw/admin/api/status').set('Authorization', `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ stats: false, message: 'Statistics require Redis' });

    const daily = await request(app).get('/amw/admin/api/stats/daily').set('Authorization', `Bearer ${token}`);
    expect(daily.status).toBe(503);
    expect(daily.body.message).toBe('Statistics require Redis');
  });

  test('serves statistics when Redis is available', async () => {
    const redis = createFakeRedis();
    const stats = new Stats(redis);
    stats.recordProduct('cache', 'id', 'B084DN3XVN', 'https://blog.example/post?x=1');
    stats.recordViews(['B084DN3XVN'], 'https://blog.example/post?x=1');
    stats.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/post?x=1');
    stats.recordClick('B084DN3XVN', 'https://blog.example/post');
    await new Promise(resolve => setImmediate(resolve));

    const { app } = buildApp(stats);
    const token = await login(app);
    const auth = { Authorization: `Bearer ${token}` };

    const daily = await request(app).get('/amw/admin/api/stats/daily?days=7').set(auth);
    expect(daily.status).toBe(200);
    expect(daily.body).toHaveLength(7);
    expect(daily.body[6]).toMatchObject({ cache: 1, notfound: 1, clicks: 1 });

    const products = await request(app).get('/amw/admin/api/stats/products?days=abc&limit=5').set(auth);
    expect(products.status).toBe(200);
    expect(products.body[0]).toMatchObject({ value: 'B084DN3XVN', impressions: 1, clicks: 1, ctr: 1 });

    const count = await request(app).get('/amw/admin/api/stats/products/count?days=7').set(auth);
    expect(count.status).toBe(200);
    expect(count.body).toEqual({ count: 1 });

    const pages = await request(app).get('/amw/admin/api/stats/pages?days=7&limit=5').set(auth);
    expect(pages.status).toBe(200);
    expect(pages.body).toEqual([{ url: 'https://blog.example/post', impressions: 1, clicks: 1, ctr: 1 }]);

    const sorted = await request(app).get('/amw/admin/api/stats/pages?sort=ctr').set(auth);
    expect(sorted.status).toBe(200);
    expect(sorted.body).toHaveLength(1);

    const invalidSort = await request(app).get('/amw/admin/api/stats/pages?sort=url').set(auth);
    expect(invalidSort.status).toBe(400);
    expect(invalidSort.body.message).toBe('sort must be one of: clicks, impressions, ctr');

    const filtered = await request(app).get('/amw/admin/api/stats/pages?domain=other.example').set(auth);
    expect(filtered.status).toBe(200);
    expect(filtered.body).toEqual([]);

    const invalidDomain = await request(app).get('/amw/admin/api/stats/pages?domain=https://x').set(auth);
    expect(invalidDomain.status).toBe(400);

    const domains = await request(app).get('/amw/admin/api/stats/domains?days=7').set(auth);
    expect(domains.status).toBe(200);
    expect(domains.body).toEqual([{ domain: 'blog.example', impressions: 1, clicks: 1, ctr: 1 }]);

    const trends = await request(app).get('/amw/admin/api/stats/domains/daily?days=7&limit=99').set(auth);
    expect(trends.status).toBe(200);
    expect(trends.body).toHaveLength(1);
    expect(trends.body[0].daily).toHaveLength(7);
    expect(trends.body[0].daily[6]).toMatchObject({ impressions: 1, clicks: 1, ctr: 1 });

    const notFound = await request(app).get('/amw/admin/api/stats/notfound').set(auth);
    expect(notFound.body[0]).toMatchObject({ value: 'B00GONE001', referers: [{ url: 'https://blog.example/post', count: 1 }] });
    // No marketplace configured: no Amazon link
    expect(notFound.body[0].url).toBeUndefined();
  });
});

describe('AdminApi not-found links', () => {
  async function notFound(marketplace: string | undefined) {
    const stats = new Stats(createFakeRedis());
    stats.recordProduct('notfound', 'id', 'B00GONE001');
    stats.recordProduct('notfound', 'keyword', 'old & rare');
    await new Promise(resolve => setImmediate(resolve));
    const admin = new AdminApi(stats, { password: PASSWORD, secret: 'test-secret', marketplace });
    const app = express();
    app.use('/amw/admin', admin.router());
    const token = await login(app);
    const res = await request(app).get('/amw/admin/api/stats/notfound').set('Authorization', `Bearer ${token}`);
    return Object.fromEntries(res.body.map((product: { value: string; url?: string }) => [product.value, product.url]));
  }

  test('links ASINs to their product page and keywords to a search, without the partner tag', async () => {
    expect(await notFound('www.amazon.fr')).toEqual({
      B00GONE001: 'https://www.amazon.fr/dp/B00GONE001',
      'old & rare': 'https://www.amazon.fr/s?k=old%20%26%20rare'
    });
  });

  test('ignores a marketplace that is not a host', async () => {
    expect(await notFound('evil.example/phish?')).toEqual({ B00GONE001: undefined, 'old & rare': undefined });
  });
});

describe('AdminApi insights', () => {
  const report = { available: true, days: 7, generatedAt: '2026-10-23T12:00:00.000Z', model: 'claude-opus-5-5', cached: false, summary: 'S', recommendations: [] };

  async function call(stats: Stats, insights?: Insights, query = '', method: 'get' | 'post' = 'post') {
    const { app } = buildApp(stats, undefined, insights);
    const token = await login(app);
    return request(app)[method](`/amw/admin/api/insights${query}`).set('Authorization', `Bearer ${token}`);
  }

  function fakeInsights(result: Promise<unknown>, latest: unknown = null) {
    return { report: jest.fn().mockReturnValue(result), latest: jest.fn().mockResolvedValue(latest) } as unknown as
      Insights & { report: jest.Mock; latest: jest.Mock };
  }

  test('is disabled unless Admin.insights is set', async () => {
    const res = await call(new Stats(createFakeRedis()));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'AI insights are disabled (Admin.insights)' });
  });

  test('enables insights only with Admin.insights', () => {
    mockConfig['Admin.enabled'] = true;
    mockConfig['Admin.insights'] = true;
    try {
      const admin = AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD });
      expect((admin as unknown as { insights: unknown }).insights).toBeInstanceOf(Insights);
    } finally {
      delete mockConfig['Admin.enabled'];
      delete mockConfig['Admin.insights'];
    }
  });

  test('requires Redis', async () => {
    const insights = fakeInsights(Promise.resolve(report));
    const res = await call(new Stats(), insights);
    expect(res.status).toBe(503);
    expect(insights.report).not.toHaveBeenCalled();
  });

  test('generates a report of the requested period on POST', async () => {
    const insights = fakeInsights(Promise.resolve(report));
    const res = await call(new Stats(createFakeRedis()), insights, '?days=7');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(report);
    expect(insights.report).toHaveBeenCalledWith(7);
  });

  test('serves the last report on GET without generating one', async () => {
    const stored = fakeInsights(Promise.resolve(report), { ...report, cached: true });
    const res = await call(new Stats(createFakeRedis()), stored, '?days=7', 'get');
    expect(res.body).toEqual({ ...report, cached: true });
    expect(stored.latest).toHaveBeenCalledWith(7);

    const none = fakeInsights(Promise.resolve(report));
    const missing = await call(new Stats(createFakeRedis()), none, '?days=30', 'get');
    expect(missing.body).toEqual({ available: true, days: 30, missing: true });
    expect(stored.report).not.toHaveBeenCalled();
    expect(none.report).not.toHaveBeenCalled();
  });

  test('answers 502 with its own message when Claude cannot answer', async () => {
    const declined = await call(new Stats(createFakeRedis()), fakeInsights(Promise.reject(new InsightsError('Claude declined to analyse these statistics'))));
    expect(declined.status).toBe(502);
    expect(declined.body.message).toBe('Claude declined to analyse these statistics');

    const unreachable = await call(new Stats(createFakeRedis()), fakeInsights(Promise.reject(new Error('401 invalid x-api-key sk-ant-...'))));
    expect(unreachable.status).toBe(502);
    expect(unreachable.body.message).toBe('The Claude API could not be reached, check ANTHROPIC_API_KEY');
  });
});

describe('Admin portal', () => {
  let staticDir: string;
  let app: express.Application;

  beforeAll(() => {
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amw-admin-'));
    fs.mkdirSync(path.join(staticDir, 'assets'));
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<!DOCTYPE html><title>AMW Admin</title>');
    fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
    const admin = new AdminApi(new Stats(), { password: PASSWORD, staticDir });
    app = express();
    app.use('/amw/admin', admin.router());
  });

  afterAll(() => {
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  test('redirects to the trailing slash so that relative assets resolve', async () => {
    const res = await request(app).get('/amw/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/amw/admin/');
  });

  test('serves the portal without authentication, with hardened headers', async () => {
    const res = await request(app).get('/amw/admin/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('AMW Admin');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');

    const asset = await request(app).get('/amw/admin/assets/app.js');
    expect(asset.status).toBe(200);
  });

  test('still protects the API', async () => {
    expect((await request(app).get('/amw/admin/api/status')).status).toBe(401);
  });

  test('serves the API alone when the portal is not built', async () => {
    const admin = new AdminApi(new Stats(), { password: PASSWORD, staticDir: '/nonexistent' });
    const apiOnly = express();
    apiOnly.use('/amw/admin', admin.router());
    expect((await request(apiOnly).get('/amw/admin/')).status).toBe(404);
  });
});

describe('AdminApi recommendations', () => {
  const HASH = 'a'.repeat(32);
  const OTHER = 'b'.repeat(32);
  const stored = (title: string, createdAt: string, product: string | null = 'panneau solaire') =>
    JSON.stringify({ url: `https://blog.example/${title}/`, title, product, createdAt });

  async function setup(enabled = true) {
    const redis = createFakeRedis();
    await redis.set(`amw:recommendation:${HASH}`, stored('ancien', '2026-11-01T00:00:00.000Z'));
    await redis.set(`amw:recommendation:${OTHER}`, stored('recent', '2026-11-05T00:00:00.000Z', null));
    // Other keys of the feature, which are not recommendations
    await redis.set('amw:recommendation-count:2026-11-05', '3');
    await redis.set(`amw:recommendation-missing:${'c'.repeat(32)}`, '1');
    await redis.set('amw:recommendation:corrompu', '{');

    const admin = new AdminApi(new Stats(redis), {
      password: PASSWORD,
      secret: 'test-secret',
      marketplace: 'www.amazon.fr',
      recommendations: enabled ? new RecommendationStore(redis) : undefined,
    });
    const app = express();
    app.use('/amw/admin', admin.router());
    const auth = { Authorization: `Bearer ${await login(app)}` };
    return { app, auth, redis };
  }

  const put = (app: express.Application, auth: Record<string, string>, hash: string, body: unknown) =>
    request(app).put(`/amw/admin/api/recommendations/${hash}`).set(auth).send(body as object);

  test('requires authentication', async () => {
    const { app } = await setup();
    expect((await request(app).get('/amw/admin/api/recommendations')).status).toBe(401);
    expect((await request(app).put(`/amw/admin/api/recommendations/${HASH}`).send({ product: 'x' })).status).toBe(401);
  });

  test('says so when the feature is disabled', async () => {
    const { app, auth } = await setup(false);
    const list = await request(app).get('/amw/admin/api/recommendations').set(auth);
    expect(list.body).toEqual({ available: false, reason: expect.stringContaining('Recommendation.enabled') });
    expect((await put(app, auth, HASH, { product: 'abc' })).status).toBe(404);
  });

  test('lists the recommendations only, most recent first, with a link to the Amazon search', async () => {
    const { app, auth } = await setup();
    const res = await request(app).get('/amw/admin/api/recommendations').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual(['recent', 'ancien']);
    expect(res.body.items[1]).toMatchObject({
      hash: HASH,
      url: 'https://blog.example/ancien/',
      product: 'panneau solaire',
      searchUrl: 'https://www.amazon.fr/s?k=panneau%20solaire',
    });
    expect(res.body.items[0].searchUrl).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('bounds the list without hiding the total', async () => {
    const { app, auth } = await setup();
    const res = await request(app).get('/amw/admin/api/recommendations?limit=1').set(auth);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(1);
  });

  test('edits the keywords, without expiry, and keeps the first suggestion of Claude', async () => {
    const { app, auth, redis } = await setup();
    const first = await put(app, auth, HASH, { product: 'kit solaire van' });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ product: 'kit solaire van', suggested: 'panneau solaire', searchUrl: 'https://www.amazon.fr/s?k=kit%20solaire%20van' });
    expect(first.body.editedAt).toEqual(expect.any(String));
    expect(await redis.ttl(`amw:recommendation:${HASH}`)).toBe(-1);

    const second = await put(app, auth, HASH, { product: 'batterie lithium' });
    expect(second.body).toMatchObject({ product: 'batterie lithium', suggested: 'panneau solaire' });
    expect(JSON.parse(await redis.get(`amw:recommendation:${HASH}`) as string)).toMatchObject({ product: 'batterie lithium', url: 'https://blog.example/ancien/' });
  });

  test('keeps a suggestion of no product, and can remove the keywords', async () => {
    const { app, auth } = await setup();
    expect((await put(app, auth, OTHER, { product: 'batterie' })).body).toMatchObject({ product: 'batterie', suggested: null });
    const removed = await put(app, auth, HASH, { product: null });
    expect(removed.body).toMatchObject({ product: null, suggested: 'panneau solaire' });
    expect(removed.body.searchUrl).toBeUndefined();
  });

  test('cleans the keywords like any search', async () => {
    const { app, auth } = await setup();
    expect((await put(app, auth, HASH, { product: ' <b>kit</b> "van"\n' })).body.product).toBe('bkit/b van');
  });

  test.each([
    ['too short', { product: 'x' }],
    ['empty after cleaning', { product: '<>' }],
    ['too long', { product: 'x'.repeat(101) }],
    ['not a string', { product: 42 }],
    ['missing', {}],
  ])('refuses keywords %s, and changes nothing', async (_name, body) => {
    const { app, auth, redis } = await setup();
    const before = await redis.get(`amw:recommendation:${HASH}`);
    expect((await put(app, auth, HASH, body)).status).toBe(400);
    expect(await redis.get(`amw:recommendation:${HASH}`)).toBe(before);
  });

  test('refuses an invalid hash, and a page without a recommendation', async () => {
    const { app, auth } = await setup();
    expect((await put(app, auth, 'not-a-hash', { product: 'abc' })).status).toBe(400);
    expect((await put(app, auth, 'd'.repeat(32), { product: 'abc' })).status).toBe(404);
  });

  test('answers 503 without details when Redis fails', async () => {
    const { app, auth, redis } = await setup();
    jest.spyOn(redis, 'scan').mockRejectedValue(new Error('secret'));
    jest.spyOn(redis, 'get').mockRejectedValue(new Error('secret'));

    for (const res of [await request(app).get('/amw/admin/api/recommendations').set(auth), await put(app, auth, HASH, { product: 'abc' })]) {
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toContain('secret');
    }
  });
});

describe('AdminApi Claude API usage', () => {
  test('requires a token and returns the usage of the period', async () => {
    const stats = new Stats(createFakeRedis());
    stats.recordLlmUsage('insights', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 100 });
    await new Promise(resolve => setImmediate(resolve));
    const { app } = buildApp(stats);

    expect((await request(app).get('/amw/admin/api/stats/llm')).status).toBe(401);
    const res = await request(app).get('/amw/admin/api/stats/llm?days=7').set('Authorization', `Bearer ${await login(app)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ feature: 'insights', calls: 1, estimatedCost: 0.006 })]);
  });

  test('answers 503 without Redis', async () => {
    const { app } = buildApp(new Stats());
    const res = await request(app).get('/amw/admin/api/stats/llm').set('Authorization', `Bearer ${await login(app)}`);
    expect(res.status).toBe(503);
  });
});

describe('AdminApi settings', () => {
  const sections = [{ title: 'Server', entries: [{ key: 'Server.port', env: 'SERVER_PORT', description: 'TCP port.', value: 8080 }] }];

  function buildSettingsApp(): express.Application {
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: 'test-secret', settings: sections }).router());
    return app;
  }

  test('requires a token', async () => {
    const res = await request(buildSettingsApp()).get('/amw/admin/api/settings');
    expect(res.status).toBe(401);
    expect(res.body.title).toBeUndefined();
  });

  test('answers without Redis and is never cached', async () => {
    const app = buildSettingsApp();
    const res = await request(app).get('/amw/admin/api/settings').set('Authorization', `Bearer ${await login(app)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sections);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('never sends a secret when built from the settings', async () => {
    mockConfig['Admin.enabled'] = true;
    mockConfig['Amazon.credentialSecret'] = 'sentinel-amazon-secret';
    mockConfig['Redis.password'] = 'sentinel-redis-password';
    try {
      const admin = AdminApi.fromSettings(new Stats(), loadSettings(), {
        AMW_ADMIN_PASSWORD: PASSWORD,
        AMW_ADMIN_SECRET: 'sentinel-admin-secret',
        ANTHROPIC_API_KEY: 'sentinel-anthropic-key'
      })!;
      const app = express();
      app.use('/amw/admin', admin.router());

      const res = await request(app).get('/amw/admin/api/settings').set('Authorization', `Bearer ${await login(app)}`);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('sentinel');
      expect(res.text).not.toContain(PASSWORD);
      expect(res.text).toContain('"description":"Creators API credential secret.","secret":true,"configured":true');
    } finally {
      delete mockConfig['Admin.enabled'];
      delete mockConfig['Amazon.credentialSecret'];
      delete mockConfig['Redis.password'];
    }
  });
});

describe('AdminApi stuffing', () => {
  const defaults = { count: 0, mode: 'recommendation' as const, containerId: 'main-content', products: [] as string[] };

  async function setup(redis: Parameters<typeof StuffingSettings.prototype.save>[0] | undefined, recommendationEnabled = true) {
    const stuffing = new StuffingSettings(defaults, redis as never);
    const admin = new AdminApi(new Stats(), { password: PASSWORD, secret: 's', stuffing, recommendationEnabled });
    const app = express();
    app.use('/amw/admin', admin.router());
    return { app, auth: `Bearer ${await login(app)}`, stuffing };
  }
  const put = (app: express.Application, auth: string, body: unknown) =>
    request(app).put('/amw/admin/api/stuffing').set('Authorization', auth).send(body as object);

  it('requires a token', async () => {
    const { app } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/stuffing')).status).toBe(401);
    expect((await request(app).put('/amw/admin/api/stuffing').send({ count: 3, containerId: 'x' })).status).toBe(401);
  });

  it('reads and saves the values, which then apply', async () => {
    const { app, auth, stuffing } = await setup(createFakeRedis());

    expect((await request(app).get('/amw/admin/api/stuffing').set('Authorization', auth)).body)
      .toEqual({ ...defaults, editable: true, recommendationEnabled: true });

    const res = await put(app, auth, { count: 2, containerId: 'article' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 2, containerId: 'article' });
    expect(stuffing.current()).toEqual({ count: 2, mode: 'recommendation', containerId: 'article', products: [] });

    const listed = await put(app, auth, { count: 2, containerId: 'article', products: ['B084DN3XVN', 'B000000001'] });
    expect(listed.status).toBe(200);
    expect(stuffing.current().products).toEqual(['B084DN3XVN', 'B000000001']);
  });

  it.each([
    [{ count: 6, containerId: 'x' }],
    [{ count: -1, containerId: 'x' }],
    [{ count: '2', containerId: 'x' }],
    [{ count: 1, containerId: 'x";alert(1);//' }],
    [{ count: 1, containerId: 'x', other: true }],
    [{ count: 1, containerId: 'x', products: ['b084dn3xvn'] }],
    [{ count: 1, containerId: 'x', products: 'B084DN3XVN' }],
    [{ count: 1, containerId: 'x', mode: 'random' }],
    [{ count: 1, containerId: 'x', products: Array.from({ length: 21 }, (_, i) => `B${String(i).padStart(9, '0')}`) }],
  ])('rejects %j', async body => {
    const { app, auth, stuffing } = await setup(createFakeRedis());
    expect((await put(app, auth, body)).status).toBe(400);
    expect(stuffing.current()).toEqual(defaults);
  });

  it('refuses cards without recommendations, but allows setting 0', async () => {
    const { app, auth } = await setup(createFakeRedis(), false);
    expect((await put(app, auth, { count: 1, containerId: 'x' })).status).toBe(400);
    expect((await put(app, auth, { count: 0, containerId: 'x' })).status).toBe(200);
    expect((await put(app, auth, { count: 1, mode: 'manual', containerId: 'x', products: ['B084DN3XVN'] })).status).toBe(200);
  });

  it('answers 503 without Redis', async () => {
    const { app, auth } = await setup(undefined);
    expect((await request(app).get('/amw/admin/api/stuffing').set('Authorization', auth)).body.editable).toBe(false);
    expect((await put(app, auth, { count: 1, containerId: 'x' })).status).toBe(503);
  });
});

describe('StuffingSettings', () => {
  const defaults = { count: 0, mode: 'recommendation' as const, containerId: 'main-content', products: [] as string[] };

  it('picks up the change of another process after the refresh delay', async () => {
    const redis = createFakeRedis();
    let now = 0;
    const reader = new StuffingSettings(defaults, redis as never, () => now);
    await reader.refresh();
    await new StuffingSettings(defaults, redis as never).save({ count: 3, containerId: 'article' });

    await reader.refresh();
    expect(reader.current().count).toBe(0);

    now = 60_000;
    await reader.refresh();
    expect(reader.current()).toEqual({ count: 3, mode: 'recommendation', containerId: 'article', products: [] });
  });

  it('ignores a stored value that is not valid, as it would reach widget.js', async () => {
    const redis = createFakeRedis();
    await redis.set('amw:settings:stuffing', JSON.stringify({ count: 1, containerId: '";alert(1);//' }));
    const settings = new StuffingSettings(defaults, redis as never);

    await settings.refresh();

    expect(settings.current()).toEqual(defaults);
  });

  it('keeps the last values when Redis fails', async () => {
    const redis = createFakeRedis();
    jest.spyOn(redis, 'get').mockRejectedValue(new Error('down'));
    const settings = new StuffingSettings(defaults, redis as never);

    await expect(settings.refresh()).resolves.toBeUndefined();
    expect(settings.current()).toEqual(defaults);
  });
});

describe('AdminApi appearance effect', () => {
  async function setup(redis?: ReturnType<typeof createFakeRedis>) {
    const effect = new EffectSettings({ mode: 'none', effects: ['none', 'fade', 'slide', 'zoom', 'pulse'] }, redis as never);
    const stats = new Stats(redis);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: 's', effect }).router());
    return { app, auth: `Bearer ${await login(app)}`, effect, stats };
  }

  it('requires a token', async () => {
    const { app } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/effect')).status).toBe(401);
    expect((await request(app).put('/amw/admin/api/effect').send({ mode: 'fade' })).status).toBe(401);
    expect((await request(app).get('/amw/admin/api/stats/effects')).status).toBe(401);
  });

  it('reads and saves the mode', async () => {
    const { app, auth, effect } = await setup(createFakeRedis());
    const all = ['none', 'fade', 'slide', 'zoom', 'pulse'];
    expect((await request(app).get('/amw/admin/api/effect').set('Authorization', auth)).body).toEqual({ mode: 'none', effects: all, editable: true });

    // Without a list, as older portals send it: all the effects
    const res = await request(app).put('/amw/admin/api/effect').set('Authorization', auth).send({ mode: 'compare' });
    expect(res.body).toEqual({ mode: 'compare', effects: all, editable: true });

    const chosen = await request(app).put('/amw/admin/api/effect').set('Authorization', auth).send({ mode: 'compare', effects: ['none', 'zoom'] });
    expect(chosen.status).toBe(200);
    expect(effect.current()).toEqual({ mode: 'compare', effects: ['none', 'zoom'] });
  });

  it.each([
    [{ mode: 'nope' }], [{ mode: 'fade";alert(1);//' }], [{ mode: 'fade', other: 1 }], [{}],
    [{ mode: 'compare', effects: ['zoom'] }], [{ mode: 'compare', effects: ['zoom', 'zoom'] }], [{ mode: 'compare', effects: ['zoom', 'nope'] }],
  ])('rejects %j', async body => {
    const { app, auth, effect } = await setup(createFakeRedis());
    expect((await request(app).put('/amw/admin/api/effect').set('Authorization', auth).send(body)).status).toBe(400);
    expect(effect.current().mode).toBe('none');
  });

  it('answers 503 without Redis', async () => {
    const { app, auth } = await setup();
    expect((await request(app).put('/amw/admin/api/effect').set('Authorization', auth).send({ mode: 'fade' })).status).toBe(503);
    expect((await request(app).get('/amw/admin/api/stats/effects').set('Authorization', auth)).status).toBe(503);
  });

  it('returns the views and clicks of the period', async () => {
    const redis = createFakeRedis();
    const { app, auth, stats } = await setup(redis);
    stats.recordViews(['B000000001'], undefined, 'pulse');
    await new Promise(resolve => setImmediate(resolve));

    const res = await request(app).get('/amw/admin/api/stats/effects?days=7').set('Authorization', auth);

    expect(res.body).toEqual([{ effect: 'pulse', views: 1, clicks: 0, ctr: 0 }]);
  });
});

describe('AdminApi theme test', () => {
  async function setup(redis?: ReturnType<typeof createFakeRedis>) {
    const themeTest = new ThemeTestSettings(redis as never);
    const stats = new Stats(redis);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: 's', themeTest, defaultTheme: 'shelf' }).router());
    return { app, auth: `Bearer ${await login(app)}`, themeTest, stats };
  }
  const put = (app: express.Express, auth: string, body: unknown) =>
    request(app).put('/amw/admin/api/theme-test').set('Authorization', auth).send(body as object);

  it('requires a token', async () => {
    const { app } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/theme-test')).status).toBe(401);
    expect((await request(app).put('/amw/admin/api/theme-test').send({ mode: 'off', themes: [] })).status).toBe(401);
    expect((await request(app).get('/amw/admin/api/stats/themes')).status).toBe(401);
  });

  it('is off by default, then saves the themes compared', async () => {
    const { app, auth, themeTest } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/theme-test').set('Authorization', auth)).body)
      .toEqual({ mode: 'off', themes: [], defaultTheme: 'shelf', editable: true });

    const res = await put(app, auth, { mode: 'compare', themes: ['shelf', 'neon'] });
    expect(res.body).toEqual({ mode: 'compare', themes: ['shelf', 'neon'], defaultTheme: 'shelf', editable: true });
    expect(themeTest.current()).toEqual({ mode: 'compare', themes: ['shelf', 'neon'] });
  });

  it.each([
    [{ mode: 'compare', themes: ['shelf'] }], [{ mode: 'compare', themes: ['shelf', 'shelf'] }],
    [{ mode: 'compare', themes: ['shelf', '"];alert(1);//'] }], [{ mode: 'on', themes: [] }], [{ mode: 'off' }],
  ])('rejects %j', async body => {
    const { app, auth, themeTest } = await setup(createFakeRedis());
    expect((await put(app, auth, body)).status).toBe(400);
    expect(themeTest.current().mode).toBe('off');
  });

  it('answers 503 without Redis', async () => {
    const { app, auth } = await setup();
    expect((await put(app, auth, { mode: 'off', themes: [] })).status).toBe(503);
  });

  it('returns the views and clicks of the period', async () => {
    const { app, auth, stats } = await setup(createFakeRedis());
    stats.recordViews(['B000000001'], undefined, undefined, 'neon');
    await new Promise(resolve => setImmediate(resolve));

    const res = await request(app).get('/amw/admin/api/stats/themes?days=7').set('Authorization', auth);
    expect(res.body).toEqual([{ theme: 'neon', views: 1, clicks: 0, ctr: 0 }]);
  });
});
