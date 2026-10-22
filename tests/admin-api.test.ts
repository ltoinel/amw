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

const PASSWORD = 'correct horse battery';

function buildApp(stats: Stats, loginRateLimit?: number): { app: express.Application; admin: AdminApi } {
  const admin = new AdminApi(stats, { password: PASSWORD, secret: 'test-secret', loginRateLimit });
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
    expect(AdminApi.fromConfig(new Stats(), {})).toBeUndefined();
  });

  test('refuses to start without a password', () => {
    mockConfig['Admin.enabled'] = true;
    expect(() => AdminApi.fromConfig(new Stats(), {})).toThrow('AMW_ADMIN_PASSWORD is not set');
  });

  test('refuses a weak password', () => {
    mockConfig['Admin.enabled'] = true;
    expect(() => AdminApi.fromConfig(new Stats(), { AMW_ADMIN_PASSWORD: 'short' }))
      .toThrow('at least 12 characters');
  });

  test('reads the password and the options when enabled', () => {
    mockConfig['Admin.enabled'] = true;
    mockConfig['Admin.tokenTtl'] = 60;
    mockConfig['Admin.loginRateLimit'] = 3;
    const admin = AdminApi.fromConfig(new Stats(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_ADMIN_SECRET: 's' });
    expect(admin).toBeInstanceOf(AdminApi);
    const { expiresAt } = admin!.createToken(0);
    expect(expiresAt).toBe(new Date(60 * 1000).toISOString());
  });

  test('only a boolean true enables it', () => {
    mockConfig['Admin.enabled'] = 'yes';
    expect(AdminApi.fromConfig(new Stats(), { AMW_ADMIN_PASSWORD: PASSWORD })).toBeUndefined();
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

    const pages = await request(app).get('/amw/admin/api/stats/pages?days=7&limit=5').set(auth);
    expect(pages.status).toBe(200);
    expect(pages.body).toEqual([{ url: 'https://blog.example/post', impressions: 1, clicks: 1, ctr: 1 }]);

    const notFound = await request(app).get('/amw/admin/api/stats/notfound').set(auth);
    expect(notFound.body[0]).toMatchObject({ value: 'B00GONE001', referers: [{ url: 'https://blog.example/post', count: 1 }] });
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
