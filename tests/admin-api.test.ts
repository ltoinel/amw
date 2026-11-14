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
import { AbHistorySettings, ButtonLabelSettings, EffectSettings, PartnerTagSettings, StuffingSettings, ThemeTestSettings } from '../src/server/StuffingSettings';
import { SiteSettings } from '../src/server/SiteSettings';

const siteDefaults = (allowedSites: string[]) => ({ server: { allowedSites }, recommendation: { allowedHosts: allowedSites } });
import { Tunables } from '../src/server/Tunables';

const PASSWORD = 'correct horse battery';
// As long as AdminApi.MIN_SECRET_LENGTH asks for
const SECRET = 'test-secret-0123456789abcdef0123456789';

function buildApp(stats: Stats, loginRateLimit?: number, insights?: Insights): { app: express.Application; admin: AdminApi } {
  const admin = new AdminApi(stats, { password: PASSWORD, secret: SECRET, loginRateLimit, insights });
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
    delete mockConfig['Admin.tokenTtl'];
    delete mockConfig['Admin.loginRateLimit'];
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

  test('refuses a short secret, and takes one of the minimum length or none', () => {
    mockConfig['Admin.enabled'] = true;
    const start = (secret?: string) => AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_ADMIN_SECRET: secret });
    expect(() => start('s')).toThrow('AMW_ADMIN_SECRET must be at least 32 characters long');
    expect(() => start('a'.repeat(AdminApi.MIN_SECRET_LENGTH - 1))).toThrow('at least 32 characters');
    // What `openssl rand -hex 16` gives
    expect(start('0123456789abcdef0123456789abcdef')).toBeInstanceOf(AdminApi);
    expect(start()).toBeInstanceOf(AdminApi);
    expect(start('')).toBeInstanceOf(AdminApi);
  });

  test('reads the password and the options when enabled', () => {
    mockConfig['Admin.enabled'] = true;
    mockConfig['Admin.tokenTtl'] = 60;
    mockConfig['Admin.loginRateLimit'] = 3;
    const admin = AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_ADMIN_SECRET: SECRET });
    expect(admin).toBeInstanceOf(AdminApi);
    const { expiresAt } = admin!.createToken(0);
    expect(expiresAt).toBe(new Date(60 * 1000).toISOString());
  });

  test('keeps sessions for 10 days by default', () => {
    mockConfig['Admin.enabled'] = true;
    const admin = AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_ADMIN_SECRET: SECRET });
    const { token, expiresAt } = admin!.createToken(0);
    expect(expiresAt).toBe(new Date(10 * 24 * 3600 * 1000).toISOString());
    expect(admin!.verifyToken(token, 9 * 24 * 3600 * 1000)).toBe(true);
    expect(admin!.verifyToken(token, 10 * 24 * 3600 * 1000 + 1)).toBe(false);
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
    expect(admin.verifyToken(token, 1000 + 9 * 24 * 3600 * 1000)).toBe(true);
    expect(admin.verifyToken(token, 1000 + 10 * 24 * 3600 * 1000)).toBe(false);
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
    const other = new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET.replace('test', 'other') });
    expect(admin.verifyToken(other.createToken().token)).toBe(false);
  });

  test('keeps a token across a restart with the same secret and password', () => {
    const restarted = new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET });
    expect(restarted.verifyToken(admin.createToken().token)).toBe(true);
  });

  test('rejects a token issued before the password changed, with the same secret', () => {
    const changed = new AdminApi(new Stats(), { password: 'another horse battery', secret: SECRET });
    expect(changed.verifyToken(admin.createToken().token)).toBe(false);
    expect(admin.verifyToken(changed.createToken().token)).toBe(false);
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

    // A range of dates, ending today, in place of a number of days
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const range = await request(app).get(`/amw/admin/api/stats/daily?from=${yesterday}&to=${today}`).set(auth);
    expect(range.body.map((day: { date: string }) => day.date)).toEqual([yesterday, today]);
    // Invalid or reversed dates fall back to the number of days; dates after today are cut
    expect((await request(app).get(`/amw/admin/api/stats/daily?from=2026-02-30&to=${today}&days=2`).set(auth)).body).toHaveLength(2);
    expect((await request(app).get(`/amw/admin/api/stats/daily?from=${today}&to=${yesterday}&days=3`).set(auth)).body).toHaveLength(3);
    expect((await request(app).get(`/amw/admin/api/stats/daily?from=${today}&to=2999-01-01`).set(auth)).body).toHaveLength(1);
    expect((await request(app).get(`/amw/admin/api/stats/daily?from=2000-01-01&to=${today}`).set(auth)).body).toHaveLength(90);

    const products = await request(app).get('/amw/admin/api/stats/products?days=abc&limit=5').set(auth);
    expect(products.status).toBe(200);
    expect(products.body[0]).toMatchObject({ value: 'B084DN3XVN', impressions: 1, clicks: 1, ctr: 1 });

    const sortedProducts = await request(app).get('/amw/admin/api/stats/products?sort=ctr').set(auth);
    expect(sortedProducts.status).toBe(200);
    expect(sortedProducts.body[0]).toMatchObject({ value: 'B084DN3XVN' });

    const invalidProductSort = await request(app).get('/amw/admin/api/stats/products?sort=title').set(auth);
    expect(invalidProductSort.status).toBe(400);
    expect(invalidProductSort.body.message).toBe('sort must be one of: clicks, impressions, ctr');

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

    // Figures of a site: none here, as the Stats of this test lists no site
    for (const path of ['daily?days=1', 'products', 'products/count', 'pages', 'notfound']) {
      const res = await request(app).get(`/amw/admin/api/stats/${path}${path.includes('?') ? '&' : '?'}site=other.example:8080`).set(auth);
      expect(res.status).toBe(200);
    }
    expect((await request(app).get('/amw/admin/api/stats/notfound?site=other.example').set(auth)).body).toEqual([]);
    expect((await request(app).get('/amw/admin/api/stats/notfound?site=').set(auth)).body).toHaveLength(1);
    for (const site of ['https://x', 'A.example', 'a.example/x']) {
      const res = await request(app).get(`/amw/admin/api/stats/daily?site=${encodeURIComponent(site)}`).set(auth);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/site must be a host/);
    }
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
    const admin = new AdminApi(stats, { password: PASSWORD, secret: SECRET, marketplace });
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
    expect(insights.report).toHaveBeenCalledWith(7, undefined);
  });

  test('serves the last report on GET without generating one', async () => {
    const stored = fakeInsights(Promise.resolve(report), { ...report, cached: true });
    const res = await call(new Stats(createFakeRedis()), stored, '?days=7', 'get');
    expect(res.body).toEqual({ ...report, cached: true });
    expect(stored.latest).toHaveBeenCalledWith(7, undefined);
    // The report of the active site
    await call(new Stats(createFakeRedis()), stored, '?days=7&site=blog.example', 'get');
    expect(stored.latest).toHaveBeenLastCalledWith(7, 'blog.example');

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

  test('serves a sample card to preview, framed by the portal only', async () => {
    const res = await request(app).get('/amw/admin/preview?theme=neon&effect=zoom&label=buy&lang=fr');
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(res.text).toContain('<html lang="fr">');
    expect(res.text).toContain('src="../widget.js"');
    const preview = JSON.parse(res.text.match(/data-preview='([^']*)'/)![1].replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
    expect(preview).toMatchObject({ theme: 'neon', effect: 'zoom', label: 'buy', product: { image: 'preview.svg' } });

    const image = await request(app).get('/amw/admin/preview.svg');
    expect(image.headers['content-type']).toContain('image/svg+xml');
  });

  test('previews only known names', async () => {
    const res = await request(app).get('/amw/admin/preview?theme=%27%3E%3Cscript%3E&effect=evil&label=x&lang=%22%3E');
    const preview = JSON.parse(res.text.match(/data-preview='([^']*)'/)![1].replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
    expect(preview).toEqual(expect.objectContaining({ theme: 'default' }));
    expect(preview.effect).toBeUndefined();
    expect(preview.label).toBeUndefined();
    expect(res.text).toContain('<html lang="en">');
    expect(res.text).not.toContain('<script>');
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
      secret: SECRET,
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
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET, settings: sections }).router());
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
        AMW_ADMIN_SECRET: 'sentinel-admin-secret-0123456789abcdef',
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

describe('AdminApi product previews', () => {
  async function setup(products?: ConstructorParameters<typeof AdminApi>[1]['products']) {
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET, products }).router());
    return { app, auth: `Bearer ${await login(app)}` };
  }
  const get = (app: express.Express, auth: string, query: string) =>
    request(app).get(`/amw/admin/api/products${query}`).set('Authorization', auth);

  it('requires a token', async () => {
    const { app } = await setup(jest.fn());
    expect((await request(app).get('/amw/admin/api/products?ids=B084DN3XVN')).status).toBe(401);
  });

  it('gives the title, image, link, price and discount of each product, without repeats', async () => {
    const lookup = jest.fn(async (ids: string[]) => ids.map(id => (id === 'B084DN3XVN'
      ? { id, status: 200, product: { title: 'Echo', image: 'https://m.media-amazon.com/e.jpg', url: 'https://www.amazon.fr/dp/B084DN3XVN', price: '9 €', savings: 15, timestamp: 1767268800000, brand: 'Amazon' } }
      : { id, status: 404 })));
    const { app, auth } = await setup(lookup);
    const res = await get(app, auth, '?ids=B084DN3XVN,B00GONE001,B084DN3XVN');
    expect(res.status).toBe(200);
    expect(lookup).toHaveBeenCalledWith(['B084DN3XVN', 'B00GONE001']);
    expect(res.body).toEqual({ results: [
      { id: 'B084DN3XVN', status: 200, product: { title: 'Echo', image: 'https://m.media-amazon.com/e.jpg', url: 'https://www.amazon.fr/dp/B084DN3XVN', price: '9 €', savings: 15, timestamp: 1767268800000 } },
      { id: 'B00GONE001', status: 404 },
    ] });
  });

  it('gives no price to a product without an offer, nor a discount of 0', async () => {
    const lookup = jest.fn(async (ids: string[]) => ids.map(id => (id === 'B084DN3XVN'
      ? { id, status: 200, product: { title: 'Echo', url: 'https://www.amazon.fr/dp/B084DN3XVN', price: -1, savings: 0, timestamp: 1767268800000 } }
      : { id, status: 200, product: { title: 'Dot', url: 'https://www.amazon.fr/dp/B0DOT00001', price: '5 €', savings: 0, timestamp: 1767268800000 } })));
    const { app, auth } = await setup(lookup);
    const res = await get(app, auth, '?ids=B084DN3XVN,B0DOT00001');
    expect(res.body.results.map((result: { product: unknown }) => result.product)).toEqual([
      { title: 'Echo', url: 'https://www.amazon.fr/dp/B084DN3XVN' },
      { title: 'Dot', url: 'https://www.amazon.fr/dp/B0DOT00001', price: '5 €', timestamp: 1767268800000 },
    ]);
  });

  it.each(['', '?ids=', '?ids=b084dn3xvn', '?ids=B084DN3XVN;x', `?ids=${Array.from({ length: 21 }, (_, i) => `B0000000${String(i).padStart(2, '0')}`).join(',')}`])('rejects %s', async query => {
    const lookup = jest.fn();
    const { app, auth } = await setup(lookup);
    expect((await get(app, auth, query)).status).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('answers 503 without a lookup, or when it fails', async () => {
    const without = await setup();
    expect((await get(without.app, without.auth, '?ids=B084DN3XVN')).status).toBe(503);
    const failing = await setup(jest.fn().mockRejectedValue(new Error('down')));
    expect((await get(failing.app, failing.auth, '?ids=B084DN3XVN')).status).toBe(503);
  });
});

describe('AdminApi stuffing', () => {
  const defaults = { count: 0, mode: 'recommendation' as const, containerId: 'main-content', products: [] as string[], wordsPerCard: 0, sites: {} as Record<string, number> };

  async function setup(redis: Parameters<typeof StuffingSettings.prototype.save>[0] | undefined, recommendationEnabled = true) {
    const stuffing = new StuffingSettings(defaults, redis as never);
    const admin = new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET, stuffing, recommendationEnabled });
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

  it('says when the custom products cannot be saved', async () => {
    const redis = createFakeRedis();
    const { app, auth } = await setup(redis);
    redis.set = jest.fn().mockRejectedValue(new Error('store down')) as never;
    const res = await request(app).put('/amw/admin/api/stuffing/products').set('Authorization', auth).send({ products: ['B000000001'] });
    expect(res.status).toBe(503);
  });

  it('needs a store to change the custom products alone', async () => {
    const { app, auth } = await setup(undefined);
    const res = await request(app).put('/amw/admin/api/stuffing/products').set('Authorization', auth).send({ products: [] });
    expect(res.status).toBe(503);
  });

  it('reads and saves the values, which then apply', async () => {
    const { app, auth, stuffing } = await setup(createFakeRedis());

    expect((await request(app).get('/amw/admin/api/stuffing').set('Authorization', auth)).body)
      .toEqual({ ...defaults, editable: true, recommendationEnabled: true, allowedSites: [] });

    const res = await put(app, auth, { count: 2, containerId: 'article' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 2, containerId: 'article' });
    expect(stuffing.current()).toEqual({ enabled: true, count: 2, mode: 'recommendation', containerId: 'article', products: [], wordsPerCard: 0, sites: {}, deals: { keywords: '', searchIndex: 'All', minSavingPercent: 20 }, weights: { recommendation: 0, popular: 0, manual: 0, deals: 0 }, dealSearches: [], banners: [] });

    const listed = await put(app, auth, { count: 2, containerId: 'article', products: ['B084DN3XVN', 'B000000001'] });
    expect(listed.status).toBe(200);
    expect(stuffing.current().products).toEqual(['B084DN3XVN', 'B000000001']);

    const perSite = await put(app, auth, { count: 2, containerId: 'article', wordsPerCard: 300, sites: { 'www.geeek.org': 3, 'apollovan.fr': 0 } });
    expect(perSite.status).toBe(200);
    expect(stuffing.current()).toMatchObject({ wordsPerCard: 300, sites: { 'www.geeek.org': 3, 'apollovan.fr': 0 } });

    // Switched off, recommended cards need no recommendations
    const off = await put(app, auth, { enabled: false, count: 2, containerId: 'article' });
    expect(off.status).toBe(200);
    expect(stuffing.current().enabled).toBe(false);

    // The keys reach widget.js: an inherited name is dropped rather than stored
    expect((await put(app, auth, { count: 2, containerId: 'article', sites: JSON.parse('{"__proto__": 1}') })).status).toBe(200);
    expect(Object.keys(stuffing.current().sites)).toEqual([]);
  });

  it('keeps the custom products, their banners and the deals searches a save leaves out', async () => {
    const { app, auth, stuffing } = await setup(createFakeRedis());
    const banner = { id: 'newsletter', title: 'Join the newsletter', image: 'https://img.example/n.png', url: 'https://example.com/newsletter' };
    const search = { keywords: 'lego', searchIndex: 'ToysAndGames', minSavingPercent: 20, maxProducts: 5 };
    const products = ['B084DN3XVN', 'banner:newsletter'];
    expect((await request(app).put('/amw/admin/api/stuffing/products').set('Authorization', auth).send({ products, banners: [banner] })).status).toBe(200);
    expect((await request(app).put('/amw/admin/api/stuffing/deals').set('Authorization', auth).send({ searches: [search] })).status).toBe(200);

    // What the Stuffing view sends: its own fields, none of the lists of the other views
    const form = {
      enabled: true, count: 3, mode: 'manual', containerId: 'article', wordsPerCard: 300,
      weights: { recommendation: 0, popular: 0, manual: 100, deals: 0 }, deals: { keywords: '', searchIndex: 'All', minSavingPercent: 20 }, sites: {}
    };
    const res = await put(app, auth, form);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 3, containerId: 'article', products, banners: [banner], dealSearches: [search] });
    expect(stuffing.current()).toMatchObject({ count: 3, products, banners: [banner], dealSearches: [search] });

    // A list that is sent still replaces the stored one, and must name banners of the site
    expect((await put(app, auth, { ...form, products: ['B000000001'] })).body).toMatchObject({ products: ['B000000001'], banners: [banner] });
    expect((await put(app, auth, { ...form, products: [], banners: [], dealSearches: [] })).body).toMatchObject({ products: [], banners: [], dealSearches: [] });
    expect((await put(app, auth, { ...form, products: ['banner:newsletter'] })).status).toBe(400);
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
    [{ count: 1, containerId: 'x', wordsPerCard: -1 }],
    [{ count: 1, containerId: 'x', wordsPerCard: 10001 }],
    [{ count: 1, containerId: 'x', sites: { 'https://www.geeek.org': 1 } }],
    [{ count: 1, containerId: 'x', sites: { 'www.geeek.org': 6 } }],
    [{ count: 1, containerId: 'x', sites: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`s${i}.example`, 1])) }],
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
    // A site with its own cards needs recommendations as much
    expect((await put(app, auth, { count: 0, containerId: 'x', sites: { 'www.geeek.org': 2 } })).status).toBe(400);
  });

  it('answers 503 without Redis', async () => {
    const { app, auth } = await setup(undefined);
    expect((await request(app).get('/amw/admin/api/stuffing').set('Authorization', auth)).body.editable).toBe(false);
    expect((await put(app, auth, { count: 1, containerId: 'x' })).status).toBe(503);
  });
});

describe('StuffingSettings', () => {
  const defaults = { count: 0, mode: 'recommendation' as const, containerId: 'main-content', products: [] as string[], wordsPerCard: 0, sites: {} as Record<string, number> };

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
    expect(reader.current()).toEqual({ enabled: true, count: 3, mode: 'recommendation', containerId: 'article', products: [], wordsPerCard: 0, sites: {}, deals: { keywords: '', searchIndex: 'All', minSavingPercent: 20 }, weights: { recommendation: 0, popular: 0, manual: 0, deals: 0 }, dealSearches: [], banners: [] });
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
    const effect = new EffectSettings({ mode: 'none', effects: ['none', 'fade', 'slide', 'zoom', 'pulse', 'shine'] }, redis as never);
    const stats = new Stats(redis);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: SECRET, effect }).router());
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
    const all = ['none', 'fade', 'slide', 'zoom', 'pulse', 'shine'];
    expect((await request(app).get('/amw/admin/api/effect').set('Authorization', auth)).body).toEqual({ mode: 'none', effects: all, editable: true });

    // Without a list, as older portals send it: all the effects
    const res = await request(app).put('/amw/admin/api/effect').set('Authorization', auth).send({ mode: 'compare' });
    expect(res.body).toEqual({ mode: 'compare', effects: all, startedAt: expect.any(String), editable: true });

    const chosen = await request(app).put('/amw/admin/api/effect').set('Authorization', auth).send({ mode: 'compare', effects: ['none', 'zoom'] });
    expect(chosen.status).toBe(200);
    expect(effect.current()).toEqual({ mode: 'compare', effects: ['none', 'zoom'], startedAt: expect.any(String) });
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

    expect(res.body).toEqual([{ effect: 'pulse', views: 1, clicks: 0, ctr: 0, daily: expect.any(Array) }]);
    expect(res.body[0].daily).toHaveLength(7);
  });
});

describe('AdminApi button label and the rule of one test at a time', () => {
  async function setup(redis?: ReturnType<typeof createFakeRedis>) {
    const buttonLabel = new ButtonLabelSettings(redis as never);
    const themeTest = new ThemeTestSettings(redis as never);
    const effect = new EffectSettings({ mode: 'none', effects: ['none', 'fade', 'slide', 'zoom', 'pulse', 'shine'] }, redis as never);
    const stats = new Stats(redis);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: SECRET, buttonLabel, themeTest, effect, defaultTheme: 'default' }).router());
    return { app, auth: `Bearer ${await login(app)}`, buttonLabel, stats };
  }
  const put = (app: express.Express, auth: string, path: string, body: unknown) =>
    request(app).put(`/amw/admin/api/${path}`).set('Authorization', auth).send(body as object);

  it('says "See the offer" by default, then saves a label and a comparison of labels', async () => {
    const { app, auth, buttonLabel } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/button-label').set('Authorization', auth)).body)
      .toEqual({ label: 'offer', mode: 'off', labels: [], editable: true });

    expect((await put(app, auth, 'button-label', { label: 'buy', mode: 'off', labels: [] })).body).toMatchObject({ label: 'buy' });
    const compared = await put(app, auth, 'button-label', { label: 'offer', mode: 'compare', labels: ['offer', 'view'] });
    expect(compared.status).toBe(200);
    expect(buttonLabel.current()).toEqual({ label: 'offer', mode: 'compare', labels: ['offer', 'view'], startedAt: expect.any(String) });
  });

  it.each([
    [{ label: 'click here', mode: 'off', labels: [] }], [{ label: 'offer', mode: 'compare', labels: ['offer'] }],
    [{ label: 'offer', mode: 'compare', labels: ['offer', 'offer'] }], [{ label: 'offer', mode: 'compare', labels: ['offer', '"];x//'] }],
  ])('rejects %j', async body => {
    const { app, auth } = await setup(createFakeRedis());
    expect((await put(app, auth, 'button-label', body)).status).toBe(400);
  });

  it('locks the other settings while a test runs, and lets the running one change or stop', async () => {
    const { app, auth } = await setup(createFakeRedis());
    expect((await put(app, auth, 'theme-test', { mode: 'compare', themes: ['shelf', 'neon'] })).status).toBe(200);

    const label = await put(app, auth, 'button-label', { label: 'offer', mode: 'compare', labels: ['offer', 'buy'] });
    expect(label.status).toBe(409);
    expect(label.body.message).toContain('A theme test is running');
    expect((await put(app, auth, 'effect', { mode: 'compare', effects: ['none', 'fade'] })).status).toBe(409);
    // Nor can the label or the effect change: the test would measure them too
    const changed = await put(app, auth, 'button-label', { label: 'buy', mode: 'off', labels: [] });
    expect(changed.status).toBe(409);
    expect(changed.body.message).toContain('stop it before changing the label');
    expect((await put(app, auth, 'effect', { mode: 'fade', effects: ['none', 'fade'] })).status).toBe(409);

    expect((await put(app, auth, 'theme-test', { mode: 'compare', themes: ['shelf', 'pastel'] })).status).toBe(200);
    expect((await put(app, auth, 'theme-test', { mode: 'off', themes: [] })).status).toBe(200);
    expect((await put(app, auth, 'button-label', { label: 'offer', mode: 'compare', labels: ['offer', 'buy'] })).status).toBe(200);
  });

  it('answers 503 without a store, and returns the views and clicks per label', async () => {
    expect((await put((await setup()).app, (await setup()).auth, 'button-label', { label: 'buy', mode: 'off', labels: [] })).status).toBe(503);
    const { app, auth, stats } = await setup(createFakeRedis());
    stats.recordViews(['B000000001'], undefined, undefined, undefined, 'view');
    stats.recordClick('B000000001', undefined, undefined, undefined, 'view');
    await new Promise(resolve => setImmediate(resolve));
    expect((await request(app).get('/amw/admin/api/stats/labels?days=7').set('Authorization', auth)).body)
      .toEqual([{ label: 'view', views: 1, clicks: 1, ctr: 1, daily: expect.any(Array) }]);
  });
});

describe('AdminApi settings of one site', () => {
  async function setup() {
    const redis = createFakeRedis();
    const stuffing = new StuffingSettings({ enabled: false, count: 0, mode: 'manual', containerId: 'main-content', products: [], wordsPerCard: 0, sites: {} }, redis as never);
    const themeTest = new ThemeTestSettings(redis as never);
    const effect = new EffectSettings({ mode: 'none', effects: ['none', 'fade', 'slide', 'zoom', 'pulse', 'shine'] }, redis as never);
    const buttonLabel = new ButtonLabelSettings(redis as never);
    const stats = new Stats(redis, () => new Date(), ['blog.example', 'shop.example']);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: SECRET, stuffing, themeTest, effect, buttonLabel, defaultTheme: 'default' }).router());
    return { app, auth: `Bearer ${await login(app)}`, stuffing, stats };
  }
  const get = (app: express.Express, auth: string, path: string) => request(app).get(`/amw/admin/api/${path}`).set('Authorization', auth);
  const put = (app: express.Express, auth: string, path: string, body: unknown) =>
    request(app).put(`/amw/admin/api/${path}`).set('Authorization', auth).send(body as object);

  it('follows the setting of every site until the site saves its own', async () => {
    const { app, auth, stuffing } = await setup();
    expect((await get(app, auth, 'stuffing?site=shop.example')).body).toMatchObject({ enabled: false, own: false });

    const own = { enabled: true, count: 2, mode: 'manual', containerId: 'post', products: ['B000000001'], wordsPerCard: 0, sites: {} };
    expect((await put(app, auth, 'stuffing?site=shop.example', own)).body).toMatchObject({ count: 2, own: true });
    expect((await get(app, auth, 'stuffing?site=shop.example')).body).toMatchObject({ enabled: true, count: 2, own: true });
    // Every site, and the other sites, keep theirs
    expect(stuffing.current()).toMatchObject({ enabled: false, count: 0 });
    expect((await get(app, auth, 'stuffing?site=blog.example')).body).toMatchObject({ enabled: false, own: false });
    expect((await get(app, auth, 'stuffing')).body.own).toBeUndefined();
  });

  it('keeps the lists of a site when its Stuffing view saves, and copies those of every site at its first save', async () => {
    const { app, auth, stuffing } = await setup();
    const banner = { id: 'promo', title: 'Promo', image: 'https://img.example/p.png', url: 'https://example.com/promo' };
    const form = { enabled: true, count: 2, mode: 'manual', containerId: 'post', wordsPerCard: 0, sites: {} };
    await put(app, auth, 'stuffing/products', { products: ['B000000001', 'banner:promo'], banners: [banner] });

    // shop.example follows every site: its first save keeps a copy of the lists it showed
    const first = await put(app, auth, 'stuffing?site=shop.example', form);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ count: 2, products: ['B000000001', 'banner:promo'], banners: [banner], own: true });

    // Then its own lists, whatever every site has
    await put(app, auth, 'stuffing/products?site=shop.example', { products: ['B000000002'] });
    await put(app, auth, 'stuffing/products', { products: [], banners: [] });
    expect((await put(app, auth, 'stuffing?site=shop.example', { ...form, count: 3 })).body).toMatchObject({ count: 3, products: ['B000000002'], banners: [banner] });
    expect(stuffing.current()).toMatchObject({ count: 0, products: [], banners: [] });
  });

  it('changes the custom products of a site alone, keeping its other settings', async () => {
    const { app, auth, stuffing } = await setup();
    const own = { enabled: true, count: 2, mode: 'manual', containerId: 'post', products: ['B000000001'], wordsPerCard: 0, sites: {} };
    await put(app, auth, 'stuffing?site=shop.example', own);

    const res = await put(app, auth, 'stuffing/products?site=shop.example', { products: ['B000000002', 'B000000001'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 2, mode: 'manual', containerId: 'post', products: ['B000000002', 'B000000001'], own: true });
    expect(stuffing.current().products).toEqual([]);

    // A site following every site gets its own settings, the list being its only change
    const blog = await put(app, auth, 'stuffing/products?site=blog.example', { products: ['B000000003'] });
    expect(blog.body).toMatchObject({ enabled: false, count: 0, products: ['B000000003'], own: true });

    for (const products of [['nope'], ['B000000001', 'B000000001'], 'B000000001', Array.from({ length: 21 }, (_, i) => `B0000000${String(i).padStart(2, '0')}`)]) {
      expect((await put(app, auth, 'stuffing/products?site=shop.example', { products })).status).toBe(400);
    }
    expect((await put(app, auth, 'stuffing/products?site=evil%20host', { products: [] })).status).toBe(400);
  });

  it('refuses a site that is not a host', async () => {
    const { app, auth } = await setup();
    for (const path of ['stuffing', 'effect', 'theme-test', 'button-label']) {
      expect((await get(app, auth, `${path}?site=evil%20host`)).status).toBe(400);
    }
  });

  it('runs one A/B test at a time per site, and keeps a theme for the site', async () => {
    const { app, auth } = await setup();
    expect((await put(app, auth, 'theme-test?site=shop.example', { mode: 'compare', themes: ['outdoor', 'denim'] })).status).toBe(200);
    // Another test on the same site is refused, on another site it is not
    expect((await put(app, auth, 'effect?site=shop.example', { mode: 'compare', effects: ['none', 'fade'] })).status).toBe(409);
    expect((await put(app, auth, 'effect?site=blog.example', { mode: 'compare', effects: ['none', 'fade'] })).status).toBe(200);

    const theme = await put(app, auth, 'theme-test?site=shop.example', { mode: 'off', themes: [], theme: 'outdoor' });
    expect(theme.body).toMatchObject({ mode: 'off', theme: 'outdoor', own: true });
  });

  it('records when a test starts, keeps it while it runs, and forgets it after', async () => {
    const { app, auth } = await setup();
    const started = await put(app, auth, 'button-label?site=shop.example', { label: 'offer', mode: 'compare', labels: ['offer', 'buy'], startedAt: '2000-01-01T00:00:00Z' });
    const startedAt = started.body.startedAt;
    // Set by the server, never by the client
    expect(startedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(Date.now() - Date.parse(startedAt)).toBeLessThan(60_000);

    const changed = await put(app, auth, 'button-label?site=shop.example', { label: 'offer', mode: 'compare', labels: ['offer', 'view'] });
    expect(changed.body.startedAt).toBe(startedAt);
    expect((await get(app, auth, 'button-label?site=shop.example')).body.startedAt).toBe(startedAt);

    const stopped = await put(app, auth, 'button-label?site=shop.example', { label: 'buy', mode: 'off', labels: [] });
    expect(stopped.body.startedAt).toBeUndefined();
    expect((await put(app, auth, 'theme-test?site=shop.example', { mode: 'compare', themes: ['neon', 'denim'] })).body.startedAt).toEqual(expect.any(String));
  });

  it('measures the variants of one site apart', async () => {
    const { app, auth, stats } = await setup();
    stats.recordViews(['B000000001'], 'https://shop.example/a', undefined, 'outdoor');
    stats.recordViews(['B000000001', 'B000000001'], 'https://blog.example/a', undefined, 'outdoor');
    stats.recordClick('B000000001', 'https://shop.example/a', undefined, 'outdoor');
    await new Promise(resolve => setImmediate(resolve));

    expect((await get(app, auth, 'stats/themes?days=7&site=shop.example')).body).toEqual([{ theme: 'outdoor', views: 1, clicks: 1, ctr: 1, daily: expect.any(Array) }]);
    expect((await get(app, auth, 'stats/themes?days=7')).body).toEqual([{ theme: 'outdoor', views: 3, clicks: 1, ctr: 1 / 3, daily: expect.any(Array) }]);
  });
});

describe('AdminApi theme test', () => {
  async function setup(redis?: ReturnType<typeof createFakeRedis>) {
    const themeTest = new ThemeTestSettings(redis as never);
    const stats = new Stats(redis);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: SECRET, themeTest, defaultTheme: 'shelf' }).router());
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
    expect(res.body).toEqual({ mode: 'compare', themes: ['shelf', 'neon'], startedAt: expect.any(String), defaultTheme: 'shelf', editable: true });
    expect(themeTest.current()).toEqual({ mode: 'compare', themes: ['shelf', 'neon'], startedAt: expect.any(String) });
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
    expect(res.body).toEqual([{ theme: 'neon', views: 1, clicks: 0, ctr: 0, daily: expect.any(Array) }]);
  });
});

describe('AdminApi a/b test duration and history', () => {
  async function setup(redis = createFakeRedis()) {
    const themeTest = new ThemeTestSettings(redis as never);
    const buttonLabel = new ButtonLabelSettings(redis as never);
    const effect = new EffectSettings({ mode: 'none', effects: ['none', 'fade', 'slide', 'zoom', 'pulse', 'shine'] }, redis as never);
    const abHistory = new AbHistorySettings(redis as never);
    const stats = new Stats(redis);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: SECRET, themeTest, buttonLabel, effect, abHistory, defaultTheme: 'shelf' }).router());
    return { app, auth: `Bearer ${await login(app)}`, redis, themeTest, buttonLabel, abHistory, stats };
  }
  const call = (app: express.Express, auth: string, method: 'get' | 'put', path: string, body?: object) =>
    method === 'get' ? request(app).get(`/amw/admin/api/${path}`).set('Authorization', auth) : request(app).put(`/amw/admin/api/${path}`).set('Authorization', auth).send(body);

  // Tests in the past are dated from today: their statistics are only read within the retention
  const daysAgo = (days: number, hour = 0) => new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - days * 86_400_000 + hour * 3_600_000);

  it('plans the end of a test from its duration, and keeps it while the test runs', async () => {
    const { app, auth } = await setup();
    const started = (await call(app, auth, 'put', 'theme-test', { mode: 'compare', themes: ['shelf', 'neon'], days: 14 })).body;
    expect(Date.parse(started.endsAt) - Date.parse(started.startedAt)).toBe(14 * 86_400_000);
    // Changing the variants keeps the start and the end; the client cannot set them
    const changed = (await call(app, auth, 'put', 'theme-test', { mode: 'compare', themes: ['shelf', 'neon', 'denim'], days: 2, endsAt: '2030-01-01T00:00:00.000Z' })).body;
    expect([changed.startedAt, changed.endsAt]).toEqual([started.startedAt, started.endsAt]);
  });

  it.each([0, 91, 1.5, '7'])('rejects a duration of %j', async days => {
    const { app, auth, themeTest } = await setup();
    expect((await call(app, auth, 'put', 'theme-test', { mode: 'compare', themes: ['shelf', 'neon'], days })).status).toBe(400);
    expect(themeTest.current().mode).toBe('off');
  });

  it('ends a test past its planned end, and records it once', async () => {
    const { app, auth, redis } = await setup();
    const [startedAt, endsAt] = [daysAgo(43).toISOString(), daysAgo(29).toISOString()];
    await redis.set('amw:settings:button-label', JSON.stringify({ label: 'offer', mode: 'compare', labels: ['offer', 'buy'], startedAt, endsAt }));

    // Back to the control group, stored as such
    expect((await call(app, auth, 'get', 'button-label')).body).toMatchObject({ label: 'offer', mode: 'off', labels: [] });
    expect(JSON.parse(await redis.get('amw:settings:button-label') as string)).toEqual({ label: 'offer', mode: 'off', labels: [] });
    const { body } = await call(app, auth, 'get', 'ab-history');
    expect(body).toEqual({
      tests: [{
        kind: 'label', variants: ['offer', 'buy'], control: 'offer', startedAt,
        endedAt: endsAt, endsAt, reason: 'expired', kept: 'offer', results: []
      }],
      editable: true
    });
  });

  it('counts the days of the test only when it is recorded days after its end', async () => {
    const { app, auth, redis } = await setup();
    const [startedAt, endsAt] = [daysAgo(20, 9).toISOString(), daysAgo(6).toISOString()];
    const viewsOn = (date: Date, count: number, label: 'offer' | 'buy', click = false) => {
      const stats = new Stats(redis, () => date);
      stats.recordViews(Array.from({ length: count }, (_, i) => `B00000000${i}`), undefined, undefined, undefined, label);
      if (click) stats.recordClick('B000000000', undefined, undefined, undefined, label);
    };
    viewsOn(daysAgo(21, 12), 9, 'buy'); // the day before the test
    viewsOn(daysAgo(20, 12), 2, 'buy', true); // its first day
    viewsOn(daysAgo(7, 23), 3, 'offer'); // its last day
    viewsOn(daysAgo(6, 12), 5, 'offer'); // the day it ended at midnight: everyone sees the control
    viewsOn(daysAgo(0), 7, 'offer', true);
    await new Promise(resolve => setImmediate(resolve));
    await redis.set('amw:settings:button-label', JSON.stringify({ label: 'offer', mode: 'compare', labels: ['offer', 'buy'], startedAt, endsAt }));

    await call(app, auth, 'get', 'button-label');
    const { tests } = (await call(app, auth, 'get', 'ab-history')).body;
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({ startedAt, endedAt: endsAt, reason: 'expired' });
    expect([...tests[0].results].sort((a, b) => a.name.localeCompare(b.name))).toEqual([{ name: 'buy', views: 2, clicks: 1 }, { name: 'offer', views: 3, clicks: 0 }]);
  });

  it('records no results for a test older than the retention of the statistics', async () => {
    const { app, auth, redis } = await setup();
    await redis.set('amw:settings:button-label', JSON.stringify({ label: 'offer', mode: 'compare', labels: ['offer', 'buy'], startedAt: '2020-01-01T00:00:00.000Z', endsAt: '2020-01-15T00:00:00.000Z' }));
    await call(app, auth, 'get', 'button-label');
    const [entry] = (await call(app, auth, 'get', 'ab-history')).body.tests;
    expect(entry).toMatchObject({ reason: 'expired', endedAt: '2020-01-15T00:00:00.000Z' });
    expect(entry).not.toHaveProperty('results');
  });

  it('records the variant kept and the results of each variant', async () => {
    const { app, auth, stats } = await setup();
    await call(app, auth, 'put', 'theme-test', { mode: 'compare', themes: ['shelf', 'neon'] });
    stats.recordViews(['B000000001', 'B000000002'], undefined, undefined, 'neon');
    stats.recordClick('B000000001', undefined, undefined, 'neon');
    stats.recordViews(['B000000001'], undefined, undefined, 'shelf');
    await new Promise(resolve => setImmediate(resolve));
    await call(app, auth, 'put', 'theme-test', { mode: 'off', themes: [], theme: 'neon' });
    // Changing the theme again records nothing: no test ran
    await call(app, auth, 'put', 'theme-test', { mode: 'off', themes: [], theme: 'denim' });

    const [entry, ...others] = (await call(app, auth, 'get', 'ab-history')).body.tests;
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ kind: 'theme', variants: ['shelf', 'neon'], control: 'shelf', reason: 'kept', kept: 'neon', endedAt: expect.any(String) });
    expect(entry.results).toEqual([{ name: 'shelf', views: 1, clicks: 0 }, { name: 'neon', views: 2, clicks: 1 }]);
  });

  it('says a test stopped when it keeps the control', async () => {
    const { app, auth } = await setup();
    await call(app, auth, 'put', 'button-label', { label: 'offer', mode: 'compare', labels: ['offer', 'view'] });
    await call(app, auth, 'put', 'button-label', { label: 'offer', mode: 'off', labels: [] });
    expect((await call(app, auth, 'get', 'ab-history')).body.tests[0]).toMatchObject({ reason: 'stopped', kept: 'offer', control: 'offer' });
  });

  it('records an effect test against no effect', async () => {
    const { app, auth } = await setup();
    await call(app, auth, 'put', 'effect', { mode: 'compare', effects: ['none', 'zoom'] });
    await call(app, auth, 'put', 'effect', { mode: 'zoom', effects: ['none', 'zoom'] });
    expect((await call(app, auth, 'get', 'ab-history')).body.tests[0]).toMatchObject({ kind: 'effect', control: 'none', kept: 'zoom', reason: 'kept', results: [] });
  });

  it('ends the test even when the history or the statistics fail', async () => {
    const { app, auth, abHistory, stats, buttonLabel } = await setup();
    jest.spyOn(stats, 'getLabels').mockRejectedValue(new Error('down'));
    await call(app, auth, 'put', 'button-label', { label: 'offer', mode: 'compare', labels: ['offer', 'view'] });
    await call(app, auth, 'put', 'button-label', { label: 'offer', mode: 'off', labels: [] });
    expect((await call(app, auth, 'get', 'ab-history')).body.tests[0].results).toBeUndefined();

    jest.spyOn(abHistory, 'save').mockRejectedValue(new Error('down'));
    await call(app, auth, 'put', 'button-label', { label: 'offer', mode: 'compare', labels: ['offer', 'view'] });
    const stopped = await call(app, auth, 'put', 'button-label', { label: 'view', mode: 'off', labels: [] });
    expect(stopped.status).toBe(200);
    expect(buttonLabel.current()).toMatchObject({ label: 'view', mode: 'off' });
  });

  it('still serves the control group when the end of a test cannot be stored', async () => {
    const { app, auth, redis, buttonLabel } = await setup();
    await redis.set('amw:settings:button-label', JSON.stringify({ label: 'offer', mode: 'compare', labels: ['offer', 'buy'], startedAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-15T00:00:00.000Z' }));
    jest.spyOn(buttonLabel, 'save').mockRejectedValue(new Error('down'));
    expect((await call(app, auth, 'get', 'button-label')).body).toMatchObject({ mode: 'off' });
    expect((await call(app, auth, 'get', 'ab-history')).body.tests).toEqual([]);
  });

  it('answers 503 without a history', async () => {
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(createFakeRedis()), { password: PASSWORD, secret: SECRET }).router());
    expect((await call(app, `Bearer ${await login(app)}`, 'get', 'ab-history')).status).toBe(503);
  });

  it('keeps the history of each site apart, and rejects a site that is not a host', async () => {
    const { app, auth } = await setup();
    await call(app, auth, 'put', 'button-label?site=shop.example', { label: 'offer', mode: 'compare', labels: ['offer', 'view'] });
    await call(app, auth, 'put', 'button-label?site=shop.example', { label: 'view', mode: 'off', labels: [] });
    expect((await call(app, auth, 'get', 'ab-history?site=shop.example')).body.tests).toHaveLength(1);
    expect((await call(app, auth, 'get', 'ab-history')).body.tests).toEqual([]);
    expect((await call(app, auth, 'get', 'ab-history?site=a%20b')).status).toBe(400);
  });
});

describe('AdminApi sites', () => {
  const GEEEK = { host: 'www.geeek.org', description: 'Blog', url: 'https://www.geeek.org/', partnerTag: 'geeek-21' };

  async function setup(redis?: ReturnType<typeof createFakeRedis>, legacy?: Record<string, string>) {
    const partnerTags = new PartnerTagSettings(redis as never);
    if (legacy) await partnerTags.save({ sites: legacy });
    const sites = new SiteSettings(siteDefaults(['www.geeek.org', 'apollovan.fr']), redis as never, partnerTags);
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(redis), {
      password: PASSWORD, secret: SECRET, sites, defaultPartnerTag: 'main-21', recommendationEnabled: true
    }).router());
    return { app, auth: `Bearer ${await login(app)}`, sites };
  }
  const put = (app: express.Express, auth: string, body: unknown) =>
    request(app).put('/amw/admin/api/sites').set('Authorization', auth).send(body as object);

  it('requires a token', async () => {
    const { app } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/sites')).status).toBe(401);
    expect((await request(app).put('/amw/admin/api/sites').send({ sites: [] })).status).toBe(401);
  });

  it('starts from Server.allowedSites, with the former tracking IDs', async () => {
    const { app, auth } = await setup(createFakeRedis(), { 'apollovan.fr': 'apollovan-21' });
    expect((await request(app).get('/amw/admin/api/sites').set('Authorization', auth)).body).toEqual({
      sites: [
        { host: 'www.geeek.org', description: '', url: '', partnerTag: '', recommendations: true },
        { host: 'apollovan.fr', description: '', url: '', partnerTag: 'apollovan-21', recommendations: true },
      ],
      saved: false, defaultTag: 'main-21', recommendationEnabled: true, editable: true
    });
  });

  it('saves the sites, which then apply', async () => {
    const { app, auth, sites } = await setup(createFakeRedis(), { 'apollovan.fr': 'apollovan-21' });
    const res = await put(app, auth, { sites: [GEEEK, { host: 'new.example' }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: true, sites: [GEEEK, { host: 'new.example', description: '', url: '', partnerTag: '' }] });
    expect(sites.hosts).toEqual(['www.geeek.org', 'new.example']);
    expect(sites.recommendationHosts).toEqual(['www.geeek.org', 'new.example']);
    // The former tracking IDs no longer apply
    expect(sites.partnerTags).toEqual({ 'www.geeek.org': 'geeek-21' });
  });

  it('accepts an empty list, which allows every site and no recommendation', async () => {
    const { app, auth, sites } = await setup(createFakeRedis());
    expect((await put(app, auth, { sites: [] })).status).toBe(200);
    expect(sites.hosts).toEqual([]);
    expect(sites.recommendationHosts).toEqual([]);
  });

  it.each([
    [{ sites: [{ ...GEEEK, partnerTag: 'geeek' }] }],
    [{ sites: [{ ...GEEEK, partnerTag: 'a-21&tag=b-21' }] }],
    [{ sites: [{ ...GEEEK, host: 'https://www.geeek.org' }] }],
    [{ sites: [{ ...GEEEK, host: 'WWW.geeek.org' }] }],
    [{ sites: [{ ...GEEEK, url: 'javascript:alert(1)' }] }],
    [{ sites: [{ ...GEEEK, description: 'x'.repeat(201) }] }],
    [{ sites: [GEEEK, GEEEK] }],
    [{ sites: [{ ...GEEEK, other: 1 }] }],
    [{ sites: Array.from({ length: 51 }, (_, i) => ({ host: `s${i}.example` })) }],
    [{ sites: {} }],
    [{}],
  ])('rejects %j', async body => {
    const { app, auth, sites } = await setup(createFakeRedis());
    expect((await put(app, auth, body)).status).toBe(400);
    expect(sites.saved).toBe(false);
  });

  it('answers 503 without a store', async () => {
    const { app, auth } = await setup();
    expect((await put(app, auth, { sites: [] })).status).toBe(503);
  });
});

describe('AdminApi settings of the portal, when they fail', () => {
  it('answers 503 when a setting is not available', async () => {
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET }).router());
    const auth = `Bearer ${await login(app)}`;

    for (const path of ['effect', 'theme-test', 'sites', 'stuffing']) {
      expect((await request(app).get(`/amw/admin/api/${path}`).set('Authorization', auth)).status).toBe(503);
    }
  });

  it('answers 503, and keeps the value, when Redis cannot store a change', async () => {
    const redis = createFakeRedis();
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('down'));
    const effect = new EffectSettings({ mode: 'none', effects: ['none', 'fade', 'slide', 'zoom', 'pulse', 'shine'] }, redis as never);
    const themeTest = new ThemeTestSettings(redis as never);
    const sites = new SiteSettings(siteDefaults([]), redis as never);
    const stuffing = new StuffingSettings({ count: 0, mode: 'manual', containerId: 'main-content', products: [], wordsPerCard: 0, sites: {} }, redis as never);
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(redis), { password: PASSWORD, secret: SECRET, effect, themeTest, sites, stuffing }).router());
    const auth = `Bearer ${await login(app)}`;
    const put = (path: string, body: object) => request(app).put(`/amw/admin/api/${path}`).set('Authorization', auth).send(body);

    expect((await put('effect', { mode: 'fade' })).status).toBe(503);
    expect((await put('theme-test', { mode: 'compare', themes: ['shelf', 'neon'] })).status).toBe(503);
    expect((await put('sites', { sites: [{ host: 'www.example.com' }] })).status).toBe(503);
    expect((await put('stuffing', { count: 1, mode: 'manual', containerId: 'x' })).status).toBe(503);
    expect(effect.current().mode).toBe('none');
    expect(sites.saved).toBe(false);
  });
});

describe('AdminApi settings backup', () => {
  const stuffingDefaults = { count: 0, mode: 'recommendation' as const, containerId: 'main-content', products: [] as string[], wordsPerCard: 0, sites: {} as Record<string, number> };

  async function setup(redis?: ReturnType<typeof createFakeRedis>, recommendationEnabled = true) {
    const store = redis as never;
    const settings = {
      stuffing: new StuffingSettings(stuffingDefaults, store),
      effect: new EffectSettings({ mode: 'fade', effects: ['fade', 'slide'] } as never, store),
      themeTest: new ThemeTestSettings(store),
      sites: new SiteSettings(siteDefaults([]), store),
    };
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET, version: { release: '5.5.0', revision: null, buildDate: null }, recommendationEnabled, ...settings }).router());
    return { app, auth: `Bearer ${await login(app)}`, settings };
  }
  const post = (app: express.Express, auth: string, body: unknown) =>
    request(app).post('/amw/admin/api/settings/import').set('Authorization', auth).send(body as object);

  it('requires a token', async () => {
    const { app } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/settings/export')).status).toBe(401);
    expect((await request(app).post('/amw/admin/api/settings/import').send({})).status).toBe(401);
  });

  it('exports every setting, and imports the file back', async () => {
    const source = await setup(createFakeRedis());
    await source.settings.sites.save({ sites: [{ host: 'www.example.com', description: '', url: '', partnerTag: 'example-21', recommendations: true }] });
    await source.settings.themeTest.save({ mode: 'compare', themes: ['shelf', 'neon'] });
    const exported = (await request(source.app).get('/amw/admin/api/settings/export').set('Authorization', source.auth)).body;
    expect(exported).toMatchObject({
      amw: '5.5.0',
      stuffing: stuffingDefaults,
      themeTest: { mode: 'compare', themes: ['shelf', 'neon'] },
      sites: { sites: [{ host: 'www.example.com', description: '', url: '', partnerTag: 'example-21' }] },
    });
    expect(Date.parse(exported.exportedAt)).not.toBeNaN();

    const target = await setup(createFakeRedis());
    const res = await post(target.app, target.auth, exported);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: ['stuffing', 'effect', 'themeTest', 'sites'] });
    expect(target.settings.sites.current()).toEqual({ sites: [{ host: 'www.example.com', description: '', url: '', partnerTag: 'example-21', recommendations: true }] });
    expect(target.settings.themeTest.current()).toEqual({ mode: 'compare', themes: ['shelf', 'neon'] });
  });

  it('imports only the sections present', async () => {
    const { app, auth, settings } = await setup(createFakeRedis());
    const res = await post(app, auth, { sites: { sites: [{ host: 'www.example.com', description: '', url: '', partnerTag: 'example-21' }] } });
    expect(res.body).toEqual({ imported: ['sites'] });
    expect(settings.themeTest.current()).toEqual({ mode: 'off', themes: [] });
  });

  it('imports nothing when one section is invalid', async () => {
    const { app, auth, settings } = await setup(createFakeRedis());
    const res = await post(app, auth, { sites: { sites: [{ host: 'www.example.com', description: '', url: '', partnerTag: 'example-21' }] }, themeTest: { mode: 'compare', themes: ['shelf'] } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/themeTest/);
    expect(settings.sites.saved).toBe(false);
  });

  it('refuses a file without any setting', async () => {
    const { app, auth } = await setup(createFakeRedis());
    expect((await post(app, auth, { amw: '5.5.0' })).status).toBe(400);
    expect((await post(app, auth, [1, 2])).status).toBe(400);
  });

  it('refuses recommended cards without recommendations', async () => {
    const { app, auth, settings } = await setup(createFakeRedis(), false);
    const res = await post(app, auth, { stuffing: { ...stuffingDefaults, count: 2 } });
    expect(res.status).toBe(400);
    expect(settings.stuffing.current().count).toBe(0);
    expect((await post(app, auth, { stuffing: { ...stuffingDefaults, count: 2, mode: 'manual' } })).status).toBe(200);
  });

  it('needs a store', async () => {
    const { app, auth } = await setup(undefined);
    expect((await post(app, auth, { sites: { sites: [] } })).status).toBe(503);
    // Without a store, the export still gives the values in use
    expect((await request(app).get('/amw/admin/api/settings/export').set('Authorization', auth)).body.sites).toEqual({ sites: [] });
  });

  it('reports a store that fails during the import', async () => {
    const redis = createFakeRedis();
    const { app, auth } = await setup(redis);
    const set = jest.spyOn(redis, 'set').mockResolvedValueOnce('OK').mockRejectedValueOnce(new Error('down'));
    const res = await post(app, auth, { themeTest: { mode: 'off', themes: [] }, sites: { sites: [] } });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/after themeTest/);
    set.mockRestore();
  });

  it('exports nothing more than the settings available', async () => {
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET }).router());
    const auth = `Bearer ${await login(app)}`;
    const body = (await request(app).get('/amw/admin/api/settings/export').set('Authorization', auth)).body;
    expect(Object.keys(body).sort()).toEqual(['amw', 'exportedAt']);
    expect((await post(app, auth, { sites: { sites: [] } })).status).toBe(503);
  });
});

describe('AdminApi live settings', () => {
  async function setup(redis?: ReturnType<typeof createFakeRedis>, insights?: Insights) {
    mockConfig['Admin.insights'] = true;
    const tunables = new Tunables(loadSettings(), redis as never);
    delete mockConfig['Admin.insights'];
    const stats = new Stats(redis);
    const app = express();
    app.use('/amw/admin', new AdminApi(stats, { password: PASSWORD, secret: SECRET, tunables, insights }).router());
    return { app, auth: `Bearer ${await login(app)}`, tunables };
  }
  const put = (app: express.Express, auth: string, body: unknown) =>
    request(app).put('/amw/admin/api/tunables').set('Authorization', auth).send(body as object);

  test('requires a token', async () => {
    const { app } = await setup(createFakeRedis());
    expect((await request(app).get('/amw/admin/api/tunables')).status).toBe(401);
    expect((await request(app).put('/amw/admin/api/tunables').send({})).status).toBe(401);
  });

  test('reads the configuration, then saves the changes', async () => {
    const { app, auth, tunables } = await setup(createFakeRedis());
    const initial = (await request(app).get('/amw/admin/api/tunables').set('Authorization', auth)).body;
    expect(initial).toMatchObject({ overrides: {}, editable: true, effective: { theme: 'default' } });
    expect(initial.themes).toContain('neon');

    const res = await put(app, auth, { theme: 'neon', rateLimit: 30 });
    expect(res.status).toBe(200);
    expect(res.body.overrides).toEqual({ theme: 'neon', rateLimit: 30 });
    expect(tunables.effective).toMatchObject({ theme: 'neon', rateLimit: 30 });
  });

  test('refuses invalid values and settings that are not live', async () => {
    const { app, auth } = await setup(createFakeRedis());
    expect((await put(app, auth, { httpCache: -5 })).status).toBe(400);
    expect((await put(app, auth, { trustProxy: true })).status).toBe(400);
  });

  test('needs a store, and reports one that fails', async () => {
    const without = await setup(undefined);
    expect((await put(without.app, without.auth, { theme: 'neon' })).status).toBe(503);

    const redis = createFakeRedis();
    const failing = await setup(redis);
    jest.spyOn(redis, 'set').mockRejectedValueOnce(new Error('down'));
    expect((await put(failing.app, failing.auth, { theme: 'neon' })).status).toBe(503);
  });

  test('is unavailable without the setting', async () => {
    const app = express();
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET }).router());
    expect((await request(app).get('/amw/admin/api/tunables').set('Authorization', `Bearer ${await login(app)}`)).status).toBe(503);
  });

  test('pauses new AI insights, and still serves the last report', async () => {
    const insights = { report: jest.fn(), latest: jest.fn().mockResolvedValue({ available: true, cached: true }) } as unknown as Insights & { report: jest.Mock };
    const { app, auth } = await setup(createFakeRedis(), insights);
    await put(app, auth, { insights: false });

    const generated = await request(app).post('/amw/admin/api/insights?days=7').set('Authorization', auth);
    expect(generated.body).toEqual({ available: false, reason: 'AI insights are paused in the Settings view' });
    expect(insights.report).not.toHaveBeenCalled();
    expect((await request(app).get('/amw/admin/api/insights?days=7').set('Authorization', auth)).body.cached).toBe(true);
    // A site must be a host
    expect((await request(app).get('/amw/admin/api/insights?days=7&site=not%20a%20host').set('Authorization', auth)).status).toBe(400);
    // A custom period of 7 days reads the report of the last 7 days
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    expect((await request(app).get(`/amw/admin/api/insights?from=${weekAgo}&to=${today}`).set('Authorization', auth)).body.cached).toBe(true);
  });

  test('takes part in the backup', async () => {
    const { app, auth, tunables } = await setup(createFakeRedis());
    await put(app, auth, { fallback: false });
    const exported = (await request(app).get('/amw/admin/api/settings/export').set('Authorization', auth)).body;
    expect(exported.tunables).toEqual({ fallback: false });

    await put(app, auth, {});
    const res = await request(app).post('/amw/admin/api/settings/import').set('Authorization', auth).send({ tunables: { fallback: false } });
    expect(res.body).toEqual({ imported: ['tunables'] });
    expect(tunables.effective.fallback).toBe(false);
  });
});
