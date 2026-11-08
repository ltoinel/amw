/**
 * The sites of the portal (src/server/SiteSettings.ts): their defaults from the configuration and
 * the tracking IDs of the former setting.
 */
import { createFakeRedis } from './helpers/fakeRedis';

jest.mock('../src/utils/logger', () => ({
  getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { SiteSettings } from '../src/server/SiteSettings';
import { PartnerTagSettings } from '../src/server/StuffingSettings';

const defaults = (allowedSites: string[], allowedHosts = allowedSites) => ({ server: { allowedSites }, recommendation: { allowedHosts } });

describe('SiteSettings', () => {
  test('lists Server.allowedSites until the portal saves a list', () => {
    const sites = new SiteSettings(defaults(['www.example.com']));
    expect(sites.saved).toBe(false);
    expect(sites.editable).toBe(false);
    expect(sites.list).toEqual([{ host: 'www.example.com', description: '', url: '', partnerTag: '' }]);
    expect(sites.hosts).toEqual(['www.example.com']);
    expect(sites.recommendationHosts).toEqual(['www.example.com']);
    expect(sites.partnerTags).toEqual({});
  });

  test('keeps the recommendations of Recommendation.allowedHosts, without restricting the widget', () => {
    const sites = new SiteSettings(defaults([], ['legacy.example']));
    expect(sites.hosts).toEqual([]);
    expect(sites.recommendationHosts).toEqual(['legacy.example']);
  });

  test('serves the former tracking IDs until the list is saved', async () => {
    const redis = createFakeRedis();
    const legacy = new PartnerTagSettings(redis as never);
    await legacy.save({ sites: { 'www.example.com': 'example-21', 'other.example': 'other-21' } });
    const sites = new SiteSettings(defaults(['www.example.com']), redis as never, new PartnerTagSettings(redis as never));
    await sites.refresh();

    expect(sites.list[0].partnerTag).toBe('example-21');
    expect(sites.partnerTags).toEqual({ 'www.example.com': 'example-21', 'other.example': 'other-21' });

    await sites.save({ sites: [{ host: 'www.example.com', partnerTag: 'new-21' }, { host: 'plain.example' }] });
    expect(sites.saved).toBe(true);
    expect(sites.partnerTags).toEqual({ 'www.example.com': 'new-21' });
  });

  test('reads the list saved by another process', async () => {
    const redis = createFakeRedis();
    await new SiteSettings(defaults([]), redis as never).save({ sites: [{ host: 'saved.example', description: 'Blog', url: 'https://saved.example/' }] });
    const sites = new SiteSettings(defaults(['www.example.com']), redis as never);
    await sites.refresh();
    expect(sites.hosts).toEqual(['saved.example']);
    expect(sites.list[0]).toEqual({ host: 'saved.example', description: 'Blog', url: 'https://saved.example/', partnerTag: '' });
  });
});
