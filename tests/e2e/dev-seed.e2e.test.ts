/**
 * End-to-end test of npm run dev:seed against the Redis designated by REDIS_HOST: the simulated
 * statistics must be read back by Stats as the portal reads them.
 */

import Redis from 'ioredis';
import { seed } from '../../scripts/dev-seed';
import { SiteSettings } from '../../src/server/SiteSettings';
import { Stats } from '../../src/server/Stats';

// The logger reads the configuration files, which this test does not need
jest.mock('../../src/utils/logger', () => ({
  getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const describeWithRedis = process.env.REDIS_HOST ? describe : describe.skip;
// A database of its own, so that the other suites keep their statistics
const SEED_DB = 15;

describeWithRedis('Simulated statistics of npm run dev:seed (e2e)', () => {
  let redis: Redis;
  let stats: Stats;
  let hosts: string[];

  beforeAll(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: SEED_DB,
    });
    await redis.flushdb();
    hosts = await seed(redis);
    stats = new Stats(redis, () => new Date(), hosts);
  }, 120000);

  afterAll(async () => {
    await redis?.flushdb();
    redis?.disconnect();
  });

  it('adds the simulated sites to the Sites page', async () => {
    const sites = new SiteSettings({ server: { allowedSites: [] }, recommendation: { allowedHosts: [] } }, redis);
    await sites.refresh();

    expect(sites.hosts).toEqual(expect.arrayContaining(hosts));
  });

  it('fills every day, with the Amazon calls counted after the first days', async () => {
    const daily = await stats.getDaily(30);

    expect(daily).toHaveLength(30);
    expect(daily.every(day => day.views > 0 && day.cache > 0)).toBe(true);
    expect(daily.reduce((sum, day) => sum + day.clicks, 0)).toBeGreaterThan(0);
    expect(daily[0].amazonCalls).toBeNull();
    expect(daily[29].amazonCalls).toBeGreaterThan(0);
  });

  it('splits the traffic by site', async () => {
    const total = (await stats.getDaily(30)).reduce((sum, day) => sum + day.views, 0);
    const bySite = await Promise.all(hosts.map(async host => (await stats.getDaily(30, host)).reduce((sum, day) => sum + day.views, 0)));

    expect(bySite.every(views => views > 0)).toBe(true);
    // The pages of a site off the list count in the total only
    expect(bySite.reduce((sum, views) => sum + views, 0)).toBeLessThan(total);
    expect(await stats.getTopProducts(30, 10, hosts[2])).not.toHaveLength(0);
  });

  it('lists products to replace, with and without a remembered title', async () => {
    const notFound = await stats.getNotFound(10);

    expect(notFound.length).toBeGreaterThan(1);
    expect(notFound.some(product => product.title)).toBe(true);
    expect(notFound.some(product => !product.title)).toBe(true);
    expect(notFound.every(product => product.referers.length > 0)).toBe(true);
  });

  it('feeds the A/B tests and the Claude costs', async () => {
    expect((await stats.getEffects(30)).some(effect => effect.views > 0)).toBe(true);
    expect((await stats.getThemes(30)).some(theme => theme.views > 0)).toBe(true);
    expect((await stats.getLlmUsage(30)).map(usage => usage.feature).sort()).toEqual(['insights', 'recommendation']);
  });
});
