/**
 * Unit tests for the typed settings (src/server/Settings.ts), and for injecting them into the
 * server classes without mocking node-config.
 */

import os from 'os';
import { ConfigSource, loadSettings } from '../src/server/Settings';
import { baseConfig } from './helpers/mocks';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() }),
  createRequestLogger: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

/** Behaves like node-config: get() throws on unknown keys. Undefined values are absent keys. */
function source(overrides: Record<string, unknown> = {}): ConfigSource {
  const values: Record<string, unknown> = { ...baseConfig, ...overrides };
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) delete values[key];
  }
  return {
    get: <T>(key: string): T => {
      if (!(key in values)) throw new Error(`Configuration property "${key}" is not defined`);
      return values[key] as T;
    },
    has: (key: string) => key in values,
  };
}

describe('loadSettings', () => {
  it('reads every section into typed values', () => {
    const settings = loadSettings(source());

    expect(settings.server).toMatchObject({ port: 8080, path: '/amw', debug: false, cors: false, httpCache: 3600, rateLimit: 120, trustProxy: false });
    expect(settings.redis).toMatchObject({ enabled: false, host: 'localhost', port: 6379, expire: 3600 });
    expect(settings.amazon).toMatchObject({ partnerTag: 'test-21', marketplace: 'www.amazon.fr', condition: 'New', apiBasePath: '', authEndpoint: '' });
    expect(settings.admin).toEqual({ enabled: false, tokenTtl: undefined, loginRateLimit: undefined });
  });

  it('applies the defaults of the optional keys', () => {
    const settings = loadSettings(source({ 'Server.rateLimit': undefined, 'Server.trustProxy': undefined }));

    expect(settings.server).toMatchObject({ rateLimit: 120, clickRateLimit: 60, metrics: false, swagger: false, trustProxy: false });
    expect(settings.redis).toMatchObject({ staleExpire: 86400, notFoundExpire: 3600 });
    expect(settings.amazon).toMatchObject({ breakerThreshold: 5, breakerCooldown: 60 });
  });

  it('accepts "true" strings for the flags, as environment variables provide', () => {
    const settings = loadSettings(source({ 'Server.debug': 'true', 'Server.cors': 'true', 'Server.metrics': 'true', 'Server.swagger': true }));

    expect(settings.server).toMatchObject({ debug: true, cors: true, metrics: true, swagger: true });
  });

  it('enables the admin only for a boolean true', () => {
    expect(loadSettings(source({ 'Admin.enabled': 'true' })).admin.enabled).toBe(false);
    expect(loadSettings(source({ 'Admin.enabled': true, 'Admin.tokenTtl': '600' })).admin).toMatchObject({ enabled: true, tokenTtl: 600 });
  });

  it.each([
    [{ 'Server.port': 70000 }, 'Invalid port configuration: 70000'],
    [{ 'Server.path': 'amw' }, "Invalid relative path: amw. Must start with '/'."],
    [{ 'Server.httpCache': -1 }, 'Invalid HTTP cache configuration: -1'],
    [{ 'Server.projectDir': '' }, 'Server.projectDir configuration is required'],
    [{ 'Redis.expire': -5 }, 'Redis.expire must be a positive number'],
    [{ 'Redis.staleExpire': 'soon' }, 'Redis.staleExpire must be a positive number or 0'],
    [{ 'Amazon.breakerCooldown': -1 }, 'Amazon.breakerCooldown must be a positive number or 0'],
  ])('refuses %p', (overrides, message) => {
    expect(() => loadSettings(source(overrides))).toThrow(message);
  });

  it('fails on a missing required key', () => {
    expect(() => loadSettings(source({ 'Amazon.partnerTag': undefined }))).toThrow('"Amazon.partnerTag" is not defined');
  });
});

describe('settings injection', () => {
  it('builds the server from injected settings, without node-config', () => {
    jest.doMock('config', () => {
      throw new Error('node-config must not be loaded');
    });
    jest.isolateModules(() => {
      const { AmwServer } = require('../src/server/AmwServer');
      const { loadSettings: load } = require('../src/server/Settings');
      const settings = load(source({ 'Server.projectDir': os.tmpdir(), 'Server.path': '/injected' }));

      expect(() => new AmwServer(settings)).not.toThrow();
    });
  });
});
