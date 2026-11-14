/**
 * Unit tests for the IP filter of the administration portal (src/server/IpFilter.ts)
 */

import express from 'express';
import request from 'supertest';

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));
jest.mock('config', () => ({ has: () => false, get: () => undefined }));

import { AdminApi } from '../src/server/AdminApi';
import { createIpMatcher, parseIpRule } from '../src/server/IpFilter';
import { Stats } from '../src/server/Stats';

describe('parseIpRule', () => {
  it.each(['192.0.2.10', '10.0.0.0/8', '0.0.0.0/0', '2001:db8::1', '2001:db8::/32', ' 192.0.2.10 '])('accepts %s', rule => {
    expect(parseIpRule(rule)).not.toBeNull();
  });

  it.each(['', 'localhost', '192.0.2.300', '10.0.0.0/33', '2001:db8::/129', '10.0.0.0/8/1', '10.0.0.0/', '10.0.0.0/-1', 42, null])('rejects %s', rule => {
    expect(parseIpRule(rule)).toBeNull();
  });
});

describe('createIpMatcher', () => {
  it('allows every address without rules', () => {
    expect(createIpMatcher([])).toBeUndefined();
  });

  it('matches addresses and ranges, IPv4 and IPv6', () => {
    const allowed = createIpMatcher(['203.0.113.7', '10.0.0.0/8', '2001:db8::/32'])!;
    expect(allowed('203.0.113.7')).toBe(true);
    expect(allowed('10.20.30.40')).toBe(true);
    expect(allowed('2001:db8::42')).toBe(true);
    expect(allowed('203.0.113.8')).toBe(false);
    expect(allowed('11.0.0.1')).toBe(false);
    expect(allowed('2001:db9::1')).toBe(false);
  });

  it('matches the IPv4 clients of a dual-stack socket', () => {
    const allowed = createIpMatcher(['203.0.113.7'])!;
    expect(allowed('::ffff:203.0.113.7')).toBe(true);
    expect(allowed('::ffff:203.0.113.8')).toBe(false);
  });

  it('refuses a request without an address', () => {
    expect(createIpMatcher(['0.0.0.0/0'])!(undefined)).toBe(false);
  });

  it('throws on an invalid rule', () => {
    expect(() => createIpMatcher(['nope'])).toThrow('Invalid IP address or range: nope');
  });
});

describe('admin portal behind Admin.allowedIps', () => {
  const SECRET = 'test-secret-0123456789abcdef0123456789';

  function app(allowedIps: string[], trustProxy: boolean | number = 1): express.Application {
    const admin = new AdminApi(new Stats(), { password: 'correct horse battery', secret: SECRET, allowedIps });
    const server = express();
    server.set('trust proxy', trustProxy);
    server.use('/amw/admin', admin.router());
    return server;
  }

  it('refuses other addresses before the login', async () => {
    const res = await request(app(['203.0.113.7'])).post('/amw/admin/api/login')
      .set('X-Forwarded-For', '198.51.100.1').send({ password: 'correct horse battery' });
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses the portal pages and the API too', async () => {
    const server = app(['203.0.113.7']);
    expect((await request(server).get('/amw/admin/').set('X-Forwarded-For', '198.51.100.1')).status).toBe(403);
    expect((await request(server).get('/amw/admin/api/status').set('X-Forwarded-For', '198.51.100.1')).status).toBe(403);
  });

  it('lets an allowed address log in', async () => {
    const res = await request(app(['203.0.113.0/24'])).post('/amw/admin/api/login')
      .set('X-Forwarded-For', '203.0.113.7').send({ password: 'correct horse battery' });
    expect(res.status).toBe(200);
  });

  it('changes nothing without rules', async () => {
    const res = await request(app([])).post('/amw/admin/api/login').send({ password: 'correct horse battery' });
    expect(res.status).toBe(200);
  });
});
