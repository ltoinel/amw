/**
 * Server.allowedSites on the widget API (src/server/SiteGuard.ts and its wiring in AmwServer)
 */

import express from 'express';
import request from 'supertest';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() }),
  createRequestLogger: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { createSiteGuard, isAllowedSite } from '../src/server/SiteGuard';

const SITES = ['www.example.com', 'localhost:8082'];

function app(allowedSites: string[] = SITES): express.Application {
  const application = express();
  application.get('/product', createSiteGuard(allowedSites), (_req, res) => { res.status(200).json({ ok: true }); });
  return application;
}

describe('isAllowedSite', () => {
  it.each([
    ['https://www.example.com', true],
    ['https://www.example.com/article?x=1', true],
    ['http://WWW.EXAMPLE.COM/', true],
    ['http://localhost:8082/page', true],
    ['http://localhost:9999/page', false],
    ['https://example.com/', false],
    ['https://www.example.com.evil.net/', false],
    ['https://evil.net/www.example.com', false],
    ['https://www.example.com@evil.net/', false],
    ['null', false],
    ['not a url', false],
  ])('%s: %s', (url, expected) => {
    expect(isAllowedSite(url, SITES)).toBe(expected);
  });

  it('allows every site with an empty list', () => {
    expect(isAllowedSite('https://evil.net/', [])).toBe(true);
  });
});

describe('createSiteGuard', () => {
  it('accepts a listed site, by Origin or by Referer', async () => {
    expect((await request(app()).get('/product').set('Origin', 'https://www.example.com')).status).toBe(200);
    expect((await request(app()).get('/product').set('Referer', 'https://www.example.com/article')).status).toBe(200);
  });

  it('rejects another site with an answer that a CDN never stores', async () => {
    const res = await request(app()).get('/product').set('Referer', 'https://evil.net/page');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('trusts Origin over a Referer naming a listed site', async () => {
    const res = await request(app()).get('/product').set('Origin', 'https://evil.net').set('Referer', 'https://www.example.com/');
    expect(res.status).toBe(403);
  });

  it('rejects the "null" origin of a sandboxed frame', async () => {
    expect((await request(app()).get('/product').set('Origin', 'null')).status).toBe(403);
  });

  it('lets through a request without these headers', async () => {
    expect((await request(app()).get('/product')).status).toBe(200);
  });

  it('changes nothing with an empty list', async () => {
    expect((await request(app([])).get('/product').set('Origin', 'https://evil.net')).status).toBe(200);
  });
});
