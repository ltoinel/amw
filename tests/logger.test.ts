/**
 * Unit tests of the pino logger factory and of the HTTP request logger (request ids, redaction).
 */

import { Writable } from 'stream';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import { buildLoggerOptions, createRequestLogger, getLogger, isPrettyAvailable } from '../src/utils/logger';

jest.mock('config', () => ({ __esModule: true, default: { get: () => false, has: () => true } }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A pino logger configured like the real one, writing JSON lines to memory instead of stdout
function createCapture(debug = false) {
  const lines: Record<string, any>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    }
  });
  return { base: pino(buildLoggerOptions(debug, 'production', false), stream), lines };
}

describe('buildLoggerOptions', () => {
  it.each([[true], ['true']])('logs at debug level when Server.debug is %p', (debug) => {
    expect(buildLoggerOptions(debug, 'production', true).level).toBe('debug');
  });

  it.each([[false], ['false'], [undefined]])('logs at info level when Server.debug is %p', (debug) => {
    expect(buildLoggerOptions(debug, 'production', true).level).toBe('info');
  });

  it('pretty prints in development when pino-pretty is installed', () => {
    expect(buildLoggerOptions(false, 'development', true).transport).toEqual(
      expect.objectContaining({ target: 'pino-pretty' })
    );
  });

  it('writes JSON in other environments, or when pino-pretty is missing', () => {
    expect(buildLoggerOptions(false, 'docker', true).transport).toBeUndefined();
    expect(buildLoggerOptions(false, 'production', true).transport).toBeUndefined();
    expect(buildLoggerOptions(false, 'development', false).transport).toBeUndefined();
  });

  it('detects pino-pretty from the dev dependencies', () => {
    expect(isPrettyAvailable()).toBe(true);
  });
});

describe('getLogger', () => {
  it('tags lines with the module name', () => {
    const { base, lines } = createCapture();
    getLogger('AmwApi', base).info('ready');

    expect(lines).toEqual([expect.objectContaining({ level: 30, module: 'AmwApi', msg: 'ready' })]);
  });

  it('logs the optional second argument as a serialized error', () => {
    const { base, lines } = createCapture();
    getLogger('AmwServer', base).error('Redis connection error:', new Error('ECONNREFUSED'));

    expect(lines[0]).toMatchObject({ level: 50, msg: 'Redis connection error:', err: { type: 'Error', message: 'ECONNREFUSED' } });
    expect(lines[0].err.stack).toContain('ECONNREFUSED');
  });

  it('filters debug lines unless Server.debug is enabled', () => {
    const quiet = createCapture(false);
    getLogger('Paapi', quiet.base).debug('response');
    getLogger('Paapi', quiet.base).warn('no offer');
    expect(quiet.lines.map((line) => line.level)).toEqual([40]);

    const verbose = createCapture(true);
    getLogger('Paapi', verbose.base).debug('response');
    expect(verbose.lines.map((line) => line.level)).toEqual([20]);
  });

  it('redacts credentials attached to a logged object', () => {
    const { base, lines } = createCapture();
    getLogger('Paapi', base).error('failed', { credentialSecret: 'secret', password: 'pw', status: 401 });

    expect(lines[0].err).toEqual({ credentialSecret: '[REDACTED]', password: '[REDACTED]', status: 401 });
  });
});

describe('createRequestLogger', () => {
  function createApp() {
    const capture = createCapture();
    const app = express();
    app.use(createRequestLogger(['/health'], capture.base));
    const log = getLogger('AmwApi', capture.base);
    app.get('/product', async (_req, res) => {
      await Promise.resolve();
      log.info('handled');
      res.json({ ok: true });
    });
    app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
    app.get('/fail', (_req, res) => { res.status(500).end(); });
    return { app, lines: capture.lines };
  }

  const requestLines = (lines: Record<string, any>[]) => lines.filter((line) => line.module === 'http');

  it('generates a request id, returns it and logs it on every line of the request', async () => {
    const { app, lines } = createApp();
    const res = await request(app).get('/product');

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(lines.find((line) => line.msg === 'handled')).toMatchObject({ module: 'AmwApi', reqId: res.headers['x-request-id'] });
    expect(requestLines(lines)[0]).toMatchObject({ level: 30, req: { id: res.headers['x-request-id'] }, res: { statusCode: 200 } });
  });

  it('honours a well-formed incoming X-Request-Id', async () => {
    const { app } = createApp();
    const res = await request(app).get('/product').set('X-Request-Id', 'proxy-1234.abc');

    expect(res.headers['x-request-id']).toBe('proxy-1234.abc');
  });

  it.each([['with spaces'], ['x'.repeat(129)], ['<script>']])('replaces a malformed X-Request-Id (%s)', async (incoming) => {
    const { app } = createApp();
    const res = await request(app).get('/product').set('X-Request-Id', incoming);

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('redacts authorization and cookie headers', async () => {
    const { app, lines } = createApp();
    await request(app).get('/product').set('Authorization', 'Bearer secret').set('Cookie', 'session=secret');

    expect(requestLines(lines)[0].req.headers).toMatchObject({ authorization: '[REDACTED]', cookie: '[REDACTED]' });
    expect(JSON.stringify(lines)).not.toContain('secret');
  });

  it('logs server errors at error level and client errors at warn level', async () => {
    const { app, lines } = createApp();
    await request(app).get('/fail');
    await request(app).get('/missing');

    expect(requestLines(lines).map((line) => line.level)).toEqual([50, 40]);
  });

  it('does not log ignored paths', async () => {
    const { app, lines } = createApp();
    await request(app).get('/health?probe=1');

    expect(requestLines(lines)).toEqual([]);
  });
});
