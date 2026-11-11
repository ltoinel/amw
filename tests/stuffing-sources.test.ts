/**
 * The sources of the Stuffing cards beyond the happy paths: the deals kept in Redis by another
 * process, a store or Amazon that fails, and a mix with no product anywhere.
 */

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { loadModules, createLoggerMock, createAmazonItem } from './helpers/mocks';

const mockLogger = createLoggerMock();
const mockGetItems = jest.fn();
const mockSearchItems = jest.fn();

jest.mock('../src/utils/logger', () => ({ getLogger: () => mockLogger }));

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({ getItems: mockGetItems, searchItems: mockSearchItems })),
  GetItemsRequestContent: jest.fn().mockImplementation((partnerTag, itemIds) => ({ partnerTag, itemIds })),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => value },
  SearchItemsResource: { constructFromObject: (value: string) => value },
  Condition: { constructFromObject: (value: string) => value },
}));

const DEALS = { keywords: 'casque', searchIndex: 'Electronics', minSavingPercent: 30 };
const DEALS_KEY = `amw:deals:${crypto.createHash('sha1').update(JSON.stringify([DEALS.keywords, DEALS.searchIndex, DEALS.minSavingPercent])).digest('hex').slice(0, 16)}`;
const PAGE = 'https://www.geeek.org/article/';
const url = (slot = 0) => `/amw/product?page=${crypto.createHash('md5').update(PAGE).digest('hex')}&slot=${slot}`;

/** A store shared by the "processes" of a test, whose commands can be made to fail. */
function createStore(stuffing: Record<string, unknown>) {
  const values = new Map<string, string>([['amw:settings:stuffing', JSON.stringify({
    enabled: true, count: 2, containerId: 'main-content', products: [], wordsPerCard: 0, sites: {}, deals: DEALS, ...stuffing,
  })]]);
  return {
    values,
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { values.set(key, value); return 'OK'; }),
    exists: jest.fn(async (key: string) => (values.has(key) ? 1 : 0)),
  };
}

function createApp(store: ReturnType<typeof createStore> | undefined, overrides: Record<string, unknown> = {}) {
  const { AmwApi } = loadModules({ 'Redis.enabled': true, 'Recommendation.enabled': false, ...overrides });
  const api = new AmwApi(store as never);
  const app = express();
  app.get('/amw/product', (req, res) => api.setProductEndpoint(req, res));
  return app;
}

const product = (asin: string) => JSON.stringify({ ...createAmazonItem({ asin }), asin, title: asin, image: 'https://m.media-amazon.com/x.jpg', url: `https://www.amazon.fr/dp/${asin}`, price: '9,99 €', savings: 30, timestamp: Date.now() });

beforeEach(() => {
  mockGetItems.mockReset();
  mockSearchItems.mockReset();
  mockLogger.error.mockClear();
});

describe('deals kept by another process', () => {
  it('serves the deals another process found, with no search', async () => {
    const store = createStore({ mode: 'deals' });
    store.values.set(DEALS_KEY, JSON.stringify({ at: Date.now(), deals: [{ asin: 'B0DEAL0001', savings: 40 }] }));
    store.values.set('amw:product:id:B0DEAL0001', product('B0DEAL0001'));

    const res = await request(createApp(store)).get(url()).set('Referer', PAGE);
    expect(res.body.asin).toBe('B0DEAL0001');
    expect(mockSearchItems).not.toHaveBeenCalled();
  });

  it('gives the card to the next deal when the cached product fell below the smallest discount', async () => {
    const store = createStore({ mode: 'deals' });
    store.values.set(DEALS_KEY, JSON.stringify({ at: Date.now(), deals: [{ asin: 'B0DEAL0001', savings: 40 }, { asin: 'B0DEAL0002', savings: 40 }] }));
    // Refreshed by another card since the search: 5%, below the smallest discount of 30%
    store.values.set('amw:product:id:B0DEAL0001', JSON.stringify({ ...JSON.parse(product('B0DEAL0001')), savings: 5 }));
    store.values.set('amw:product:id:B0DEAL0002', product('B0DEAL0002'));

    const app = createApp(store);
    const cards = [];
    for (let slot = 0; slot < 2; slot++) cards.push((await request(app).get(url(slot)).set('Referer', PAGE)).body.asin);
    expect(cards).toContain('B0DEAL0002');
    expect(cards).not.toContain('B0DEAL0001');
  });

  it('shows the flash sales still running first, then the largest discounts', async () => {
    const store = createStore({ mode: 'deals', count: 3 });
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    store.values.set(DEALS_KEY, JSON.stringify({ at: Date.now(), deals: [
      { asin: 'B0DEAL0001', savings: 60 },
      { asin: 'B0DEAL0002', savings: 35, dealEnd: future },
      { asin: 'B0DEAL0003', savings: 70, dealEnd: past },
    ] }));
    for (const asin of ['B0DEAL0001', 'B0DEAL0002', 'B0DEAL0003']) store.values.set(`amw:product:id:${asin}`, product(asin));

    const app = createApp(store);
    const cards = [];
    for (let slot = 0; slot < 3; slot++) cards.push((await request(app).get(url(slot)).set('Referer', PAGE)).body.asin);
    expect(cards).toEqual(['B0DEAL0002', 'B0DEAL0003', 'B0DEAL0001']);
  });

  it('ranks equal discounts by demand: the share of a flash sale claimed, then the sales rank', async () => {
    const store = createStore({ mode: 'deals', count: 4 });
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    store.values.set(DEALS_KEY, JSON.stringify({ at: Date.now(), deals: [
      { asin: 'B0DEAL0001', savings: 40, salesRank: 900 },
      { asin: 'B0DEAL0002', savings: 40, salesRank: 15 },
      { asin: 'B0DEAL0003', savings: 40, dealEnd: future, dealClaimed: 20 },
      { asin: 'B0DEAL0004', savings: 40, dealEnd: future, dealClaimed: 85 },
    ] }));
    for (let i = 1; i <= 4; i++) store.values.set(`amw:product:id:B0DEAL000${i}`, product(`B0DEAL000${i}`));

    const app = createApp(store);
    const cards = [];
    for (let slot = 0; slot < 4; slot++) cards.push((await request(app).get(url(slot)).set('Referer', PAGE)).body.asin);
    expect(cards).toEqual(['B0DEAL0004', 'B0DEAL0003', 'B0DEAL0002', 'B0DEAL0001']);
  });

  it('keeps the old deals while the breaker keeps Amazon out', async () => {
    const store = createStore({ mode: 'deals' });
    store.values.set(DEALS_KEY, JSON.stringify({ at: Date.now() - 4 * 3600 * 1000, deals: [{ asin: 'B0DEAL0001', savings: 40 }] }));
    store.values.set('amw:product:id:B0DEAL0001', product('B0DEAL0001'));
    const app = createApp(store, { 'Amazon.breakerThreshold': 1 });
    // One failure opens the breaker
    mockGetItems.mockRejectedValue({ status: 500, body: {}, response: { status: 500, headers: new Headers() } });
    await request(app).get('/amw/product?id=B0FAIL0001');

    const res = await request(app).get(url()).set('Referer', PAGE);
    expect(res.body.asin).toBe('B0DEAL0001');
    expect(mockSearchItems).not.toHaveBeenCalled();
  });

  it('searches when the store cannot be read, and serves what it found when it cannot be written', async () => {
    const store = createStore({ mode: 'deals' });
    store.get.mockImplementation(async (key: string) => {
      if (key === DEALS_KEY) throw new Error('read refused');
      return store.values.get(key) ?? null;
    });
    store.set.mockImplementation(async (key: string, value: string) => {
      if (key === DEALS_KEY) throw new Error('write refused');
      store.values.set(key, value);
      return 'OK';
    });
    mockSearchItems.mockResolvedValue({ searchResult: { items: [createAmazonItem({ asin: 'B0DEAL0002', offersV2: { listings: [{ price: { money: { displayAmount: '9,99 €' }, savings: { percentage: 30 } } }] } })] } });

    const res = await request(createApp(store)).get(url()).set('Referer', PAGE);
    expect(res.body.asin).toBe('B0DEAL0002');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error reading the deals'), expect.any(Error));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error saving the deals'), expect.any(Error));
  });
});

describe('cards without a product', () => {
  it('shows no card for deals without a search, as a configuration file may set', async () => {
    const app = createApp(undefined, { 'Stuffing.mode': 'deals', 'Stuffing.count': 2 });
    expect((await request(app).get(url()).set('Referer', PAGE)).status).toBe(404);
    expect(mockSearchItems).not.toHaveBeenCalled();
  });

  it('shows no card when no source of a mix has a product', async () => {
    const store = createStore({ mode: 'mix', products: [], weights: { recommendation: 0, popular: 50, manual: 50, deals: 0 } });
    const res = await request(createApp(store)).get(url()).set('Referer', PAGE);
    expect(res.status).toBe(404);
  });

  it('reads a referer that is not a URL as no site', async () => {
    const store = createStore({ mode: 'manual', products: [] });
    expect((await request(createApp(store)).get(url()).set('Referer', 'not a url')).status).toBe(404);
  });
});
