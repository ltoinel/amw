/**
 * Response compression (#134).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import express from 'express';
import compression from 'compression';
import request from 'supertest';

const mockProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amw-compression-'));
const widgetSource = `/* widget */\n${'console.log("amw widget");\n'.repeat(200)}`;
fs.mkdirSync(path.join(mockProjectDir, 'dist', 'widgets'), { recursive: true });
fs.writeFileSync(path.join(mockProjectDir, 'dist', 'widgets', 'widget.js'), widgetSource);

const mockConfig: Record<string, unknown> = {
  'Server.port': 8080,
  'Server.path': '/amw',
  'Server.debug': false,
  'Server.cors': false,
  'Server.projectDir': mockProjectDir,
  'Server.httpCache': 300,
  'Redis.enabled': false,
  'Redis.expire': 3600,
};

jest.mock('config', () => ({
  get: (key: string) => mockConfig[key],
  has: (key: string) => key in mockConfig,
}));

jest.mock('../src/utils/logger', () => ({
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockGetItemApi = jest.fn();
jest.mock('../src/server/Paapi', () => ({
  Paapi: jest.fn().mockImplementation(() => ({
    getItemApi: mockGetItemApi,
    searchItemApi: jest.fn(),
  })),
}));

import { AmwServer } from '../src/server/AmwServer';

// superagent already decodes br/gzip, so the body is the plain text; a response compressed
// twice would come out still encoded
function rawBody(res: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Response compression', () => {
  const app = new AmwServer().getApp();

  afterAll(() => {
    fs.rmSync(mockProjectDir, { recursive: true, force: true });
  });

  test('widget.js is served with brotli when accepted', async () => {
    const res = await request(app).get('/amw/widget.js')
      .set('Accept-Encoding', 'gzip, deflate, br')
      .buffer(true).parse(rawBody).expect(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['vary']).toMatch(/Accept-Encoding/i);
    expect(res.body.toString()).toBe(widgetSource);
  });

  test('widget.js falls back to gzip', async () => {
    const res = await request(app).get('/amw/widget.js')
      .set('Accept-Encoding', 'gzip')
      .buffer(true).parse(rawBody).expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.toString()).toBe(widgetSource);
  });

  test('widget.js is sent as is to clients without compression support', async () => {
    const res = await request(app).get('/amw/widget.js')
      .set('Accept-Encoding', 'identity')
      .buffer(true).parse(rawBody).expect(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['vary']).toMatch(/Accept-Encoding/i);
    expect(res.body.toString()).toBe(widgetSource);
  });

  test('large product JSON is compressed', async () => {
    mockGetItemApi.mockResolvedValueOnce({
      title: 'x'.repeat(2000), url: 'u', image: 'i', brand: '', price: 1, timestamp: 1
    });
    const res = await request(app).get('/amw/product?id=B08N5WRWNW')
      .set('Accept-Encoding', 'br')
      .buffer(true).parse(rawBody).expect(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(JSON.parse(res.body.toString()).title).toHaveLength(2000);
  });

  test('small responses are not worth compressing', async () => {
    const res = await request(app).get('/amw/health').set('Accept-Encoding', 'br').expect(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  test('an already encoded response is not compressed twice', async () => {
    const precompressed = zlib.gzipSync(widgetSource);
    const standalone = express();
    standalone.use(compression());
    standalone.get('/asset.js', (_req, res) => {
      res.set({ 'Content-Type': 'application/javascript', 'Content-Encoding': 'gzip' });
      res.send(precompressed);
    });

    const res = await request(standalone).get('/asset.js')
      .set('Accept-Encoding', 'br, gzip')
      .buffer(true).parse(rawBody).expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.toString()).toBe(widgetSource);
  });
});
