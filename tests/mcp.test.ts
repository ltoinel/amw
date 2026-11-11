/**
 * Unit tests for the MCP endpoint (src/server/McpEndpoint.ts), through a real MCP client
 */

import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createFakeRedis } from './helpers/fakeRedis';

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../src/utils/logger', () => ({
  getLogger: () => mockLogger,
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

const mockConfig: Record<string, unknown> = { 'Server.projectDir': '/nonexistent' };
jest.mock('config', () => ({
  has: (key: string) => key in mockConfig,
  get: (key: string) => mockConfig[key]
}));

import { AdminApi } from '../src/server/AdminApi';
import { Stats } from '../src/server/Stats';
import { loadSettings } from '../src/server/Settings';
import { AbHistorySettings, ButtonLabelSettings, EffectSettings, StuffingSettings, ThemeTestSettings } from '../src/server/StuffingSettings';
import { SiteSettings } from '../src/server/SiteSettings';

const PASSWORD = 'correct horse battery';
const TOKEN = 'a'.repeat(40);
const EFFECTS = ['none', 'fade', 'slide', 'zoom', 'pulse', 'shine'];

describe('MCP configuration', () => {
  afterEach(() => {
    delete mockConfig['Admin.enabled'];
    delete mockConfig['Admin.mcp'];
  });

  test('refuses to start without a strong token when enabled', () => {
    mockConfig['Admin.enabled'] = true;
    mockConfig['Admin.mcp'] = true;
    expect(() => AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD })).toThrow('AMW_MCP_TOKEN is not set');
    expect(() => AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_MCP_TOKEN: 'short' })).toThrow('at least 32 characters');
    expect(AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_MCP_TOKEN: TOKEN })).toBeInstanceOf(AdminApi);
  });

  test('serves no endpoint when off', async () => {
    mockConfig['Admin.enabled'] = true;
    const admin = AdminApi.fromSettings(new Stats(), loadSettings(), { AMW_ADMIN_PASSWORD: PASSWORD, AMW_MCP_TOKEN: TOKEN })!;
    const app = express();
    app.use('/amw/admin', admin.router());
    expect((await request(app).post('/amw/admin/mcp').set('Authorization', `Bearer ${TOKEN}`).send({})).status).toBe(404);
  });
});

describe('MCP endpoint', () => {
  let server: http.Server;
  let url: URL;
  let redis: ReturnType<typeof createFakeRedis>;
  let stats: Stats;
  let client: Client;

  beforeEach(async () => {
    redis = createFakeRedis();
    stats = new Stats(redis);
    const sites = new SiteSettings({ server: { allowedSites: ['blog.example'] }, recommendation: { allowedHosts: ['blog.example'] } } as never, redis as never);
    const admin = new AdminApi(stats, {
      password: PASSWORD,
      secret: 's',
      mcpToken: TOKEN,
      sites,
      stuffing: new StuffingSettings({ enabled: true, count: 2, mode: 'manual', containerId: 'main', products: [], wordsPerCard: 300, sites: {} } as never, redis as never),
      themeTest: new ThemeTestSettings(redis as never),
      buttonLabel: new ButtonLabelSettings(redis as never),
      effect: new EffectSettings({ mode: 'none', effects: EFFECTS } as never, redis as never),
      abHistory: new AbHistorySettings(redis as never),
      defaultTheme: 'shelf'
    });
    const app = express();
    app.use('/amw/admin', admin.router());
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/amw/admin/mcp`);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  });

  afterEach(async () => {
    await client.close();
    await new Promise(resolve => server.close(resolve));
  });

  const json = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

  test('refuses a missing or wrong token, and other methods', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await request(server).post('/amw/admin/mcp').send(body)).status).toBe(401);
    const wrong = await request(server).post('/amw/admin/mcp').set('Authorization', `Bearer ${'b'.repeat(40)}`).send(body);
    expect(wrong.status).toBe(401);
    expect(wrong.headers['www-authenticate']).toBe('Bearer');
    // A portal session is no MCP token
    const login = await request(server).post('/amw/admin/api/login').send({ password: PASSWORD });
    expect((await request(server).post('/amw/admin/mcp').set('Authorization', `Bearer ${login.body.token}`).send(body)).status).toBe(401);
    expect((await request(server).get('/amw/admin/mcp').set('Authorization', `Bearer ${TOKEN}`)).status).toBe(405);
  });

  test('lists the tools, with the read ones marked read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_ab_history', 'get_ab_tests', 'get_daily_stats', 'get_products_not_found', 'get_stuffing', 'get_top_pages',
      'get_top_products', 'list_sites', 'set_custom_products', 'set_deal_searches', 'start_ab_test', 'stop_ab_test'
    ]);
    expect(tools.find(tool => tool.name === 'get_top_pages')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find(tool => tool.name === 'start_ab_test')?.annotations?.readOnlyHint).toBe(false);
    // Nothing on the sites, the settings or the Amazon credentials
    expect(tools.some(tool => /site_|settings|tunable|amazon/.test(tool.name.replace('list_sites', '')))).toBe(false);
  });

  test('reads the sites and the statistics', async () => {
    stats.recordViews(['B000000001', 'B000000002'], 'https://blog.example/post', undefined, undefined, undefined, true);
    stats.recordClick('B000000001', 'https://blog.example/post');
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));

    expect(json(await call('list_sites')).sites.map((entry: { host: string }) => entry.host)).toEqual(['blog.example']);
    // Every site: the figures of one site are counted for the sites ranked by the stats only
    const daily = json(await call('get_daily_stats', { days: 1 }));
    expect(daily).toEqual([expect.objectContaining({ views: 2, clicks: 1, visits: 1 })]);
    const pages = json(await call('get_top_pages', { days: 1, limit: 5 }));
    expect(pages).toEqual([expect.objectContaining({ url: 'https://blog.example/post', impressions: 2, clicks: 1 })]);
    expect(json(await call('get_top_products', { days: 1, sort: 'clicks' }))[0]).toEqual(expect.objectContaining({ clicks: 1 }));
    expect(json(await call('get_products_not_found', { days: 1 }))).toEqual([]);
  });

  test('turns a refusal of the portal into a tool error', async () => {
    const result = await call('get_top_pages', { site: 'blog.example', sort: 'clicks', days: 1 });
    expect(result.isError).toBeFalsy();
    // Validated by the tool schema before the handler
    const invalid = await call('get_daily_stats', { site: 'not a host' });
    expect(invalid.isError).toBe(true);
  });

  test('starts, reads and stops an A/B test, with its history', async () => {
    const started = await call('start_ab_test', { site: 'blog.example', kind: 'label', variants: ['offer', 'buy'], days: 14 });
    expect(started.isError).toBeFalsy();
    const value = json(started);
    expect(value).toEqual(expect.objectContaining({ mode: 'compare', labels: ['offer', 'buy'], label: 'offer', own: true }));
    expect(Date.parse(value.endsAt) - Date.parse(value.startedAt)).toBe(14 * 86_400_000);

    // One test at a time on a site: the portal's lock applies
    const second = await call('start_ab_test', { site: 'blog.example', kind: 'effect', variants: ['none', 'shine'] });
    expect(second.isError).toBe(true);
    expect((second.content as { text: string }[])[0].text).toMatch(/^Refused \(409\)/);

    const tests = json(await call('get_ab_tests', { site: 'blog.example', days: 7 }));
    expect(tests.label.setting.mode).toBe('compare');
    expect(tests.effect.setting.mode).toBe('none');
    expect(tests.theme.setting).toEqual(expect.objectContaining({ mode: 'off', defaultTheme: 'shelf' }));
    expect(Array.isArray(tests.label.results)).toBe(true);

    const stopped = json(await call('stop_ab_test', { site: 'blog.example', kind: 'label', keep: 'buy' }));
    expect(stopped).toEqual(expect.objectContaining({ mode: 'off', label: 'buy' }));
    const history = json(await call('get_ab_history', { site: 'blog.example' }));
    expect(history.tests[0]).toEqual(expect.objectContaining({ kind: 'label', variants: ['offer', 'buy'], kept: 'buy' }));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/^MCP stop_ab_test done: /));
  });

  test('starts and stops the theme and effect tests too', async () => {
    const theme = json(await call('start_ab_test', { kind: 'theme', variants: ['shelf', 'neon'] }));
    expect(theme).toEqual(expect.objectContaining({ mode: 'compare', themes: ['shelf', 'neon'], startedAt: expect.any(String) }));
    expect(json(await call('stop_ab_test', { kind: 'theme', keep: 'neon' }))).toEqual(expect.objectContaining({ mode: 'off', theme: 'neon' }));

    expect(json(await call('start_ab_test', { kind: 'effect', variants: ['none', 'shine'] }))).toEqual(expect.objectContaining({ mode: 'compare', effects: ['none', 'shine'] }));
    expect(json(await call('stop_ab_test', { kind: 'effect', keep: 'shine' }))).toEqual(expect.objectContaining({ mode: 'shine' }));
    // An unknown value is refused by the setting, not stored
    expect((await call('stop_ab_test', { kind: 'effect', keep: 'sparkles' })).isError).toBe(true);
  });

  test('changes the custom products and the deals searches', async () => {
    const products = await call('set_custom_products', { site: 'blog.example', products: ['B000000001', 'B000000002'] });
    expect(products.isError).toBeFalsy();
    expect(json(await call('get_stuffing', { site: 'blog.example' })).products).toEqual(['B000000001', 'B000000002']);
    expect((await call('set_custom_products', { site: 'blog.example', products: ['not-an-asin'] })).isError).toBe(true);

    const deals = await call('set_deal_searches', { site: 'blog.example', searches: [{ keywords: 'lego', searchIndex: 'ToysAndGames', minSavingPercent: 20 }] });
    expect(deals.isError).toBeFalsy();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/^MCP set_deal_searches done: /));
  });

  test('reports a failure of the server as a tool error', async () => {
    jest.spyOn(AdminApi.prototype, 'call').mockRejectedValueOnce(new Error('boom'));
    const result = await call('list_sites');
    expect(result.isError).toBe(true);
    expect(mockLogger.error).toHaveBeenCalledWith('MCP list_sites failed:', expect.any(Error));
  });

  test('answers a 500 when the request cannot be served', async () => {
    jest.spyOn(McpServer.prototype, 'connect').mockRejectedValueOnce(new Error('boom'));
    const res = await request(server).post('/amw/admin/mcp').set('Authorization', `Bearer ${TOKEN}`)
      .set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(-32603);
  });
});

describe('MCP endpoint without Redis', () => {
  let server: http.Server;
  let client: Client;

  beforeEach(async () => {
    const app = express();
    // No statistics, and the theme test missing: the agent gets errors it can read
    app.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: 's', mcpToken: TOKEN, effect: new EffectSettings({ mode: 'none', effects: EFFECTS } as never), buttonLabel: new ButtonLabelSettings() }).router());
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/amw/admin/mcp`);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  });

  afterEach(async () => {
    await client.close();
    await new Promise(resolve => server.close(resolve));
  });

  test('says when the statistics or a setting are unavailable', async () => {
    const daily = await client.callTool({ name: 'get_daily_stats', arguments: {} });
    expect(daily.isError).toBe(true);
    expect((daily.content as { text: string }[])[0].text).toMatch(/^Refused \(503\)/);
    const tests = await client.callTool({ name: 'get_ab_tests', arguments: {} });
    expect(tests.isError).toBe(true);
    expect((tests.content as { text: string }[])[0].text).toContain('theme test setting is not available');
  });
});

describe('AdminApi.call', () => {
  test('rejects when the handler fails, or never answers', async () => {
    jest.useFakeTimers();
    try {
      const sites = { refresh: () => Promise.reject(new Error('down')) };
      const admin = new AdminApi(new Stats(), { password: PASSWORD, secret: 's', sites: sites as never });
      await expect(admin.call('sites')).rejects.toThrow('down');

      const silent = new AdminApi(new Stats(), { password: PASSWORD, secret: 's' });
      jest.spyOn(silent as unknown as { handle: () => void }, 'handle').mockImplementation(() => undefined);
      const pending = silent.call('daily');
      jest.advanceTimersByTime(15_000);
      await expect(pending).rejects.toThrow('No answer from daily');
    } finally {
      jest.useRealTimers();
    }
  });
});
