/**
 * Unit tests of the Paapi wrapper around the (mocked) Amazon Creators API SDK.
 */

import { loadModules, createLoggerMock, createAmazonItem } from './helpers/mocks';

const mockLogger = createLoggerMock();
const mockGetItems = jest.fn();
const mockSearchItems = jest.fn();
const mockApiClient: Record<string, unknown> = {};

jest.mock('../src/utils/ConfigLog4j', () => ({ getLogger: () => mockLogger }));

jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => mockApiClient),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({
    getItems: mockGetItems,
    searchItems: mockSearchItems,
  })),
  GetItemsRequestContent: jest.fn().mockImplementation((partnerTag, itemIds) => ({ partnerTag, itemIds })),
  SearchItemsRequestContent: jest.fn().mockImplementation(() => ({})),
  GetItemsResource: { constructFromObject: (value: string) => `get:${value}` },
  SearchItemsResource: { constructFromObject: (value: string) => `search:${value}` },
  Condition: { constructFromObject: (value: string) => `condition:${value}` },
}));

function createPaapi(overrides: Record<string, unknown> = {}) {
  const { Paapi } = loadModules(overrides);
  return new Paapi();
}

const RESOURCES = ['images.primary.large', 'itemInfo.title', 'itemInfo.byLineInfo', 'offersV2.listings.price'];

describe('Paapi client setup', () => {
  it('configures the SDK client with the credentials from the configuration', () => {
    createPaapi({ 'Amazon.credentialId': 'id-1', 'Amazon.credentialSecret': 'secret-1', 'Amazon.version': '2.1' });

    expect(mockApiClient).toMatchObject({ credentialId: 'id-1', credentialSecret: 'secret-1', version: '2.1' });
  });
});

describe('Paapi.getItemApi', () => {
  it('requests the item with the partner tag, condition and display resources', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [createAmazonItem()] } });

    await createPaapi({ 'Amazon.marketplace': 'www.amazon.de' }).getItemApi('B084DN3XVN');

    expect(mockGetItems).toHaveBeenCalledWith('www.amazon.de', {
      partnerTag: 'test-21',
      itemIds: ['B084DN3XVN'],
      condition: 'condition:New',
      resources: RESOURCES.map((r) => `get:${r}`),
    });
  });

  it('returns the product built from the first item', async () => {
    mockGetItems.mockResolvedValue({
      itemsResult: { items: [createAmazonItem(), createAmazonItem({ asin: 'SECOND' })] },
    });

    const product = await createPaapi().getItemApi('B084DN3XVN');

    expect(product).toMatchObject({ asin: 'B084DN3XVN', title: 'Arduino Uno R3' });
  });

  it.each([
    ['no itemsResult', {}],
    ['no items', { itemsResult: {} }],
    ['an empty item list', { itemsResult: { items: [] } }],
  ])('returns null when the response has %s', async (_label, response) => {
    mockGetItems.mockResolvedValue(response);

    await expect(createPaapi().getItemApi('B084DN3XVN')).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith('No product found for: B084DN3XVN');
  });

  it('returns null instead of throwing when the SDK rejects', async () => {
    mockGetItems.mockRejectedValue(new Error('Unauthorized'));

    await expect(createPaapi().getItemApi('B084DN3XVN')).resolves.toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith('Error message: Unauthorized');
  });

  it('returns null when the item is malformed', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [{ asin: 'B084DN3XVN' }] } });

    await expect(createPaapi().getItemApi('B084DN3XVN')).resolves.toBeNull();
  });
});

describe('Paapi.searchItemApi', () => {
  it('searches a single item by keyword', async () => {
    mockSearchItems.mockResolvedValue({ searchResult: { items: [createAmazonItem()] } });

    const product = await createPaapi().searchItemApi('arduino');

    expect(product).toMatchObject({ title: 'Arduino Uno R3' });
    expect(mockSearchItems).toHaveBeenCalledWith('www.amazon.fr', {
      partnerTag: 'test-21',
      keywords: 'arduino',
      itemCount: 1,
      condition: 'condition:New',
      resources: RESOURCES.map((r) => `search:${r}`),
    });
  });

  it.each([
    ['no searchResult', {}],
    ['no items', { searchResult: {} }],
    ['an empty item list', { searchResult: { items: [] } }],
  ])('returns null when the response has %s', async (_label, response) => {
    mockSearchItems.mockResolvedValue(response);

    await expect(createPaapi().searchItemApi('nothing')).resolves.toBeNull();
  });

  it('returns null instead of throwing when the SDK rejects', async () => {
    mockSearchItems.mockRejectedValue('plain string failure');

    await expect(createPaapi().searchItemApi('arduino')).resolves.toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith('HTTP unknown - plain string failure');
  });
});

describe('Paapi.buildProduct', () => {
  const now = 1_700_000_000_000;
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));
  afterEach(() => jest.restoreAllMocks());

  it('maps an item with an offer and savings', () => {
    expect(createPaapi().buildProduct(createAmazonItem())).toEqual({
      image: 'https://m.media-amazon.com/images/I/arduino.jpg',
      title: 'Arduino Uno R3',
      url: 'https://www.amazon.fr/dp/B084DN3XVN?tag=test-21',
      brand: 'Arduino',
      asin: 'B084DN3XVN',
      price: '24,99 €',
      timestamp: now,
      savings: 15,
    });
  });

  it('keeps savings at 0 when the offer has no discount', () => {
    const item = createAmazonItem({
      offersV2: { listings: [{ price: { money: { displayAmount: '10,00 €' } } }] },
    });

    expect(createPaapi().buildProduct(item)).toMatchObject({ price: '10,00 €', savings: 0 });
  });

  it.each([
    ['no offersV2', undefined],
    ['no listings', {}],
    ['an empty listing', { listings: [] }],
  ])('marks the price as unavailable (-1) when there is %s', (_label, offersV2) => {
    const product = createPaapi().buildProduct(createAmazonItem({ offersV2 }));

    expect(product).toMatchObject({ price: -1, savings: 0 });
    expect(mockLogger.warn).toHaveBeenCalledWith('No offer found for : B084DN3XVN');
  });

  it('defaults the brand and ASIN to empty strings when absent', () => {
    const item = createAmazonItem({ asin: undefined, itemInfo: { title: { displayValue: 'No brand' } } });

    expect(createPaapi().buildProduct(item)).toMatchObject({ brand: '', asin: '', title: 'No brand' });
  });
});

describe('Paapi debug logging', () => {
  it('dumps the response and its first error when Server.debug is enabled', async () => {
    mockGetItems.mockResolvedValue({
      itemsResult: { items: [createAmazonItem()] },
      errors: [{ code: 'ItemNotAccessible', message: 'Not accessible' }],
    });

    await createPaapi({ 'Server.debug': true }).getItemApi('B084DN3XVN');

    expect(mockLogger.debug).toHaveBeenCalledWith('Error Code: ItemNotAccessible');
    expect(mockLogger.debug).toHaveBeenCalledWith('Error Message: Not accessible');
  });

  it('dumps search responses when Server.debug is enabled', async () => {
    mockSearchItems.mockResolvedValue({ searchResult: { items: [createAmazonItem()] } });

    await createPaapi({ 'Server.debug': true }).searchItemApi('arduino');

    expect(mockLogger.debug).toHaveBeenCalledWith('API called successfully.');
    expect(mockLogger.debug).not.toHaveBeenCalledWith('Printing 1st Error:');
  });

  it('does not dump responses when Server.debug is disabled', async () => {
    mockGetItems.mockResolvedValue({ itemsResult: { items: [createAmazonItem()] } });

    await createPaapi().getItemApi('B084DN3XVN');

    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('logs the stack of SDK errors only in debug mode', async () => {
    mockGetItems.mockRejectedValue(new Error('boom'));

    await createPaapi({ 'Server.debug': true }).getItemApi('B084DN3XVN');
    await createPaapi().getItemApi('B084DN3XVN');

    const stackLogs = mockLogger.error.mock.calls.filter(([message]) => String(message).startsWith('Stack: '));
    expect(stackLogs).toHaveLength(1);
  });

  it.each([
    ['statusCode and body', { statusCode: 403, body: { reason: 'denied' } }, 'HTTP 403 - {\n "reason": "denied"\n}'],
    ['response status and text', { response: { status: 503 }, text: 'Service Unavailable' }, 'HTTP 503 - Service Unavailable'],
  ])('extracts %s from HTTP error objects', async (_label, error, expected) => {
    mockGetItems.mockRejectedValue(error);

    await createPaapi().getItemApi('B084DN3XVN');

    expect(mockLogger.error).toHaveBeenCalledWith(expected);
  });
});
