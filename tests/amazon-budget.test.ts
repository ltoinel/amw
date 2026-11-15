/**
 * Unit tests for the ceiling on Amazon requests (src/server/AmazonBudget.ts), and how /product
 * answers once it is spent (#574).
 */

import type { Redis } from 'ioredis';
import { createFakeRedis } from './helpers/fakeRedis';

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

import { AmazonBudget } from '../src/server/AmazonBudget';
import { AmazonError } from '../src/server/AmazonError';

const HOUR = 3600;

describe('AmazonBudget', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never limits when disabled', async () => {
    const budget = new AmazonBudget(0, HOUR);
    expect(budget.enabled).toBe(false);
    for (let i = 0; i < 100; i++) {
      await budget.consume();
    }
  });

  it('refuses the requests past the limit until the window ends, with the seconds left', async () => {
    let now = 10 * HOUR * 1000;
    const budget = new AmazonBudget(2, HOUR, createFakeRedis() as unknown as Redis, () => now);

    await budget.consume();
    await budget.consume();
    now += 15 * 60 * 1000;
    const error = await budget.consume().catch(caught => caught);

    expect(error).toBeInstanceOf(AmazonError);
    expect(error).toMatchObject({ kind: 'unavailable', retryAfter: 45 * 60 });
    // Warned once per window, not once per refused request
    await expect(budget.consume()).rejects.toThrow(AmazonError);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);

    now += 45 * 60 * 1000;
    await expect(budget.consume()).resolves.toBeUndefined();
  });

  it('shares the count between the processes through Redis, with a key that expires', async () => {
    const redis = createFakeRedis() as unknown as Redis;
    const now = () => 0;
    const first = new AmazonBudget(2, HOUR, redis, now);
    const second = new AmazonBudget(2, HOUR, redis, now);

    await first.consume();
    await second.consume();

    await expect(first.consume()).rejects.toThrow('Amazon call budget spent');
    expect(await redis.ttl('amw:amazon-budget:0')).toBeGreaterThan(0);
  });

  it('counts in memory while Redis is down', async () => {
    const redis = createFakeRedis();
    redis.status = 'reconnecting';
    const incr = jest.spyOn(redis, 'incr');
    const budget = new AmazonBudget(1, HOUR, redis as unknown as Redis, () => 0);

    await budget.consume();
    await expect(budget.consume()).rejects.toThrow(AmazonError);
    expect(incr).not.toHaveBeenCalled();
  });

  it('counts in memory when a Redis command fails', async () => {
    const redis = createFakeRedis();
    jest.spyOn(redis, 'incr').mockRejectedValue(new Error('READONLY'));
    const budget = new AmazonBudget(1, HOUR, redis as unknown as Redis, () => 0);

    await budget.consume();
    await expect(budget.consume()).rejects.toThrow(AmazonError);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('counting in memory'), expect.any(Error));
  });
});
