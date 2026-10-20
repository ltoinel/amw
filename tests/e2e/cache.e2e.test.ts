/**
 * End-to-end tests of the Redis product cache, run only when REDIS_HOST
 * (and optionally REDIS_PORT) designates a Redis instance.
 */

import { randomUUID } from 'crypto';
import { AmwServer, Json, isRedisReachable, startAmwServer } from './support/amwServer';
import { ASIN_NOT_FOUND, MockAmazonApi, startMockAmazonApi } from './support/mockAmazonApi';

// Skipping on a missing REDIS_HOST (rather than on an unreachable Redis) keeps
// a misconfigured CI Redis service from silently disabling these tests.
const describeWithRedis = process.env.REDIS_HOST ? describe : describe.skip;

describeWithRedis('AMW Redis cache (e2e)', () => {
  let mock: MockAmazonApi;
  let amw: AmwServer;

  // Unique per run so entries left in Redis by a previous run cannot fake a cache hit
  const runId = randomUUID().slice(0, 8).toUpperCase();

  beforeAll(async () => {
    if (!(await isRedisReachable())) {
      throw new Error(`REDIS_HOST is set but Redis is not reachable at ${process.env.REDIS_HOST}`);
    }
    mock = await startMockAmazonApi();
    amw = await startAmwServer({
      mockApiUrl: mock.url,
      config: {
        Redis: {
          enabled: true,
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT) || 6379,
          expire: 60
        }
      }
    });
  });

  afterAll(async () => {
    await amw?.stop();
    await mock?.close();
  });

  it('reports Redis as connected in /health', async () => {
    const body = await (await fetch(`${amw.baseUrl}/health`)).json() as Json;

    expect(body.redis).toBe('connected');
  });

  it('serves the second request by id from the cache', async () => {
    const id = `B0${runId}`;

    const first = await (await fetch(`${amw.baseUrl}/product?id=${id}`)).json() as Json;
    const second = await (await fetch(`${amw.baseUrl}/product?id=${id}`)).json() as Json;

    expect(mock.calls.getItems.filter(call => call === id)).toHaveLength(1);
    // An identical timestamp proves the stored document was returned, not a rebuilt one
    expect(second).toEqual(first);
  });

  it('serves the second request by keyword from the cache', async () => {
    const keyword = `cache ${runId}`;
    const url = `${amw.baseUrl}/product?keyword=${encodeURIComponent(keyword)}`;

    await fetch(url);
    const second = await fetch(url);

    expect(second.status).toBe(200);
    expect(mock.calls.searchItems.filter(call => call === keyword)).toHaveLength(1);
  });

  it('does not cache "not found" answers', async () => {
    await fetch(`${amw.baseUrl}/product?id=${ASIN_NOT_FOUND}`);
    await fetch(`${amw.baseUrl}/product?id=${ASIN_NOT_FOUND}`);

    expect(mock.calls.getItems.filter(call => call === ASIN_NOT_FOUND)).toHaveLength(2);
  });
});
