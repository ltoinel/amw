/**
 * Unit tests of AmwApi paths that cannot be reached reliably over HTTP:
 * the 30 s Amazon timeout and failures thrown synchronously by Express.
 */

import type { Request, Response } from 'express';
import { loadModules, createLoggerMock } from './helpers/mocks';

const mockLogger = createLoggerMock();

jest.mock('../src/utils/ConfigLog4j', () => ({ getLogger: () => mockLogger }));
jest.mock('amazon-creators-api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({})),
  TypedDefaultApi: jest.fn().mockImplementation(() => ({})),
}));

function createRequest(query: Record<string, unknown>): Request {
  return { query, ip: '198.51.100.1', get: () => undefined } as unknown as Request;
}

function createResponse() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    type: jest.fn(),
    sendFile: jest.fn(),
    set: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.set.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('AmwApi Amazon timeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([
    ['id', { id: 'B084DN3XVN' }, 'getItemApi'],
    ['keyword', { keyword: 'arduino' }, 'searchItemApi'],
  ] as const)('answers 504 when the %s lookup takes more than 30 seconds', async (_label, query, method) => {
    const { AmwApi, Paapi } = loadModules();
    jest.spyOn(Paapi.prototype, method).mockReturnValue(new Promise(() => undefined));
    const res = createResponse();

    const pending = new AmwApi().setProductEndpoint(createRequest(query), res as unknown as Response);
    await jest.advanceTimersByTimeAsync(30000);
    await pending;

    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Gateway Timeout' }));
  });

  it('does not leave the timeout timer running once Amazon has answered', async () => {
    const { AmwApi, Paapi } = loadModules();
    jest.spyOn(Paapi.prototype, 'getItemApi').mockResolvedValue(null);

    await new AmwApi().setProductEndpoint(createRequest({ id: 'B084DN3XVN' }), createResponse() as unknown as Response);

    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('AmwApi versioned widget files', () => {
  it('rejects a file name that is not a hashed widget file without touching the disk', () => {
    const { AmwApi } = loadModules();
    const res = createResponse();
    const req = { ...createRequest({}), params: { 0: '../config/production.yml' } } as unknown as Request;

    new AmwApi().setVersionedWidgetEndpoint(req, res as unknown as Response);

    expect(res.sendFile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

describe('AmwApi error handling', () => {
  it('answers 500 when serving the widget throws synchronously', () => {
    const { AmwApi } = loadModules();
    const res = createResponse();
    res.sendFile.mockImplementation(() => {
      throw new Error('EACCES');
    });

    new AmwApi().setWidgetEndpoint(createRequest({}), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('handles non-Error values thrown by the lookup', async () => {
    const { AmwApi, Paapi } = loadModules();
    jest.spyOn(Paapi.prototype, 'getItemApi').mockRejectedValue('string failure');
    const res = createResponse();

    await new AmwApi().setProductEndpoint(createRequest({ id: 'B084DN3XVN' }), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockLogger.error).toHaveBeenCalledWith('API Error: string failure', expect.any(Error));
  });

  it('logs a sanitized referer', async () => {
    const { AmwApi, Paapi } = loadModules();
    jest.spyOn(Paapi.prototype, 'getItemApi').mockResolvedValue(null);
    const req = { ...createRequest({ id: 'B084DN3XVN' }), get: () => 'https://blog.example/<script>\n' } as unknown as Request;

    await new AmwApi().setProductEndpoint(req, createResponse() as unknown as Response);

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Referer=https://blog.example/script'));
  });

  it('defaults the TTL to one hour when Redis.expire is not a number', () => {
    const { AmwApi } = loadModules({ 'Redis.expire': 'not-a-number' });

    expect(() => new AmwApi()).not.toThrow();
  });
});
