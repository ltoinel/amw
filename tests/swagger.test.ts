/**
 * Tests for the OpenAPI document and the optional Swagger UI (issue #113).
 */

import request from 'supertest';
import express from 'express';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildOpenApiSpec } from '../src/server/OpenApi';

// AmwServer reads its configuration into static fields when the module is evaluated,
// so each scenario loads a fresh copy of the module with its own mocked config.
function loadApp(settings: Record<string, unknown>): { app: express.Application; swaggerLoaded: jest.Mock } {
  const values: Record<string, unknown> = {
    'Server.port': 8080,
    'Server.path': '/item',
    'Server.debug': false,
    'Server.cors': false,
    'Server.projectDir': '/tmp',
    'Server.httpCache': 300,
    'Redis.enabled': false,
    'Redis.expire': 3600,
    ...settings
  };
  const swaggerLoaded = jest.fn();
  let app!: express.Application;

  jest.isolateModules(() => {
    jest.doMock('config', () => ({
      get: (key: string) => values[key],
      has: (key: string) => key in values
    }));
    jest.doMock('../src/server/Paapi', () => ({
      Paapi: jest.fn().mockImplementation(() => ({ getItemApi: jest.fn(), searchItemApi: jest.fn() }))
    }));
    jest.doMock('swagger-ui-express', () => {
      swaggerLoaded();
      return jest.requireActual('swagger-ui-express');
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AmwServer } = require('../src/server/AmwServer');
    app = new AmwServer()['app'];
  });

  return { app, swaggerLoaded };
}

describe('OpenAPI document', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const spec = buildOpenApiSpec({ basePath: '/amw', version: '4.0.0', rateLimit: 120, httpCache: 300 });

    // The parser dereferences in place, so give it a copy
    await expect(SwaggerParser.validate(structuredClone(spec) as never)).resolves.toBeDefined();
    expect(spec.openapi).toBe('3.1.0');
  });

  it('uses the configured base path as server URL', () => {
    const spec = buildOpenApiSpec({ basePath: '/item', version: '4.0.0', rateLimit: 120, httpCache: 300 });

    expect(spec.servers).toEqual([expect.objectContaining({ url: '/item' })]);
    expect(Object.keys(spec.paths as object)).toEqual(['/product', '/widget.js', '/health', '/info']);
  });

  it('documents every status code returned by /product', () => {
    const spec = buildOpenApiSpec({ basePath: '/amw', version: '4.0.0', rateLimit: 120, httpCache: 300 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responses = (spec.paths as any)['/product'].get.responses;

    expect(Object.keys(responses).sort()).toEqual(['200', '400', '404', '429', '500', '502', '503', '504']);
  });
});

describe('Swagger UI disabled', () => {
  it.each([
    ['missing', {}],
    ['false', { 'Server.swagger': false }],
    ['"false"', { 'Server.swagger': 'false' }]
  ])('exposes no documentation route when Server.swagger is %s', async (_label, settings) => {
    const { app, swaggerLoaded } = loadApp(settings);

    await request(app).get('/item/openapi.json').expect(404);
    await request(app).get('/item/docs/').expect(404);
    expect(swaggerLoaded).not.toHaveBeenCalled();

    const info = await request(app).get('/item/info').expect(200);
    expect(info.body.endpoints).not.toContain('/item/docs/');
  });
});

describe('Swagger UI enabled', () => {
  it.each([
    ['true', true],
    ['"true"', 'true']
  ])('serves the spec and the UI when Server.swagger is %s', async (_label, flag) => {
    const { app, swaggerLoaded } = loadApp({ 'Server.swagger': flag });

    const spec = await request(app).get('/item/openapi.json').expect(200).expect('Content-Type', /json/);
    expect(spec.body.openapi).toBe('3.1.0');
    expect(spec.body.servers[0].url).toBe('/item');

    await request(app).get('/item/docs').expect(301).expect('Location', '/item/docs/');

    const ui = await request(app).get('/item/docs/').expect(200).expect('Content-Type', /html/);
    expect(ui.text).toContain('swagger-ui');
    expect(ui.headers['content-security-policy']).toContain("script-src 'self'");

    // The forced spec URL is what prevents ?url= from loading a third-party document
    const init = await request(app).get('/item/docs/swagger-ui-init.js').expect(200);
    expect(init.text).toContain('"url": "/item/openapi.json"');
    expect(init.text).toContain('"validatorUrl": null');

    expect(swaggerLoaded).toHaveBeenCalled();

    const info = await request(app).get('/item/info').expect(200);
    expect(info.body.endpoints).toEqual(expect.arrayContaining(['/item/openapi.json', '/item/docs/']));
  });
});
