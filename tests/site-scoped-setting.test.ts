/**
 * Unit tests for the settings that each site may set for itself (src/server/SiteScopedSetting.ts).
 */

import { z } from 'zod';
import { RuntimeSetting } from '../src/server/RuntimeSetting';
import { SiteScopedSetting } from '../src/server/SiteScopedSetting';
import { createFakeRedis } from './helpers/fakeRedis';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const schema = z.strictObject({ count: z.number() });

describe('SiteScopedSetting', () => {
  it('follows the setting of every site until a site saves its own, under its own key', async () => {
    const redis = createFakeRedis();
    const global = new RuntimeSetting('amw:settings:test', schema, { count: 1 }, redis as never);
    const scoped = new SiteScopedSetting(global);
    expect(scoped.editable).toBe(true);

    expect(scoped.current('blog.example')).toEqual({ count: 1 });
    expect(scoped.isOwn('blog.example')).toBe(false);
    await global.save({ count: 2 });
    // A site without its own value follows a later change of every site
    expect(scoped.current('blog.example')).toEqual({ count: 2 });

    await scoped.of('blog.example').save({ count: 5 });
    expect(await redis.get('amw:settings:test:site:blog.example')).toBe('{"count":5}');
    expect(scoped.current('blog.example')).toEqual({ count: 5 });
    expect(scoped.isOwn('blog.example')).toBe(true);
    expect(scoped.current('shop.example')).toEqual({ count: 2 });
    expect(scoped.current()).toEqual({ count: 2 });
    expect(scoped.of()).toBe(global);
  });

  it('reads the values saved by another process', async () => {
    const redis = createFakeRedis();
    await redis.set('amw:settings:test:site:shop.example', '{"count":9}');
    const scoped = new SiteScopedSetting(new RuntimeSetting('amw:settings:test', schema, { count: 1 }, redis as never));
    await scoped.refresh(['shop.example', 'not a host']);
    expect(scoped.current('shop.example')).toEqual({ count: 9 });
  });

  it('never makes a store key of something that is not a host', () => {
    const scoped = new SiteScopedSetting(new RuntimeSetting('amw:settings:test', schema, { count: 1 }));
    expect(scoped.editable).toBe(false);
    expect(() => scoped.of('evil:key*')).toThrow('Not a site host');
    expect(scoped.current('evil:key*')).toEqual({ count: 1 });
    expect(scoped.isOwn('evil:key*')).toBe(false);
  });
});
