/**
 * Unit tests for the batching of lookups (src/server/LookupBatcher.ts).
 */

import { LookupBatcher } from '../src/server/LookupBatcher';

describe('LookupBatcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gathers the keys asked within the window into one call, each repeated key once', async () => {
    const fetch = jest.fn(async (keys: string[]) => new Map(keys.filter(key => key !== 'gone').map(key => [key, key.toUpperCase()])));
    const batcher = new LookupBatcher(fetch, 10, 20);

    const results = Promise.all(['a', 'b', 'a', 'gone'].map(key => batcher.get(key)));
    await jest.advanceTimersByTimeAsync(20);

    expect(await results).toEqual(['A', 'B', 'A', undefined]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(['a', 'b', 'gone']);
  });

  it('calls at once when the batch is full, then starts a new one', async () => {
    const fetch = jest.fn(async (keys: string[]) => new Map(keys.map(key => [key, key])));
    const batcher = new LookupBatcher(fetch, 2, 20);

    const first = Promise.all([batcher.get('a'), batcher.get('b')]);
    expect(fetch).toHaveBeenCalledWith(['a', 'b']);
    expect(await first).toEqual(['a', 'b']);

    const third = batcher.get('c');
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(20);
    expect(await third).toBe('c');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives every waiting lookup the same error when the call fails', async () => {
    const failure = new Error('Amazon down');
    const batcher = new LookupBatcher<string, string>(async () => { throw failure; }, 10, 20);

    const results = Promise.allSettled([batcher.get('a'), batcher.get('b')]);
    await jest.advanceTimersByTimeAsync(20);

    expect((await results).map(result => (result as PromiseRejectedResult).reason)).toEqual([failure, failure]);
  });
});
