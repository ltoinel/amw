import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSettingStore, type SettingStore } from '../src/server/SettingStore';
jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { PartnerTagSettings, ThemeTestSettings } from '../src/server/StuffingSettings';

describe('FileSettingStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'amw-settings-'));
    file = path.join(dir, 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads nothing before the file exists', async () => {
    expect(await new FileSettingStore(file).get('amw:settings:effect')).toBeNull();
  });

  test('keeps each key as readable JSON and leaves no temporary file', async () => {
    const store = new FileSettingStore(file);
    await store.set('a', JSON.stringify({ mode: 'off' }));
    await store.set('b', JSON.stringify([1, 2]));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: { mode: 'off' }, b: [1, 2] });
    expect(await store.get('a')).toBe('{"mode":"off"}');
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });

  test('saves made at the same time all reach the file', async () => {
    const store = new FileSettingStore(file);
    await Promise.all(['a', 'b', 'c', 'd'].map(key => store.set(key, JSON.stringify(key))));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 'a', b: 'b', c: 'c', d: 'd' });
  });

  test('reads the fallback for a key the file does not hold', async () => {
    const fallback: SettingStore = { get: jest.fn().mockResolvedValue('{"from":"redis"}'), set: jest.fn() };
    const store = new FileSettingStore(file, fallback);
    expect(await store.get('a')).toBe('{"from":"redis"}');
    await store.set('a', '{"from":"file"}');
    expect(await store.get('a')).toBe('{"from":"file"}');
    expect(fallback.set).not.toHaveBeenCalled();
  });

  test('does not replace a file it cannot read', async () => {
    writeFileSync(file, '{ broken');
    const store = new FileSettingStore(file);
    await expect(store.get('a')).rejects.toThrow();
    await expect(store.set('a', '1')).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe('{ broken');
    // A failed save does not block the next ones
    writeFileSync(file, '{}');
    await store.set('a', '1');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 });
  });

  test('refuses a file that is not a JSON object', async () => {
    writeFileSync(file, '[1]');
    await expect(new FileSettingStore(file).get('a')).rejects.toThrow(/JSON object/);
  });

  test('reports other read errors', async () => {
    await expect(new FileSettingStore(dir).get('a')).rejects.toThrow();
  });

  test('backs a runtime setting', async () => {
    const setting = new PartnerTagSettings(new FileSettingStore(file));
    expect(setting.editable).toBe(true);
    await setting.save({ sites: { 'www.example.com': 'example-21' } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'amw:settings:partner-tags': { sites: { 'www.example.com': 'example-21' } } });

    const other = new PartnerTagSettings(new FileSettingStore(file));
    await other.refresh();
    expect(other.current().sites).toEqual({ 'www.example.com': 'example-21' });
  });

  test('a runtime setting without a store refuses to save', async () => {
    await expect(new ThemeTestSettings().save({ mode: 'off', themes: [] })).rejects.toThrow(/Admin.settingsFile/);
    expect(existsSync(file)).toBe(false);
  });
});
