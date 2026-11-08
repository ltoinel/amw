/**
 * @jest-environment jsdom
 *
 * Tracking ID of the site in the links of the cards (src/widgets/widget.js).
 */

export {};

const win = window as unknown as { AMW_PARTNER_TAGS?: unknown; AmwWidget?: { destroy(): void } };

async function linkWith(tags: unknown, url = 'https://www.amazon.fr/dp/B000000001?tag=main-21&psc=1'): Promise<string> {
  win.AmwWidget?.destroy();
  delete win.AmwWidget;
  win.AMW_PARTNER_TAGS = tags;
  document.body.innerHTML = '<div class="amw" id="B000000001"></div>';
  const product = { title: 'A product', url, image: 'https://m.media-amazon.com/a.jpg', price: '1 €', timestamp: 1 };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(product) }) as unknown as typeof fetch;
  jest.isolateModules(() => {
    require('../src/widgets/widget.js');
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return (document.querySelector('.amw-widget-main-link') as HTMLAnchorElement).href;
}

beforeEach(() => {
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  Object.defineProperty(navigator, 'sendBeacon', { value: jest.fn(), configurable: true, writable: true });
  // The widget caches products in the browser
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  win.AmwWidget?.destroy();
  delete win.AMW_PARTNER_TAGS;
});

describe('tracking ID per site', () => {
  it('replaces the tag of the Amazon links on a site that has its own', async () => {
    expect(await linkWith({ [window.location.host]: 'site-21' })).toBe('https://www.amazon.fr/dp/B000000001?tag=site-21&psc=1');
  });

  it('keeps the tag of the server elsewhere, or without the setting', async () => {
    expect(await linkWith({ 'other.example': 'site-21' })).toBe('https://www.amazon.fr/dp/B000000001?tag=main-21&psc=1');
    expect(await linkWith(undefined)).toBe('https://www.amazon.fr/dp/B000000001?tag=main-21&psc=1');
  });

  it('leaves alone a link that is not Amazon\'s', async () => {
    expect(await linkWith({ [window.location.host]: 'site-21' }, 'https://amazon.fr.evil.example/?tag=x')).toBe('https://amazon.fr.evil.example/?tag=x');
  });

  it('works on other Amazon marketplaces', async () => {
    expect(await linkWith({ [window.location.host]: 'site-20' }, 'https://www.amazon.co.uk/dp/B000000001?tag=main-21'))
      .toBe('https://www.amazon.co.uk/dp/B000000001?tag=site-20');
  });
});
