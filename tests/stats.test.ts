/**
 * Unit tests for the usage statistics (src/server/Stats.ts) and the click beacon endpoint
 */

import express from 'express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { createFakeRedis } from './helpers/fakeRedis';

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

import { Stats, createClickHandler, createViewHandler } from '../src/server/Stats';

const NOW = new Date('2026-10-20T12:00:00Z');
const YESTERDAY = new Date('2026-10-19T12:00:00Z');

function readyRedis(): Redis {
  return createFakeRedis();
}

// Collection is fire-and-forget: let the queued MULTI resolve
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('Stats', () => {
  let redis: Redis;
  let now: Date;
  let stats: Stats;

  beforeEach(async () => {
    redis = readyRedis();
    await redis.flushall();
    now = NOW;
    stats = new Stats(redis, () => now);
  });

  test('is disabled and a no-op without Redis', async () => {
    const disabled = new Stats(undefined);
    expect(disabled.enabled).toBe(false);
    expect(() => disabled.recordProduct('cache', 'id', 'B000000001')).not.toThrow();
    expect(() => disabled.recordClick('B000000001')).not.toThrow();
    expect(() => disabled.recordViews(['B000000001'])).not.toThrow();
    await expect(disabled.getDaily(7)).rejects.toThrow('Statistics require Redis');
  });

  test('skips collection while Redis is not connected', () => {
    const offline = createFakeRedis();
    offline.status = 'reconnecting';
    const multi = jest.spyOn(offline, 'multi');
    new Stats(offline).recordProduct('cache', 'id', 'B000000001');
    expect(multi).not.toHaveBeenCalled();
  });

  test('counts hits per day and per source', async () => {
    stats.recordProduct('cache', 'id', 'B000000001');
    stats.recordProduct('cache', 'id', 'B000000001');
    stats.recordProduct('amazon', 'id', 'B000000002');
    stats.recordProduct('notfound', 'id', 'B000000003');
    stats.recordClick('B000000001');
    now = YESTERDAY;
    stats.recordProduct('amazon', 'id', 'B000000001');
    now = NOW;
    await flush();

    expect(await stats.getDaily(3)).toEqual([
      { date: '2026-10-18', cache: 0, amazon: 0, notfound: 0, views: 0, visits: null, clicks: 0, amazonCalls: null },
      { date: '2026-10-19', cache: 0, amazon: 1, notfound: 0, views: 1, visits: null, clicks: 0, amazonCalls: null },
      { date: '2026-10-20', cache: 2, amazon: 1, notfound: 1, views: 3, visits: null, clicks: 1, amazonCalls: null }
    ]);
  });

  test('reads a range of dates as well as the last days', async () => {
    stats.recordProduct('cache', 'id', 'B000000001');
    now = YESTERDAY;
    stats.recordProduct('amazon', 'id', 'B000000001');
    now = NOW;
    await flush();

    expect((await stats.getDaily({ from: '2026-10-19', to: '2026-10-19' })).map(day => [day.date, day.amazon, day.cache]))
      .toEqual([['2026-10-19', 1, 0]]);
    expect((await stats.getDaily({ from: '2026-10-18', to: '2026-10-20' })).map(day => day.date))
      .toEqual(['2026-10-18', '2026-10-19', '2026-10-20']);
  });

  test('counts the views of the beacon, not the lookups, once a day has any', async () => {
    stats.recordProduct('amazon', 'id', 'B000000001', 'https://blog.example/a');
    stats.recordProduct('cache', 'id', 'B000000001', 'https://blog.example/a');
    await flush();
    expect(await stats.getTopProducts(1, 10)).toEqual([]);
    expect(await stats.getTopPages(1, 10)).toEqual([]);

    stats.recordViews(['B000000001', 'B000000001', 'B000000002'], 'https://blog.example/a?utm=1');
    await flush();

    expect((await stats.getDaily(1))[0]).toMatchObject({ cache: 1, amazon: 1, views: 3 });
    expect((await stats.getTopProducts(1, 10)).map(({ value, impressions }) => [value, impressions])).toEqual([
      ['B000000001', 2], ['B000000002', 1]
    ]);
    expect(await stats.getTopPages(1, 10)).toEqual([{ url: 'https://blog.example/a', impressions: 3, clicks: 0, ctr: 0 }]);
  });

  test('bounds the daily product set fed by the view beacon', async () => {
    for (let i = 0; i < 1005; i++) {
      stats.recordViews([`B${String(i).padStart(9, '0')}`]);
    }
    await flush();

    expect(await redis.zcard('amw:stats:impressions:2026-10-20')).toBe(1000);
  });

  test('counts the requests sent to Amazon from the first one, and none for a single site', async () => {
    now = YESTERDAY;
    expect((await stats.getDaily(2)).map(day => day.amazonCalls)).toEqual([null, null]);
    stats.recordAmazonCall();
    stats.recordAmazonCall();
    now = NOW;
    await flush();
    // Today has no call yet: 0, not "no data"
    expect((await stats.getDaily(3)).map(day => day.amazonCalls)).toEqual([null, 2, 0]);
    stats.recordAmazonCall();
    await flush();
    expect((await stats.getDaily(1))[0].amazonCalls).toBe(1);
    expect((await stats.getDaily(1, 'blog.example'))[0].amazonCalls).toBeNull();
    expect(await redis.ttl('amw:stats:amazon-calls:since')).toBe(-1);
  });

  describe('figures of a site', () => {
    const ranked = () => new Stats(redis, () => now, ['blog.example', 'shop.example:8080']);

    test('counts the hits, views, clicks and products of each listed site', async () => {
      const service = ranked();
      service.recordProduct('cache', 'id', 'B000000001', 'https://blog.example/a');
      service.recordProduct('amazon', 'id', 'B000000002', 'https://shop.example:8080/b');
      service.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/a');
      service.recordProduct('notfound', 'id', 'B00GONE002', 'https://shop.example:8080/b');
      service.recordViews(['B000000001', 'B000000001', 'B000000003'], 'https://blog.example/a');
      service.recordViews(['B000000002'], 'https://shop.example:8080/b');
      service.recordClick('B000000001', 'https://blog.example/a');
      // Outside the list: in the totals only
      service.recordViews(['B000000009'], 'https://spam.example/x');
      service.recordProduct('cache', 'id', 'B000000009', 'https://spam.example/x');
      await flush();

      expect((await service.getDaily(1, 'blog.example'))[0]).toMatchObject({ cache: 1, amazon: 0, notfound: 1, views: 3, clicks: 1 });
      expect((await service.getDaily(1, 'shop.example:8080'))[0]).toMatchObject({ cache: 0, amazon: 1, notfound: 1, views: 1, clicks: 0 });
      expect((await service.getDaily(1))[0]).toMatchObject({ cache: 2, views: 5, clicks: 1 });
      expect((await service.getDaily(1, 'spam.example'))[0]).toMatchObject({ cache: 0, views: 0 });

      expect(await service.getTopProducts(7, 10, 'blog.example')).toEqual([
        expect.objectContaining({ value: 'B000000001', impressions: 2, clicks: 1, ctr: 0.5 }),
        expect.objectContaining({ value: 'B000000003', impressions: 1, clicks: 0 }),
      ]);
      expect(await service.countProducts(7, 'blog.example')).toBe(2);
      expect(await service.countProducts(7)).toBe(4);

      expect((await service.getTopPages(7, 10, 'clicks', 'shop.example:8080')).map(page => page.url)).toEqual(['https://shop.example:8080/b']);
      expect((await service.getNotFound(10, 'blog.example')).map(product => product.value)).toEqual(['B00GONE001']);
      expect((await service.getNotFound(10)).map(product => product.value).sort()).toEqual(['B00GONE001', 'B00GONE002']);
      expect(await service.getNotFound(10, 'spam.example')).toEqual([]);
      expect(await redis.exists('amw:stats:site-hits:spam.example:2026-10-20')).toBe(0);
    });
  });

  describe('most clicked products of a site', () => {
    const ranked = () => new Stats(redis, () => now, ['blog.example']);

    test('ranks over the period, best first, the ASIN breaking ties', async () => {
      const service = ranked();
      service.recordClick('B000000001', 'https://blog.example/a');
      service.recordClick('B000000003', 'https://blog.example/b?utm=1');
      service.recordClick('B000000002', 'https://blog.example/b');
      now = YESTERDAY;
      service.recordClick('B000000002', 'https://blog.example/c');
      now = NOW;
      await flush();

      expect(await service.getMostClickedProducts('blog.example', 7, 10)).toEqual(['B000000002', 'B000000001', 'B000000003']);
      expect(await service.getMostClickedProducts('blog.example', 7, 1)).toEqual(['B000000002']);
      // Today only
      expect(await service.getMostClickedProducts('blog.example', 1, 10)).toEqual(['B000000001', 'B000000002', 'B000000003']);
    });

    test('creates no key for a site outside the list, whatever the Referer says', async () => {
      const service = ranked();
      service.recordClick('B000000001', 'https://spam.example/a');
      service.recordClick('B000000001', 'https://blog.example:6379/a');
      service.recordClick('B000000001');
      await flush();

      expect(await redis.zcard('amw:stats:site-clicks:spam.example:2026-10-20')).toBe(0);
      expect(await service.getMostClickedProducts('spam.example', 7, 10)).toEqual([]);
      expect(await service.getMostClickedProducts('blog.example', 7, 10)).toEqual([]);
    });

    test('bounds the daily set and sets its TTL', async () => {
      const service = ranked();
      for (let i = 0; i < 1005; i++) service.recordClick(`B${String(i).padStart(9, '0')}`, 'https://blog.example/a');
      await flush();

      const key = 'amw:stats:site-clicks:blog.example:2026-10-20';
      expect(await redis.zcard(key)).toBe(1000);
      expect(await redis.ttl(key)).toBeGreaterThan(90 * 24 * 3600);
    });
  });

  test('caps the requested period to the retention', async () => {
    expect(await stats.getDaily(1000)).toHaveLength(Stats.RETENTION_DAYS);
  });

  test('sets a 90-day TTL on daily keys', async () => {
    stats.recordViews(['B000000001']);
    stats.recordClick('B000000001');
    await flush();

    for (const key of ['amw:stats:hits:2026-10-20', 'amw:stats:impressions:2026-10-20', 'amw:stats:clicks:2026-10-20']) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(90 * 24 * 3600);
      expect(ttl).toBeLessThanOrEqual(91 * 24 * 3600);
    }
  });

  test('ranks products by impressions with clicks, CTR and cached details', async () => {
    await redis.set('amw:product:id:B000000001', JSON.stringify({ title: 'Arduino', image: 'https://img/1.jpg', url: 'https://amazon/1', timestamp: Date.parse('2026-10-20T08:00:00Z') }));
    for (let i = 0; i < 4; i++) stats.recordViews(['B000000001']);
    stats.recordViews(['B000000002']);
    await redis.zincrby('amw:stats:impressions:2026-10-20', 1, 'keyword:raspberry pi'); // Recorded before the view beacon
    stats.recordClick('B000000001');
    now = YESTERDAY;
    stats.recordViews(['B000000002']);
    stats.recordViews(['B000000002']);
    now = NOW;
    await flush();

    const top = await stats.getTopProducts(2, 10);
    expect(top[0]).toEqual({
      product: 'id:B000000001', type: 'id', value: 'B000000001',
      title: 'Arduino', image: 'https://img/1.jpg', url: 'https://amazon/1', fetchedAt: '2026-10-20T08:00:00.000Z',
      impressions: 4, clicks: 1, ctr: 0.25
    });
    expect(top[1]).toMatchObject({ value: 'B000000002', impressions: 3, clicks: 0, ctr: 0 });
    expect(top[1]).not.toHaveProperty('fetchedAt');
    expect(top[2]).toMatchObject({ type: 'keyword', value: 'raspberry pi', impressions: 1 });

    expect(await stats.getTopProducts(1, 1)).toHaveLength(1);
  });

  test('counts the distinct products shown over the period', async () => {
    expect(await stats.countProducts(7)).toBe(0);
    stats.recordViews(['B000000001', 'B000000001', 'B000000002']);
    now = YESTERDAY;
    stats.recordViews(['B000000002', 'B000000003']);
    now = NOW;
    await flush();

    expect(await stats.countProducts(1)).toBe(2);
    expect(await stats.countProducts(2)).toBe(3);
  });

  test('sorts the products by impressions, clicks or click-through rate before the limit', async () => {
    for (let i = 0; i < 10; i++) stats.recordViews(['B000000001']);
    for (let i = 0; i < 4; i++) stats.recordViews(['B000000002']);
    for (let i = 0; i < 2; i++) stats.recordViews(['B000000003']);
    stats.recordViews(['B000000004']);
    stats.recordClick('B000000001');
    stats.recordClick('B000000002');
    stats.recordClick('B000000002');
    stats.recordClick('B000000003');
    stats.recordClick('B000000004');
    await flush();

    const order = async (sort?: 'impressions' | 'clicks' | 'ctr', limit = 10) =>
      (await stats.getTopProducts(1, limit, undefined, sort)).map(product => product.value);
    expect(await order()).toEqual(['B000000001', 'B000000002', 'B000000003', 'B000000004']);
    // Ties on clicks fall back to impressions
    expect(await order('clicks')).toEqual(['B000000002', 'B000000001', 'B000000003', 'B000000004']);
    // Ties on CTR (100 %, 50 %) fall back to clicks then impressions
    expect(await order('ctr')).toEqual(['B000000004', 'B000000002', 'B000000003', 'B000000001']);
    // The limit applies after sorting: the best CTR, not the best CTR of the most displayed
    expect(await order('ctr', 1)).toEqual(['B000000004']);
  });

  test('tracks products not found with their referer pages, without query strings', async () => {
    stats.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/post?utm=1#top');
    stats.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/post');
    stats.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/other');
    stats.recordProduct('notfound', 'id', 'B00GONE002', 'javascript:alert(1)');
    await flush();

    expect(await stats.getNotFound(10)).toEqual([
      {
        product: 'id:B00GONE001', type: 'id', value: 'B00GONE001', count: 3,
        firstSeen: NOW.toISOString(), lastSeen: NOW.toISOString(),
        referers: [
          { url: 'https://blog.example/post', count: 2 },
          { url: 'https://blog.example/other', count: 1 }
        ]
      },
      {
        product: 'id:B00GONE002', type: 'id', value: 'B00GONE002', count: 1,
        firstSeen: NOW.toISOString(), lastSeen: NOW.toISOString(), referers: []
      }
    ]);
  });

  test('ranks pages by clicks then impressions, aggregated across days, without query strings', async () => {
    stats.recordViews(['B000000001'], 'https://blog.example/a?utm=1#top');
    stats.recordViews(['B000000002'], 'https://blog.example/a');
    stats.recordViews(['B000000003'], 'https://blog.example/b');
    stats.recordViews(['B000000001'], 'https://blog.example/b');
    stats.recordViews(['B000000001'], 'https://blog.example/b');
    stats.recordViews(['B000000001']);
    stats.recordViews(['B000000001'], 'javascript:alert(1)');
    // Missing products were not displayed: they are no impression for the page
    stats.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/b');
    stats.recordClick('B000000001', 'https://blog.example/a?session=secret');
    stats.recordClick('B000000001', 'https://blog.example/c');
    stats.recordClick('B000000001');
    now = YESTERDAY;
    stats.recordViews(['B000000002'], 'https://blog.example/a');
    stats.recordClick('B000000002', 'https://blog.example/a');
    now = NOW;
    await flush();

    expect(await stats.getTopPages(2, 10)).toEqual([
      { url: 'https://blog.example/a', impressions: 3, clicks: 2, ctr: 2 / 3 },
      { url: 'https://blog.example/c', impressions: 0, clicks: 1, ctr: 0 },
      { url: 'https://blog.example/b', impressions: 3, clicks: 0, ctr: 0 }
    ]);
    expect(await stats.getTopPages(1, 10)).toEqual([
      { url: 'https://blog.example/a', impressions: 2, clicks: 1, ctr: 0.5 },
      { url: 'https://blog.example/c', impressions: 0, clicks: 1, ctr: 0 },
      { url: 'https://blog.example/b', impressions: 3, clicks: 0, ctr: 0 }
    ]);
    expect(await stats.getTopPages(2, 1)).toHaveLength(1);
    expect((await stats.getTopPages(2, 10, 'impressions')).map(page => page.url)).toEqual([
      'https://blog.example/a', 'https://blog.example/b', 'https://blog.example/c'
    ]);
    // Equal CTR: the page with more clicks first
    expect((await stats.getTopPages(2, 10, 'ctr')).map(page => page.url)).toEqual([
      'https://blog.example/a', 'https://blog.example/c', 'https://blog.example/b'
    ]);
    // The limit applies after sorting: the most viewed page, not the most clicked one
    expect((await stats.getTopPages(1, 1, 'impressions')).map(page => page.url)).toEqual(['https://blog.example/b']);
  });

  test('bounds the daily page sets and sets their TTL', async () => {
    for (let i = 0; i < 1005; i++) {
      stats.recordViews(['B000000001'], `https://spam.example/${i}`);
    }
    stats.recordClick('B000000001', 'https://blog.example/a');
    await flush();

    expect(await redis.zcard('amw:stats:pages:impressions:2026-10-20')).toBe(1000);
    for (const key of ['amw:stats:pages:impressions:2026-10-20', 'amw:stats:pages:clicks:2026-10-20']) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(90 * 24 * 3600);
      expect(ttl).toBeLessThanOrEqual(91 * 24 * 3600);
    }
  });

  test('filters the pages by domain and aggregates them by domain', async () => {
    stats.recordViews(['B000000001'], 'https://blog.example/a');
    stats.recordViews(['B000000001'], 'https://blog.example/b');
    stats.recordClick('B000000001', 'https://blog.example/a');
    for (let i = 0; i < 3; i++) stats.recordViews(['B000000001'], 'https://other.example/x');
    stats.recordClick('B000000001', 'https://shop.example/y');
    await flush();

    expect((await stats.getTopPages(7, 10, 'clicks', 'blog.example')).map(page => page.url)).toEqual([
      'https://blog.example/a', 'https://blog.example/b'
    ]);
    // The limit applies within the domain
    expect((await stats.getTopPages(7, 1, 'clicks', 'other.example')).map(page => page.url)).toEqual(['https://other.example/x']);
    expect(await stats.getTopPages(7, 10, 'clicks', 'unknown.example')).toEqual([]);
    expect(await stats.getDomains(7)).toEqual([
      { domain: 'other.example', impressions: 3, clicks: 0, ctr: 0 },
      { domain: 'blog.example', impressions: 2, clicks: 1, ctr: 0.5 },
      { domain: 'shop.example', impressions: 0, clicks: 1, ctr: 0 }
    ]);
  });

  test('gives the daily trend of the most viewed sites', async () => {
    now = YESTERDAY;
    stats.recordViews(['B000000001'], 'https://blog.example/a');
    stats.recordViews(['B000000001'], 'https://blog.example/b');
    stats.recordClick('B000000001', 'https://blog.example/a');
    now = NOW;
    for (let i = 0; i < 4; i++) stats.recordViews(['B000000001'], 'https://blog.example/a');
    stats.recordViews(['B000000001'], 'https://other.example/x');
    stats.recordClick('B000000001', 'https://shop.example/y');
    await flush();

    const [blog, ...others] = await stats.getDomainTrends(2, 2);
    expect(blog).toEqual({
      domain: 'blog.example', impressions: 6, clicks: 1, ctr: 1 / 6,
      daily: [
        { date: '2026-10-19', impressions: 2, clicks: 1, ctr: 0.5 },
        { date: '2026-10-20', impressions: 4, clicks: 0, ctr: 0 }
      ]
    });
    // No views on a day: no CTR rather than 0 %
    expect(others).toEqual([{
      domain: 'other.example', impressions: 1, clicks: 0, ctr: 0,
      daily: [
        { date: '2026-10-19', impressions: 0, clicks: 0, ctr: null },
        { date: '2026-10-20', impressions: 1, clicks: 0, ctr: 0 }
      ]
    }]);
  });

  test('has no page statistics without referers', async () => {
    stats.recordViews(['B000000001']);
    stats.recordClick('B000000001');
    await flush();
    expect(await stats.getTopPages(7, 10)).toEqual([]);
  });

  test('forgets a missing product once Amazon returns it again', async () => {
    stats.recordProduct('notfound', 'id', 'B00BACK001', 'https://blog.example/post');
    await flush();
    stats.recordProduct('amazon', 'id', 'B00BACK001');
    await flush();

    expect(await stats.getNotFound(10)).toEqual([]);
    expect(await redis.exists('amw:stats:notfound:referers:id:B00BACK001')).toBe(0);
    expect(await redis.zscore('amw:stats:notfound:firstseen', 'id:B00BACK001')).toBeNull();
  });

  test('keeps the start of the absence of a missing product', async () => {
    stats.recordProduct('notfound', 'id', 'B00GONE001');
    await flush();
    now = new Date(NOW.getTime() + 5 * 3600 * 1000);
    stats.recordProduct('notfound', 'id', 'B00GONE001');
    await flush();

    const [missing] = await stats.getNotFound(10);
    expect(missing).toMatchObject({ count: 2, firstSeen: NOW.toISOString(), lastSeen: now.toISOString() });
    const ttl = await redis.ttl('amw:stats:notfound:firstseen');
    expect(ttl).toBeGreaterThan(90 * 24 * 3600);
  });

  test('counts the visits reported with the first views, per site too', async () => {
    const ranked = new Stats(redis, () => now, ['blog.example']);
    ranked.recordViews(['B000000001', 'B000000002'], 'https://blog.example/a', undefined, undefined, undefined, true);
    ranked.recordViews(['B000000003'], 'https://blog.example/a');
    ranked.recordViews(['B000000001'], 'https://blog.example/b', undefined, undefined, undefined, true);
    await flush();

    const [today] = (await ranked.getDaily(1));
    expect(today).toMatchObject({ views: 4, visits: 2 });
    expect((await ranked.getDaily(1, 'blog.example'))[0]).toMatchObject({ views: 4, visits: 2 });
    // Days before visits were counted say so
    expect((await ranked.getDaily(3))[0].visits).toBeNull();
  });

  test('keeps the missing products still requested during the period', async () => {
    stats.recordProduct('notfound', 'id', 'B00OLD0001');
    await flush();
    now = new Date(NOW.getTime() + 10 * 24 * 3600 * 1000);
    stats.recordProduct('notfound', 'id', 'B00GONE001');
    await flush();

    const values = async (period?: number | { from: string; to: string }) => (await stats.getNotFound(10, undefined, period)).map(product => product.value);
    expect(await values(7)).toEqual(['B00GONE001']);
    expect((await values(30)).sort()).toEqual(['B00GONE001', 'B00OLD0001']);
    const day = NOW.toISOString().slice(0, 10);
    expect(await values({ from: day, to: day })).toEqual(['B00OLD0001']);
    // Without a period, every one
    expect((await values()).sort()).toEqual(['B00GONE001', 'B00OLD0001']);
  });

  test('bounds the not-found set', async () => {
    for (let i = 0; i < 510; i++) {
      stats.recordProduct('notfound', 'id', `X${i}`);
    }
    await flush();
    expect(await redis.zcard('amw:stats:notfound')).toBeLessThanOrEqual(500);
    // Only the products still counted keep their first failed lookup
    expect(await redis.zcard('amw:stats:notfound:firstseen')).toBe(await redis.zcard('amw:stats:notfound'));
  });

  test('never rejects when Redis fails', async () => {
    jest.spyOn(redis, 'multi').mockImplementation(() => {
      const chain: any = new Proxy({}, {
        get: (_target, prop) => prop === 'exec' ? () => Promise.reject(new Error('boom')) : () => chain
      });
      return chain;
    });
    stats.recordViews(['B000000001']);
    stats.recordClick('B000000001');
    await flush();
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  test('falls back to one day for an invalid period', async () => {
    expect(await stats.getDaily(0)).toHaveLength(1);
    expect(await stats.getDaily(Number.NaN)).toHaveLength(1);
  });

  test('returns no product when nothing was displayed', async () => {
    const mget = jest.spyOn(redis, 'mget');
    expect(await stats.getTopProducts(7, 10)).toEqual([]);
    expect(mget).not.toHaveBeenCalled();
  });

  test('ignores a corrupted cache entry', async () => {
    await redis.set('amw:product:id:B000000001', '{not json');
    stats.recordViews(['B000000001']);
    await flush();
    const [product] = await stats.getTopProducts(1, 10);
    expect(product.title).toBeUndefined();
    expect(product.impressions).toBe(1);
  });

  test('reports an unknown last seen date', async () => {
    stats.recordProduct('notfound', 'keyword', 'old thing');
    await flush();
    await redis.del('amw:stats:notfound:lastseen');
    const [missing] = await stats.getNotFound(10);
    expect(missing).toMatchObject({ type: 'keyword', value: 'old thing', lastSeen: null });
  });

  test('rejects reads when a Redis command fails', async () => {
    jest.spyOn(redis, 'pipeline').mockReturnValue({
      hgetall: jest.fn(),
      get: jest.fn(),
      exec: () => Promise.resolve([[new Error('WRONGTYPE'), null]])
    } as any);
    await expect(stats.getDaily(1)).rejects.toThrow('WRONGTYPE');
  });

  test('treats an empty pipeline result as no data', async () => {
    jest.spyOn(redis, 'pipeline').mockReturnValue({ hgetall: jest.fn(), get: jest.fn(), exec: () => Promise.resolve(null) } as any);
    expect(await stats.getDaily(1)).toEqual([expect.objectContaining({ cache: 0 })]);
  });

  test('never throws when building the transaction fails', () => {
    jest.spyOn(redis, 'multi').mockImplementation(() => { throw new Error('broken client'); });
    expect(() => stats.recordProduct('cache', 'id', 'B000000001')).not.toThrow();
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('broken client'));
  });

  test('accepts RESP3 [member, score] pairs as well as flat replies', async () => {
    jest.spyOn(redis, 'zrevrange').mockResolvedValue([['id:B00GONE001', 2]] as any);
    jest.spyOn(redis, 'pipeline').mockReturnValue({
      zscore: jest.fn(),
      zrevrange: jest.fn(),
      hget: jest.fn(),
      get: jest.fn(),
      exec: () => Promise.resolve([[null, NOW.getTime()], [null, null], [null, [['https://blog.example/post', 2]]], [null, null], [null, null]])
    } as any);

    expect(await stats.getNotFound(10)).toEqual([{
      product: 'id:B00GONE001', type: 'id', value: 'B00GONE001', count: 2,
      firstSeen: null, lastSeen: NOW.toISOString(), referers: [{ url: 'https://blog.example/post', count: 2 }]
    }]);
  });

  test('cleanReferer keeps only http(s) page URLs', () => {
    expect(Stats.cleanReferer('https://a.example/p/q?x=1#y')).toBe('https://a.example/p/q');
    expect(Stats.cleanReferer('ftp://a.example/')).toBeNull();
    expect(Stats.cleanReferer('not a url')).toBeNull();
    expect(Stats.cleanReferer(undefined)).toBeNull();
  });
});

describe('POST /click', () => {
  let app: express.Application;
  let stats: Stats;

  beforeEach(() => {
    stats = new Stats(undefined);
    jest.spyOn(stats, 'recordClick');
    app = express();
    app.post('/amw/click', createClickHandler(stats));
  });

  test('records a valid ASIN and answers 204 without cookies or caching', async () => {
    const res = await request(app).post('/amw/click?id=B084DN3XVN');
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(stats.recordClick).toHaveBeenCalledWith('B084DN3XVN', undefined, undefined, undefined, undefined);
  });

  test('passes the page URL carried by the beacon Referer', async () => {
    const res = await request(app).post('/amw/click?id=B084DN3XVN').set('Referer', 'https://blog.example/post?x=1');
    expect(res.status).toBe(204);
    expect(stats.recordClick).toHaveBeenCalledWith('B084DN3XVN', 'https://blog.example/post?x=1', undefined, undefined, undefined);
  });

  test.each([
    ['missing', ''],
    ['lowercase', '?id=b084dn3xvn'],
    ['too short', '?id=B084DN3XV'],
    ['injection', '?id=B084DN3XV%3C'],
    ['array', '?id=B084DN3XVN&id=B084DN3XVN']
  ])('rejects an invalid id (%s)', async (_name, query) => {
    const res = await request(app).post(`/amw/click${query}`);
    expect(res.status).toBe(400);
    expect(stats.recordClick).not.toHaveBeenCalled();
  });
});

describe('Stats Claude API usage', () => {
  const flush = () => new Promise(resolve => setImmediate(resolve));

  test('adds up the tokens per feature and model and estimates the cost, most expensive first', async () => {
    let now = new Date('2026-11-01T12:00:00Z');
    const stats = new Stats(createFakeRedis(), () => now);
    stats.recordLlmUsage('recommendation', 'claude-haiku-5-5', { input_tokens: 1000, output_tokens: 200 });
    stats.recordLlmUsage('recommendation', 'claude-haiku-5-5', { input_tokens: 1000, output_tokens: 200 });
    stats.recordLlmUsage('insights', 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 });
    await flush();
    now = new Date('2026-11-02T12:00:00Z');
    stats.recordLlmUsage('insights', 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 });
    await flush();

    const usage = await stats.getLlmUsage(30);

    expect(usage).toEqual([
      { feature: 'insights', model: 'claude-opus-5-5', calls: 2, inputTokens: 2_000_000, outputTokens: 200_000, estimatedCost: 12 },
      { feature: 'recommendation', model: 'claude-haiku-5-5', calls: 2, inputTokens: 2000, outputTokens: 400, estimatedCost: 0.0004 },
    ]);
  });

  test('gives no price for an unknown model, and only reads the period', async () => {
    let now = new Date('2026-11-01T12:00:00Z');
    const stats = new Stats(createFakeRedis(), () => now);
    stats.recordLlmUsage('insights', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 10 });
    await flush();
    now = new Date('2026-11-10T12:00:00Z');
    stats.recordLlmUsage('insights', 'claude-future-9', { input_tokens: 10, output_tokens: 20 });
    await flush();

    expect(await stats.getLlmUsage(7)).toEqual([
      { feature: 'insights', model: 'claude-future-9', calls: 1, inputTokens: 10, outputTokens: 20, estimatedCost: null },
    ]);
  });

  test('does not treat a property of Object as a model with a price', async () => {
    const stats = new Stats(createFakeRedis());
    stats.recordLlmUsage('insights', 'constructor', { input_tokens: 10, output_tokens: 20 });
    await flush();

    expect((await stats.getLlmUsage(1))[0].estimatedCost).toBeNull();
  });

  test('records nothing and never throws without Redis', () => {
    expect(() => new Stats().recordLlmUsage('insights', 'claude-opus-5-5', { input_tokens: 1, output_tokens: 1 })).not.toThrow();
  });
});

// The totals of each group, without the figures per day
const totals = <T extends { daily: unknown }>(rows: T[]) => rows.map(({ daily: _daily, ...rest }) => rest);

describe('Stats appearance effects', () => {
  const flush = () => new Promise(resolve => setImmediate(resolve));

  it('adds up views and clicks per effect, the control group first', async () => {
    let now = new Date('2026-11-01T12:00:00Z');
    const stats = new Stats(createFakeRedis(), () => now);
    stats.recordViews(['B000000001', 'B000000002'], undefined, 'fade');
    stats.recordViews(['B000000001'], undefined, 'none');
    await flush();
    now = new Date('2026-11-02T12:00:00Z');
    stats.recordViews(['B000000001'], undefined, 'fade');
    stats.recordClick('B000000001', undefined, 'fade');
    await flush();

    expect(totals(await stats.getEffects(7))).toEqual([
      { effect: 'none', views: 1, clicks: 0, ctr: 0 },
      { effect: 'fade', views: 3, clicks: 1, ctr: 1 / 3 },
    ]);
  });

  it('gives the figures of each day, oldest first, a day without views having no rate', async () => {
    let now = new Date('2026-11-01T12:00:00Z');
    const stats = new Stats(createFakeRedis(), () => now);
    stats.recordViews(['B000000001', 'B000000002'], undefined, 'fade');
    stats.recordClick('B000000001', undefined, 'fade');
    await flush();
    now = new Date('2026-11-03T12:00:00Z');
    stats.recordViews(['B000000001'], undefined, 'none');
    await flush();

    const [none, fade] = await stats.getEffects(3);
    expect(fade.daily).toEqual([
      { date: '2026-11-01', views: 2, clicks: 1, ctr: 0.5 },
      { date: '2026-11-02', views: 0, clicks: 0, ctr: null },
      { date: '2026-11-03', views: 0, clicks: 0, ctr: null },
    ]);
    expect(none.daily.map(day => day.views)).toEqual([0, 0, 1]);
  });

  it('counts nothing per effect without one, while the usual counters go on', async () => {
    const stats = new Stats(createFakeRedis());
    stats.recordViews(['B000000001']);
    stats.recordClick('B000000001');
    await flush();

    expect(await stats.getEffects(7)).toEqual([]);
    expect((await stats.getDaily(1))[0]).toMatchObject({ views: 1, clicks: 1 });
  });
});

describe('Stats theme test', () => {
  it('adds up views and clicks per theme, apart from the effects', async () => {
    const stats = new Stats(createFakeRedis());
    stats.recordViews(['B000000001', 'B000000002'], undefined, undefined, 'neon');
    stats.recordViews(['B000000001'], undefined, 'fade', 'shelf');
    stats.recordClick('B000000001', undefined, undefined, 'neon');
    await new Promise(resolve => setImmediate(resolve));

    expect(totals(await stats.getThemes(7))).toEqual([
      { theme: 'shelf', views: 1, clicks: 0, ctr: 0 },
      { theme: 'neon', views: 2, clicks: 1, ctr: 0.5 },
    ]);
    expect(totals(await stats.getEffects(7))).toEqual([{ effect: 'fade', views: 1, clicks: 0, ctr: 0 }]);
  });
});

describe('effect of the beacons', () => {
  async function post(url: string): Promise<Stats> {
    const stats = new Stats(createFakeRedis());
    const app = express();
    app.post('/click', createClickHandler(stats));
    app.post('/view', createViewHandler(stats));
    expect((await request(app).post(url)).status).toBe(204);
    await new Promise(resolve => setImmediate(resolve));
    return stats;
  }

  it('records a known effect', async () => {
    expect((await (await post('/view?ids=B000000001&effect=zoom')).getEffects(1))[0]).toMatchObject({ effect: 'zoom', views: 1 });
    expect((await (await post('/click?id=B000000001&effect=zoom')).getEffects(1))[0]).toMatchObject({ effect: 'zoom', clicks: 1 });
  });

  it('records a known theme, and ignores another', async () => {
    expect((await (await post('/view?ids=B000000001&theme=neon')).getThemes(1))[0]).toMatchObject({ theme: 'neon', views: 1 });
    expect((await (await post('/click?id=B000000001&theme=neon')).getThemes(1))[0]).toMatchObject({ theme: 'neon', clicks: 1 });
    expect(await (await post('/view?ids=B000000001&theme=neon%7Cviews')).getThemes(1)).toEqual([]);
  });

  it.each(['nope', '__proto__', 'fade|views'])('ignores the effect %s, and still counts the view', async effect => {
    const stats = await post(`/view?ids=B000000001&effect=${encodeURIComponent(effect)}`);
    expect(await stats.getEffects(1)).toEqual([]);
    expect((await stats.getDaily(1))[0].views).toBe(1);
  });
});

describe('Stats titles of the products to replace', () => {
  const flush = () => new Promise(resolve => setImmediate(resolve));

  it('gives the title Amazon returned before the product went missing', async () => {
    const stats = new Stats(createFakeRedis());
    stats.rememberTitle('id', 'B084DN3XVN', 'Arduino Uno R3');
    await flush();
    stats.recordProduct('notfound', 'id', 'B084DN3XVN');
    await flush();

    expect((await stats.getNotFound(10))[0].title).toBe('Arduino Uno R3');
  });

  it('falls back on the product cache, and on nothing', async () => {
    const redis = createFakeRedis();
    await redis.set('amw:product:id:B000000001', JSON.stringify({ title: 'From the cache' }));
    const stats = new Stats(redis);
    stats.recordProduct('notfound', 'id', 'B000000001');
    stats.recordProduct('notfound', 'id', 'B000000002');
    await flush();

    const titles = Object.fromEntries((await stats.getNotFound(10)).map(product => [product.value, product.title]));
    expect(titles).toEqual({ B000000001: 'From the cache', B000000002: undefined });
  });

  it('never throws without Redis', () => {
    expect(() => new Stats().rememberTitle('id', 'B084DN3XVN', 't')).not.toThrow();
  });
});
