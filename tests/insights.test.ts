/**
 * Unit tests for the AI insights (src/server/Insights.ts), with a fake Claude API client.
 */

import { Insights, InsightsError, MessagesApi } from '../src/server/Insights';
import { Stats } from '../src/server/Stats';
import { createFakeRedis } from './helpers/fakeRedis';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() }),
}));

const REPORT = {
  summary: 'Traffic is stable.',
  recommendations: [{ title: 'Replace B00GONE001', detail: 'It is still embedded in https://blog.example/post.' }],
};

function answer(body: unknown, overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
    usage: { input_tokens: 1200, output_tokens: 300 },
    ...overrides,
  };
}

async function statsWithData(): Promise<Stats> {
  const stats = new Stats(createFakeRedis());
  stats.recordProduct('cache', 'id', 'B084DN3XVN', 'https://blog.example/post?session=secret');
  stats.recordProduct('notfound', 'id', 'B00GONE001', 'https://blog.example/post');
  stats.recordClick('B084DN3XVN', 'https://blog.example/post');
  await new Promise(resolve => setImmediate(resolve));
  return stats;
}

function setup(stats: Stats, response: unknown = answer(REPORT)) {
  let now = Date.UTC(2026, 9, 23, 12);
  const create = jest.fn().mockResolvedValue(response);
  const insights = new Insights(stats, { create } as unknown as MessagesApi, () => now);
  return { insights, create, advance: (ms: number) => { now += ms; } };
}

describe('Insights.report', () => {
  it('asks Claude Opus 5.5 for a structured analysis of the period, with the default fallback', async () => {
    const { insights, create } = setup(await statsWithData());

    const report = await insights.report(7);

    expect(report).toEqual({
      available: true, days: 7, generatedAt: '2026-10-23T12:00:00.000Z', model: 'claude-opus-5-5', cached: false, ...REPORT,
    });
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(params.thinking).toBeUndefined();
  });

  it('sends only aggregated figures, with page URLs stripped of their query string', async () => {
    const { insights, create } = setup(await statsWithData());

    await insights.report(7);

    const prompt: string = create.mock.calls[0][0].messages[0].content;
    const statistics = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1));
    expect(statistics.daily).toHaveLength(7);
    expect(statistics.mostDisplayedProducts[0]).toMatchObject({ asin: 'B084DN3XVN', views: 1, clicks: 1, clickThroughRate: 1 });
    expect(statistics.bestPerformingPages[0]).toMatchObject({ url: 'https://blog.example/post', views: 1, clicks: 1 });
    expect(statistics.productsToReplace[0]).toMatchObject({ asin: 'B00GONE001', embeddedIn: ['https://blog.example/post'] });
    expect(prompt).not.toContain('secret');
  });

  it('serves the cached report for an hour, then generates a new one', async () => {
    const { insights, create, advance } = setup(await statsWithData());

    await insights.report(30);
    advance(59 * 60 * 1000);
    expect(await insights.report(30)).toMatchObject({ cached: true });
    expect(create).toHaveBeenCalledTimes(1);

    advance(2 * 60 * 1000);
    expect(await insights.report(30)).toMatchObject({ cached: false });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('regenerates on demand, but not twice within a minute', async () => {
    const { insights, create, advance } = setup(await statsWithData());

    await insights.report(30);
    expect(await insights.report(30, true)).toMatchObject({ cached: true });
    advance(61 * 1000);
    expect(await insights.report(30, true)).toMatchObject({ cached: false });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('keeps one report per period and shares a call in progress', async () => {
    const { insights, create } = setup(await statsWithData());

    await Promise.all([insights.report(7), insights.report(7), insights.report(30)]);

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 6 recommendations', async () => {
    const recommendations = Array.from({ length: 9 }, (_, i) => ({ title: `Do ${i}`, detail: 'Because.' }));
    const { insights } = setup(await statsWithData(), answer({ summary: 'S', recommendations }));

    expect((await insights.report(7)).recommendations).toHaveLength(6);
  });

  it('reports the model that answered, which is a fallback model after a decline', async () => {
    const { insights } = setup(await statsWithData(), answer(REPORT, { model: 'claude-opus-5' }));

    expect((await insights.report(7)).model).toBe('claude-opus-5');
  });

  it.each([
    ['a refusal', answer('', { stop_reason: 'refusal', content: [] }), 'Claude declined to analyse these statistics'],
    ['a truncated answer', answer('{"summary": "Tr', { stop_reason: 'max_tokens' }), 'The analysis was cut off'],
    ['invalid JSON', answer('not json'), 'The analysis could not be read'],
    ['a missing field', answer({ summary: 'Only a summary' }), 'The analysis could not be read'],
  ])('fails with an InsightsError on %s, without caching it', async (_label, response, message) => {
    const { insights, create } = setup(await statsWithData(), response);

    await expect(insights.report(7)).rejects.toThrow(new InsightsError(message));
    await expect(insights.report(7)).rejects.toThrow(InsightsError);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
