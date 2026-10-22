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

import { Stats, createClickHandler } from '../src/server/Stats';

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
      { date: '2026-10-18', cache: 0, amazon: 0, notfound: 0, clicks: 0 },
      { date: '2026-10-19', cache: 0, amazon: 1, notfound: 0, clicks: 0 },
      { date: '2026-10-20', cache: 2, amazon: 1, notfound: 1, clicks: 1 }
    ]);
  });

  test('caps the requested period to the retention', async () => {
    expect(await stats.getDaily(1000)).toHaveLength(Stats.RETENTION_DAYS);
  });

  test('sets a 90-day TTL on daily keys', async () => {
    stats.recordProduct('cache', 'id', 'B000000001');
    stats.recordClick('B000000001');
    await flush();

    for (const key of ['amw:stats:hits:2026-10-20', 'amw:stats:impressions:2026-10-20', 'amw:stats:clicks:2026-10-20']) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(90 * 24 * 3600);
      expect(ttl).toBeLessThanOrEqual(91 * 24 * 3600);
    }
  });

  test('ranks products by impressions with clicks, CTR and cached details', async () => {
    await redis.set('amw:product:id:B000000001', JSON.stringify({ title: 'Arduino', image: 'https://img/1.jpg', url: 'https://amazon/1' }));
    for (let i = 0; i < 4; i++) stats.recordProduct('cache', 'id', 'B000000001');
    stats.recordProduct('amazon', 'id', 'B000000002');
    stats.recordProduct('cache', 'keyword', 'raspberry pi');
    stats.recordClick('B000000001');
    now = YESTERDAY;
    stats.recordProduct('cache', 'id', 'B000000002');
    stats.recordProduct('cache', 'id', 'B000000002');
    now = NOW;
    await flush();

    const top = await stats.getTopProducts(2, 10);
    expect(top[0]).toEqual({
      product: 'id:B000000001', type: 'id', value: 'B000000001',
      title: 'Arduino', image: 'https://img/1.jpg', url: 'https://amazon/1',
      impressions: 4, clicks: 1, ctr: 0.25
    });
    expect(top[1]).toMatchObject({ value: 'B000000002', impressions: 3, clicks: 0, ctr: 0 });
    expect(top[2]).toMatchObject({ type: 'keyword', value: 'raspberry pi', impressions: 1 });

    expect(await stats.getTopProducts(1, 1)).toHaveLength(1);
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
        lastSeen: NOW.toISOString(),
        referers: [
          { url: 'https://blog.example/post', count: 2 },
          { url: 'https://blog.example/other', count: 1 }
        ]
      },
      {
        product: 'id:B00GONE002', type: 'id', value: 'B00GONE002', count: 1,
        lastSeen: NOW.toISOString(), referers: []
      }
    ]);
  });

  test('ranks pages by clicks then impressions, aggregated across days, without query strings', async () => {
    stats.recordProduct('cache', 'id', 'B000000001', 'https://blog.example/a?utm=1#top');
    stats.recordProduct('amazon', 'id', 'B000000002', 'https://blog.example/a');
    stats.recordProduct('cache', 'keyword', 'arduino', 'https://blog.example/b');
    stats.recordProduct('cache', 'id', 'B000000001', 'https://blog.example/b');
    stats.recordProduct('cache', 'id', 'B000000001', 'https://blog.example/b');
    stats.recordProduct('cache', 'id', 'B000000001');
    stats.recordProduct('cache', 'id', 'B000000001', 'javascript:alert(1)');
    // Missing products were not displayed: they are no impression for the page
    stats.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/b');
    stats.recordClick('B000000001', 'https://blog.example/a?session=secret');
    stats.recordClick('B000000001', 'https://blog.example/c');
    stats.recordClick('B000000001');
    now = YESTERDAY;
    stats.recordProduct('cache', 'id', 'B000000002', 'https://blog.example/a');
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
  });

  test('bounds the daily page sets and sets their TTL', async () => {
    for (let i = 0; i < 1005; i++) {
      stats.recordProduct('cache', 'id', 'B000000001', `https://spam.example/${i}`);
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

  test('has no page statistics without referers', async () => {
    stats.recordProduct('cache', 'id', 'B000000001');
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
  });

  test('bounds the not-found set', async () => {
    for (let i = 0; i < 510; i++) {
      stats.recordProduct('notfound', 'id', `X${i}`);
    }
    await flush();
    expect(await redis.zcard('amw:stats:notfound')).toBeLessThanOrEqual(500);
  });

  test('never rejects when Redis fails', async () => {
    jest.spyOn(redis, 'multi').mockImplementation(() => {
      const chain: any = new Proxy({}, {
        get: (_target, prop) => prop === 'exec' ? () => Promise.reject(new Error('boom')) : () => chain
      });
      return chain;
    });
    stats.recordProduct('cache', 'id', 'B000000001');
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
    stats.recordProduct('cache', 'id', 'B000000001');
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
      exec: () => Promise.resolve([[new Error('WRONGTYPE'), null]])
    } as any);
    await expect(stats.getDaily(1)).rejects.toThrow('WRONGTYPE');
  });

  test('treats an empty pipeline result as no data', async () => {
    jest.spyOn(redis, 'pipeline').mockReturnValue({ hgetall: jest.fn(), exec: () => Promise.resolve(null) } as any);
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
      exec: () => Promise.resolve([[null, NOW.getTime()], [null, [['https://blog.example/post', 2]]]])
    } as any);

    expect(await stats.getNotFound(10)).toEqual([{
      product: 'id:B00GONE001', type: 'id', value: 'B00GONE001', count: 2,
      lastSeen: NOW.toISOString(), referers: [{ url: 'https://blog.example/post', count: 2 }]
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
    expect(stats.recordClick).toHaveBeenCalledWith('B084DN3XVN', undefined);
  });

  test('passes the page URL carried by the beacon Referer', async () => {
    const res = await request(app).post('/amw/click?id=B084DN3XVN').set('Referer', 'https://blog.example/post?x=1');
    expect(res.status).toBe(204);
    expect(stats.recordClick).toHaveBeenCalledWith('B084DN3XVN', 'https://blog.example/post?x=1');
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
