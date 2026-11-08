/**
 * Unit tests for the settings the portal changes while the server runs (src/server/Tunables.ts).
 */

import { ConfigSource, loadSettings } from '../src/server/Settings';
import { Tunables } from '../src/server/Tunables';
import { createFakeRedis } from './helpers/fakeRedis';
import { baseConfig } from './helpers/mocks';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() }),
  createRequestLogger: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

function settings(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { ...baseConfig, 'Server.httpCache': 300, 'Server.rateLimit': 120, ...overrides };
  const source: ConfigSource = {
    get: <T>(key: string): T => {
      if (!(key in values)) throw new Error(`Configuration property "${key}" is not defined`);
      return values[key] as T;
    },
    has: (key: string) => key in values,
  };
  return loadSettings(source);
}

const withAi = { 'Redis.enabled': true, 'Server.allowedSites': ['www.example.com'], 'Recommendation.enabled': true, 'Recommendation.dailyLimit': 100, 'Admin.insights': true };

describe('Tunables', () => {
  it('follows the configuration until the portal changes a setting', async () => {
    const tunables = new Tunables(settings({ 'Server.theme': 'shelf' }), createFakeRedis() as never);
    expect(tunables.effective).toMatchObject({ theme: 'shelf', httpCache: 300, rateLimit: 120, recommendations: false, insights: false });
    expect(tunables.theme).toBe('shelf');

    await tunables.save({ theme: 'neon', httpCache: 60 });
    expect(tunables.theme).toBe('neon');
    expect(tunables.httpCache).toBe(60);
    expect(tunables.effective.rateLimit).toBe(120);
    expect(tunables.configured.theme).toBe('shelf');
  });

  it('pauses the AI features, but cannot turn on one the configuration leaves off', async () => {
    const on = new Tunables(settings(withAi), createFakeRedis() as never);
    await on.save({ recommendations: false, insights: false, dailyLimit: 10 });
    expect(on.effective).toMatchObject({ recommendations: false, insights: false, dailyLimit: 10 });

    const off = new Tunables(settings(), createFakeRedis() as never);
    await off.save({ recommendations: true, insights: true });
    expect(off.effective).toMatchObject({ recommendations: false, insights: false });
  });

  it.each([
    [{ theme: 'nope' }],
    [{ httpCache: 86401 }],
    [{ httpCache: -1 }],
    [{ rateLimit: 0 }],
    [{ dailyLimit: 1.5 }],
    [{ fallback: 'yes' }],
    [{ trustProxy: true }],
    [{ allowedIps: [] }],
  ])('refuses %j', async value => {
    const tunables = new Tunables(settings(), createFakeRedis() as never);
    expect(await tunables.save(value)).toBeNull();
    expect(tunables.current()).toEqual({});
  });

  it('shares the values through the store', async () => {
    const redis = createFakeRedis();
    let now = 0;
    const writer = new Tunables(settings(), redis as never);
    const reader = new Tunables(settings(), redis as never, () => now);
    await writer.save({ clickRateLimit: 5 });
    await reader.refresh();
    expect(reader.effective.clickRateLimit).toBe(5);
    now += 1;
    expect(reader.effective.viewRateLimit).toBe(settings().server.viewRateLimit);
  });
});
