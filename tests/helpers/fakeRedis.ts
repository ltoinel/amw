/**
 * In-memory stand-in for the subset of the ioredis client used by
 * src/server/Stats.ts (hashes, sorted sets, MULTI/pipelines).
 *
 * ioredis-mock does not support ioredis 6, and a real Redis is only available
 * to the end-to-end tests, so the unit tests use this fake instead.
 */

import type { Redis } from 'ioredis';

type Entry = Map<string, number> | Record<string, string> | string;
type Command = () => unknown;

export class FakeRedis {
  public status = 'ready';
  private readonly data = new Map<string, Entry>();
  private readonly expiries = new Map<string, number>();

  // Commands ------------------------------------------------------------------

  async get(key: string) { return this.getString(key); }
  async set(key: string, value: string) { this.data.set(key, value); return 'OK'; }
  async mget(...keys: string[]) { return keys.map(key => this.getString(key)); }
  async exists(key: string) { return this.data.has(key) ? 1 : 0; }
  async flushall() { this.data.clear(); this.expiries.clear(); return 'OK'; }
  async ttl(key: string) {
    if (!this.data.has(key)) return -2;
    const expiry = this.expiries.get(key);
    return expiry === undefined ? -1 : Math.round((expiry - Date.now()) / 1000);
  }
  async zcard(key: string) { return this.zset(key).size; }
  async zrevrange(key: string, start: number, stop: number, withScores?: 'WITHSCORES') {
    return this.range(key, start, stop, true, withScores === 'WITHSCORES');
  }
  async del(key: string) { return this.delete(key); }

  multi() { return new FakeChain(this); }
  pipeline() { return new FakeChain(this); }

  // Synchronous implementations shared with the chain ------------------------

  delete(key: string): number {
    this.expiries.delete(key);
    return this.data.delete(key) ? 1 : 0;
  }

  expire(key: string, seconds: number): number {
    if (!this.data.has(key)) return 0;
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  hincrby(key: string, field: string, increment: number): number {
    const hash = this.hash(key);
    const value = (Number(hash[field]) || 0) + increment;
    hash[field] = String(value);
    return value;
  }

  hgetall(key: string): Record<string, string> {
    const entry = this.data.get(key);
    return entry && typeof entry === 'object' && !(entry instanceof Map) ? { ...entry } : {};
  }

  zincrby(key: string, increment: number, member: string): string {
    const set = this.zset(key);
    const score = (set.get(member) || 0) + increment;
    set.set(member, score);
    return String(score);
  }

  zadd(key: string, score: number, member: string): number {
    const set = this.zset(key);
    const added = set.has(member) ? 0 : 1;
    set.set(member, score);
    return added;
  }

  zrem(key: string, member: string): number {
    const set = this.data.get(key);
    return set instanceof Map && set.delete(member) ? 1 : 0;
  }

  zscore(key: string, member: string): string | null {
    const set = this.data.get(key);
    return set instanceof Map && set.has(member) ? String(set.get(member)) : null;
  }

  zremrangebyrank(key: string, start: number, stop: number): number {
    const set = this.data.get(key);
    if (!(set instanceof Map)) return 0;
    const members = this.range(key, start, stop, false, false);
    members.forEach(member => set.delete(member));
    return members.length;
  }

  range(key: string, startIndex: number | string, stopIndex: number | string, reverse: boolean, withScores: boolean): string[] {
    const start = Number(startIndex);
    const stop = Number(stopIndex);
    const set = this.data.get(key);
    if (!(set instanceof Map)) return [];
    const sorted = [...set.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (reverse) sorted.reverse();
    const from = start < 0 ? Math.max(sorted.length + start, 0) : start;
    const to = stop < 0 ? sorted.length + stop : Math.min(stop, sorted.length - 1);
    const slice = from > to ? [] : sorted.slice(from, to + 1);
    return withScores ? slice.flatMap(([member, score]) => [member, String(score)]) : slice.map(([member]) => member);
  }

  // Helpers ----------------------------------------------------------------------

  private getString(key: string): string | null {
    const entry = this.data.get(key);
    return typeof entry === 'string' ? entry : null;
  }

  private hash(key: string): Record<string, string> {
    let entry = this.data.get(key);
    if (!entry || typeof entry !== 'object' || entry instanceof Map) {
      entry = {};
      this.data.set(key, entry);
    }
    return entry;
  }

  private zset(key: string): Map<string, number> {
    let entry = this.data.get(key);
    if (!(entry instanceof Map)) {
      entry = new Map();
      this.data.set(key, entry);
    }
    return entry;
  }
}

/**
 * Queues commands like an ioredis MULTI or pipeline and runs them on exec().
 */
class FakeChain {
  private readonly commands: Command[] = [];

  constructor(private readonly redis: FakeRedis) {}

  private queue(command: Command): this {
    this.commands.push(command);
    return this;
  }

  hincrby(key: string, field: string, increment: number) { return this.queue(() => this.redis.hincrby(key, field, increment)); }
  hgetall(key: string) { return this.queue(() => this.redis.hgetall(key)); }
  expire(key: string, seconds: number) { return this.queue(() => this.redis.expire(key, seconds)); }
  zincrby(key: string, increment: number, member: string) { return this.queue(() => this.redis.zincrby(key, increment, member)); }
  zadd(key: string, score: number, member: string) { return this.queue(() => this.redis.zadd(key, score, member)); }
  zrem(key: string, member: string) { return this.queue(() => this.redis.zrem(key, member)); }
  zscore(key: string, member: string) { return this.queue(() => this.redis.zscore(key, member)); }
  zremrangebyrank(key: string, start: number, stop: number) { return this.queue(() => this.redis.zremrangebyrank(key, start, stop)); }
  zrange(key: string, start: number | string, stop: number | string, withScores?: 'WITHSCORES') {
    return this.queue(() => this.redis.range(key, start, stop, false, withScores === 'WITHSCORES'));
  }
  zrevrange(key: string, start: number, stop: number, withScores?: 'WITHSCORES') {
    return this.queue(() => this.redis.range(key, start, stop, true, withScores === 'WITHSCORES'));
  }
  del(key: string) { return this.queue(() => this.redis.delete(key)); }

  async exec(): Promise<[Error | null, unknown][]> {
    return this.commands.map(command => [null, command()]);
  }
}

/**
 * A FakeRedis typed as the ioredis client expected by the code under test.
 */
export function createFakeRedis(): FakeRedis & Redis {
  return new FakeRedis() as unknown as FakeRedis & Redis;
}
