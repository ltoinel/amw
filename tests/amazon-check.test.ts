/**
 * Unit tests for the Amazon settings test of the administration portal (src/server/AmazonCheck.ts)
 */

import express from 'express';
import request from 'supertest';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  createRequestLogger: () => [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

import { AmazonCheck } from '../src/server/AmazonCheck';
import { AmazonError } from '../src/server/AmazonError';
import { AdminApi } from '../src/server/AdminApi';
import { Stats } from '../src/server/Stats';

const FOUND = { title: 'A book', url: 'https://www.amazon.fr/dp/B000000001?tag=test-21&linkCode=ogi' };

function setup(searchItemApi: jest.Mock) {
  let now = 1_000_000;
  const search = jest.fn(() => ({ searchItemApi }));
  const check = new AmazonCheck({ search, marketplace: 'www.amazon.fr', partnerTag: 'test-21', now: () => now });
  return { check, search, advance: (ms: number) => { now += ms; } };
}

const sdkError = (status: number) => new AmazonError('upstream', `Amazon API call failed: HTTP ${status}`, {
  cause: { status, body: { secret: 'sentinel-from-the-sdk' } },
});

describe('AmazonCheck', () => {
  it('succeeds when Amazon returns a product with the partner tag', async () => {
    const { check } = setup(jest.fn().mockResolvedValue(FOUND));

    expect(await check.run()).toMatchObject({
      ok: true, marketplace: 'www.amazon.fr', partnerTag: 'test-21', cached: false, product: FOUND,
    });
  });

  it('fails when the links do not carry the partner tag', async () => {
    const { check } = setup(jest.fn().mockResolvedValue({ title: 'A book', url: 'https://www.amazon.fr/dp/B000000001?tag=other-21' }));

    const result = await check.run();
    expect(result).toMatchObject({ ok: false, failure: 'request' });
    expect(result.product).toBeUndefined();
  });

  it('accepts an answer without product: the settings work', async () => {
    const { check } = setup(jest.fn().mockResolvedValue(null));

    const result = await check.run();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('no product');
  });

  it.each([
    [401, 'credentials', 'Amazon.credentialSecret'],
    [403, 'forbidden', 'sales requirement'],
    [400, 'request', 'Amazon.partnerTag'],
    [500, 'other', 'HTTP 500'],
  ])('explains an HTTP %i without repeating the SDK error', async (status, failure, hint) => {
    const { check } = setup(jest.fn().mockRejectedValue(sdkError(status)));

    const result = await check.run();
    expect(result).toMatchObject({ ok: false, failure });
    expect(result.message).toContain(hint);
    expect(JSON.stringify(result)).not.toContain('sentinel');
  });

  it.each([
    [new AmazonError('throttled', 'x', { retryAfter: 1 }), 'throttled'],
    [new AmazonError('timeout', 'x'), 'timeout'],
    [new Error('sentinel-network-detail'), 'other'],
  ])('classifies the other failures', async (error, failure) => {
    const { check } = setup(jest.fn().mockRejectedValue(error));

    const result = await check.run();
    expect(result).toMatchObject({ ok: false, failure });
    expect(JSON.stringify(result)).not.toContain('sentinel');
  });

  it('reports a client that cannot be created instead of throwing', async () => {
    const check = new AmazonCheck({ search: () => { throw new Error('sentinel'); }, marketplace: 'm', partnerTag: 't' });

    const result = await check.run();
    expect(result).toMatchObject({ ok: false, failure: 'other' });
    expect(JSON.stringify(result)).not.toContain('sentinel');
  });

  it('spends one call for repeated clicks, then calls Amazon again', async () => {
    const search = jest.fn().mockResolvedValue(FOUND);
    const { check, advance } = setup(search);

    await check.run();
    advance(9_999);
    expect(await check.run()).toMatchObject({ ok: true, cached: true });
    expect(search).toHaveBeenCalledTimes(1);

    advance(1);
    expect((await check.run()).cached).toBe(false);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('shares one call between concurrent clicks', async () => {
    const search = jest.fn().mockResolvedValue(FOUND);
    const { check } = setup(search);

    await Promise.all([check.run(), check.run()]);
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/amazon/test', () => {
  const PASSWORD = 'correct horse battery';
  const SECRET = 'test-secret-0123456789abcdef0123456789';

  function app(amazonCheck?: AmazonCheck): express.Application {
    const application = express();
    application.use('/amw/admin', new AdminApi(new Stats(), { password: PASSWORD, secret: SECRET, amazonCheck }).router());
    return application;
  }
  const token = async (application: express.Application) =>
    (await request(application).post('/amw/admin/api/login').send({ password: PASSWORD })).body.token;

  it('requires a token and never calls Amazon without one', async () => {
    const search = jest.fn();
    const application = app(setup(search).check);

    expect((await request(application).post('/amw/admin/api/amazon/test')).status).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('answers 200 with the outcome, a failure of Amazon included', async () => {
    const application = app(setup(jest.fn().mockRejectedValue(sdkError(401))).check);

    const res = await request(application).post('/amw/admin/api/amazon/test').set('Authorization', `Bearer ${await token(application)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, failure: 'credentials' });
  });

  it('does not accept a GET, which must not spend the quota', async () => {
    const search = jest.fn();
    const application = app(setup(search).check);

    const res = await request(application).get('/amw/admin/api/amazon/test').set('Authorization', `Bearer ${await token(application)}`);

    expect(res.status).toBe(404);
    expect(search).not.toHaveBeenCalled();
  });

  it('answers 503 without a configured check', async () => {
    const application = app();

    const res = await request(application).post('/amw/admin/api/amazon/test').set('Authorization', `Bearer ${await token(application)}`);

    expect(res.status).toBe(503);
  });
});
